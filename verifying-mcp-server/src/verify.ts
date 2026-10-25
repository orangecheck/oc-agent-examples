// Wraps @orangecheck/agent-core's live verifyAction with MCP-shaped checks:
// the action's content hash MUST match the canonical bytes of the invocation
// this server was actually asked to run, the exercised scope MUST name this
// server and this tool, a grant's max_invocations caps how many run, and each
// action runs once.
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

/**
 * Actions accepted under each grant, by `<delegation id> <granted scope>`. This
 * lives in memory, so the max_invocations cap holds only while the process runs;
 * a fork keeps it in a durable store.
 */
const invocations = new Map<string, number>();

/** The most invocations `grant` allows, or null when it sets no upper bound. */
function invocationCap(grant: Scope): number | null {
    const c = grant.constraints.find((x) => x.key === 'max_invocations');
    if (!c || c.value === undefined || !/^\d+$/.test(c.value)) return null;
    if (c.op === '<=' || c.op === '=') return Number(c.value);
    if (c.op === '<') return Number(c.value) - 1;
    return null;
}

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

    // 3. max_invocations: each accepted action spends one invocation from a grant
    //    that admits it, and a grant with none left admits no more.
    const exercised = parseScope(bundle.action.scope_exercised);
    const slot = (bundle.delegation.scopes ?? [])
        .map(parseScope)
        .filter((g) => isSubScope(exercised, g))
        .map((g) => ({ key: `${bundle.delegation.id} ${canonicalizeScope(g)}`, cap: invocationCap(g) }))
        .find(({ key, cap }) => cap === null || (invocations.get(key) ?? 0) < cap);
    if (!slot) {
        return {
            ok: false,
            code: 'E_MAX_INVOCATIONS',
            message: `delegation ${bundle.delegation.id} has no invocations left for ${bundle.action.scope_exercised}`,
        };
    }

    // 4. One signed action runs once.
    if (!seen.firstUse(bundle.action)) {
        return { ok: false, code: 'E_ALREADY_USED', message: `action ${ar.id} was already used` };
    }
    invocations.set(slot.key, (invocations.get(slot.key) ?? 0) + 1);

    return {
        ok: true,
        actionId: ar.id,
        delegationId: bundle.delegation.id,
        scopeExercised: bundle.action.scope_exercised,
    };
}
