// Wire shape this server speaks. JSON-per-line on stdin/stdout (NDJSON).
//
// Each request carries the agent's OC Agent envelopes inline under `_oc_agent`
// alongside the JSON-RPC-ish method/params payload. This is intentionally a
// minimal pattern, not the real MCP protocol — its purpose is to show where
// in a real server's request flow the verification step belongs.

import type { ActionEnvelope, DelegationEnvelope } from '@orangecheck/agent-core';

export interface OcAgentBundle {
    /** The principal-signed delegation that authorizes this call. */
    delegation: DelegationEnvelope;
    /** The agent-signed action envelope citing the delegation. */
    action: ActionEnvelope;
}

export interface ToolCallRequest {
    id: string;
    method: 'tools/call';
    params: {
        name: string;
        arguments: Record<string, unknown>;
    };
    /** OC Agent verification bundle. Required when the server is configured
     *  with --require-agent-auth. */
    _oc_agent?: OcAgentBundle;
}

export interface ToolCallSuccessResponse {
    id: string;
    result: unknown;
    /** Echo of the verified action id, for client-side audit trails. */
    verified_action_id?: string;
}

export interface ToolCallErrorResponse {
    id: string;
    error: {
        code: string;
        message: string;
    };
}

export type ToolCallResponse = ToolCallSuccessResponse | ToolCallErrorResponse;
