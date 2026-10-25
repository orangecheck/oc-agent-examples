// Wraps @orangecheck/agent-core's live verifyAction with MCP-shaped checks:
// the action's content hash MUST match the canonical bytes of the invocation
// this server was actually asked to run, the exercised scope MUST name this
// server and this tool, and each action runs once.
//
// The canonical bytes come from @orangecheck/agent-mcp, the same function
// mcp-wrap stamps with, so the two sides cannot drift apart.

import {
    canonicalizeScope,
    createReplayGuard,
    isSubScope,
    parseScope,
    verifyAction,
    type Scope,
} from '@orangecheck/agent-core';
import { canonicalizeInvocation } from '@orangecheck/agent-mcp';
import { verifySignature } from '@orangecheck/bip322';

import type { OcAgentBundle, ToolCallRequest } from './types.ts';

/** The `server` value clients must stamp invocations of this server with. */
export const SERVER_ID = 'stdio:oc-agent-examples/verifying-mcp-server';

export interface VerifyMcpCallOk {
    ok: true;
    actionId: string;
    delegationId: string;
    scopeExercised: string;
}

export interface VerifyMcpCallErr {
    ok: false;
    code: string;
    message: string;
}

export type VerifyMcpCallResult = VerifyMcpCallOk | VerifyMcpCallErr;

const verifyBip322 = async (msg: string, sig: string, addr: string) =>
    verifySignature(addr, msg, sig);

/** Ids of accepted actions, kept for as long as they could pass verifyAction's 120 s bound. */
const seen = createReplayGuard();

export async function verifyMcpCall(
    req: ToolCallRequest,
    bundle: OcAgentBundle
): Promise<VerifyMcpCallResult> {
    // 1. The action, checked live (SPEC §8): the delegation in force now, its
    //    signature, the agent's signature, the sub-scope of a grant, and
    //    signed_at within 120 s of this clock (E_STALE). `content` binds the
    //    action to the invocation we received: an action stamped over different
    //    arguments, another tool or another server fails here.
    //    Revocations: this demo stays offline. A production server queries
    //    Nostr kind-30085 by `"#t": [delegation id]` and passes `revocations`
    //    instead of skipRevocationCheck; if no relay answers, it refuses.
    const ar = await verifyAction({
        action: bundle.action,
        delegation: bundle.delegation,
        verifyBip322,
        skipRevocationCheck: true,
        content: canonicalizeInvocation({
            server: SERVER_ID,
            tool: req.params.name,
            arguments: req.params.arguments,
        }),
    });
    if (!ar.ok) {
        return { ok: false, code: ar.code, message: `action: ${ar.message}` };
    }

    // 2. The exercised scope must name this server and this tool. verifyAction
    //    already proved it is a sub-scope of some grant; this proves the grant
    //    being exercised is the one for this call. The tool name comes from the
    //    request, so it goes in as a value and never as scope text: a call
    //    named "*" is the tool called "*", not every tool.
    const here: Scope = {
        product: 'mcp',
        verb: 'invoke',
        constraints: [
            { key: 'server', op: '=', value: SERVER_ID, quoted: false },
            { key: 'tool', op: '=', value: req.params.name, quoted: true },
        ],
    };
    let admitted = false;
    try {
        admitted = isSubScope(parseScope(bundle.action.scope_exercised), here);
    } catch (e) {
        return { ok: false, code: 'E_BAD_SCOPE_GRAMMAR', message: (e as Error).message };
    }
    if (!admitted) {
        return {
            ok: false,
            code: 'E_SCOPE_DENIED',
            message: `scope_exercised ${bundle.action.scope_exercised} does not name ${canonicalizeScope(here)}`,
        };
    }

    // 3. One signed action runs once.
    if (!seen.firstUse(bundle.action)) {
        return { ok: false, code: 'E_ALREADY_USED', message: `action ${ar.id} was already used` };
    }

    return {
        ok: true,
        actionId: ar.id,
        delegationId: bundle.delegation.id,
        scopeExercised: bundle.action.scope_exercised,
    };
}
