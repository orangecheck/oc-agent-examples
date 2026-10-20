// Wraps @orangecheck/agent-core's verifyAction with two MCP-shaped checks:
// the action's content hash MUST match the canonical bytes of the invocation
// this server was actually asked to run, and the exercised scope MUST name
// this server and this tool.
//
// The canonical bytes come from @orangecheck/agent-mcp, the same function
// mcp-wrap stamps with, so the two sides cannot drift apart.

import {
    isSubScope,
    parseScope,
    verifyAction,
    verifyDelegation,
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

export async function verifyMcpCall(
    req: ToolCallRequest,
    bundle: OcAgentBundle
): Promise<VerifyMcpCallResult> {
    // 1. The delegation is authentic and in force right now.
    //    Revocations: this demo stays offline. A production server queries
    //    Nostr kind-30085 by `"#t": [delegation id]` and passes `revocations` instead of
    //    skipRevocationCheck, here and in step 2.
    const dr = await verifyDelegation({
        envelope: bundle.delegation,
        verifyBip322,
        skipRevocationCheck: true,
    });
    if (!dr.ok) {
        return { ok: false, code: dr.code, message: `delegation: ${dr.message}` };
    }

    // 2. The action: SPEC §8 chain (id, agent signature, delegation binding,
    //    signing window, sub-scope of a grant), plus `content`, which binds
    //    the action to the invocation we received. An action stamped over
    //    different arguments, another tool or another server fails here.
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

    // 3. The exercised scope must name this server and this tool. verifyAction
    //    already proved it is a sub-scope of some grant; this proves the grant
    //    being exercised is the one for this call.
    let admitted = false;
    try {
        const here = parseScope(`mcp:invoke(server=${SERVER_ID},tool=${req.params.name})`);
        admitted = isSubScope(parseScope(bundle.action.scope_exercised), here);
    } catch (e) {
        return { ok: false, code: 'E_BAD_SCOPE_GRAMMAR', message: (e as Error).message };
    }
    if (!admitted) {
        return {
            ok: false,
            code: 'E_SCOPE_DENIED',
            message: `scope_exercised ${bundle.action.scope_exercised} does not name server=${SERVER_ID},tool=${req.params.name}`,
        };
    }

    return {
        ok: true,
        actionId: ar.id,
        delegationId: bundle.delegation.id,
        scopeExercised: bundle.action.scope_exercised,
    };
}
