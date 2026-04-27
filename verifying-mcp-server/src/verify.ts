// Wraps @orangecheck/agent-core's verifyAction with an MCP-shaped check:
// the action's content_hash MUST match a SHA-256 of the canonical MCP
// invocation, and the exercised scope MUST be a sub-scope of `mcp:invoke`.
//
// This is the server-side mirror of @orangecheck/agent-mcp's stampInvocation
// on the client side — same canonicalization, opposite direction.

import { sha256 } from '@noble/hashes/sha256';
import { canonicalize, hexEncode, parseScope, isSubScope } from '@orangecheck/agent-core';

import type { OcAgentBundle, ToolCallRequest } from './types.ts';

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

/**
 * Build the canonical bytes for an MCP invocation in the same shape
 * @orangecheck/agent-mcp uses on the signing side. The two sides MUST agree
 * exactly or the content_hash check fails.
 */
function canonicalInvocationBytes(req: ToolCallRequest): Uint8Array {
    const canon = {
        arguments: req.params.arguments,
        server: 'stdio:oc-agent-examples/verifying-mcp-server',
        tool: req.params.name,
    };
    const str = canonicalize(canon as unknown as Parameters<typeof canonicalize>[0]);
    return new TextEncoder().encode(str + '\n');
}

export async function verifyMcpCall(
    req: ToolCallRequest,
    bundle: OcAgentBundle
): Promise<VerifyMcpCallResult> {
    const core = await import('@orangecheck/agent-core');

    // 1. Verify the delegation envelope itself.
    const dr = await core.verifyDelegation({
        envelope: bundle.delegation,
        skipSignatureVerification: true, // demo posture; flip in production
    });
    if (!dr.ok) {
        return { ok: false, code: dr.code, message: `delegation: ${dr.message}` };
    }

    // 2. Verify the action against the delegation. agent-core handles the
    //    full SPEC §8.1 chain (id, scope grammar, signature, window, scope
    //    sub-relation). We do NOT pass revocations here — for that, query
    //    Nostr kind-30085 and feed them in. Skipped in the demo.
    const ar = await core.verifyAction({
        action: bundle.action,
        delegation: bundle.delegation,
        skipSignatureVerification: true,
    });
    if (!ar.ok) {
        return { ok: false, code: ar.code, message: `action: ${ar.message}` };
    }

    // 3. MCP-specific: the action's content_hash MUST equal sha256 of the
    //    canonicalized invocation we received. This is the bind between
    //    "what the agent stamped" and "what we're being asked to execute."
    const expected = 'sha256:' + hexEncode(sha256(canonicalInvocationBytes(req)));
    if (bundle.action.content.hash !== expected) {
        return {
            ok: false,
            code: 'E_INVOCATION_HASH_MISMATCH',
            message: `action attests to ${bundle.action.content.hash}, request canonicalizes to ${expected}`,
        };
    }

    // 4. MCP-specific: scope_exercised MUST be a sub-scope of an mcp:invoke
    //    grant in the delegation. (verifyAction already checks sub-scope
    //    against ANY scope in delegation.scopes, but we additionally pin
    //    the family to mcp:invoke since that's what THIS server speaks.)
    let exercised;
    try {
        exercised = parseScope(bundle.action.scope_exercised);
    } catch (e) {
        return {
            ok: false,
            code: 'E_BAD_SCOPE_GRAMMAR',
            message: (e as Error).message,
        };
    }
    if (exercised.product !== 'mcp' || exercised.verb !== 'invoke') {
        return {
            ok: false,
            code: 'E_WRONG_SCOPE_FAMILY',
            message: `this server only honors mcp:invoke; got ${exercised.product}:${exercised.verb}`,
        };
    }
    const grantedMcp = bundle.delegation.scopes
        .map(parseScope)
        .filter((g) => g.product === 'mcp' && g.verb === 'invoke');
    if (!grantedMcp.some((g) => isSubScope(exercised, g))) {
        return {
            ok: false,
            code: 'E_SCOPE_DENIED',
            message: 'no granted mcp:invoke scope admits the exercised one',
        };
    }

    return {
        ok: true,
        actionId: ar.id,
        delegationId: bundle.delegation.id,
        scopeExercised: bundle.action.scope_exercised,
    };
}
