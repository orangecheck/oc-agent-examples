// verifying-mcp-server — server-side companion to mcp-wrap.
//
// Reads JSON-per-line tool-call requests on stdin. For each request:
//
//   1. If the request carries `_oc_agent: { delegation, action }`, run
//      verifyMcpCall(): BIP-322 signatures and the SPEC §8 chain on the
//      delegation and action, plus MCP-specific binds (content hash matches
//      the canonical invocation, scope names this server and tool).
//   2. If verification fails, write a JSON error response to stdout and
//      log the rejection to stderr.
//   3. If verification passes (or --no-require-agent-auth is set and no
//      bundle was provided), dispatch the tool and write the result.
//
// Usage:
//
//   yarn -s start                          # require OC Agent auth (default)
//   yarn -s start --no-require-agent-auth  # for local development
//
// Pipe in NDJSON; each line should be a ToolCallRequest:
//
//   echo '{"id":"1","method":"tools/call","params":{"name":"echo","arguments":{"hi":1}},"_oc_agent":{...}}' | yarn -s start

import { argv, exit, stderr, stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';

import { dispatchTool, listTools } from './tools.ts';
import type {
    ToolCallErrorResponse,
    ToolCallRequest,
    ToolCallResponse,
    ToolCallSuccessResponse,
} from './types.ts';
import { verifyMcpCall } from './verify.ts';

const requireAgentAuth = !argv.includes('--no-require-agent-auth');

stderr.write(
    `verifying-mcp-server up · tools: ${listTools().join(', ')} · agent-auth ${
        requireAgentAuth ? 'REQUIRED' : 'OPTIONAL'
    }\n`
);
stderr.write('reading NDJSON from stdin; one ToolCallRequest per line\n');

const rl = createInterface({ input: stdin });
const inFlight = new Set<Promise<void>>();

rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const p = handleLine(trimmed).finally(() => inFlight.delete(p));
    inFlight.add(p);
});

// Answer every request already read before exiting, even when verification
// awaits real I/O (e.g. a revocation lookup on Nostr).
rl.on('close', () => {
    void Promise.allSettled(inFlight).then(() => exit(0));
});

async function handleLine(line: string): Promise<void> {
    let req: ToolCallRequest;
    try {
        req = JSON.parse(line) as ToolCallRequest;
    } catch (e) {
        writeResponse({
            id: '<unparsable>',
            error: { code: 'E_PARSE', message: (e as Error).message },
        });
        return;
    }

    if (req.method !== 'tools/call') {
        writeResponse({
            id: req.id ?? '<no-id>',
            error: {
                code: 'E_UNKNOWN_METHOD',
                message: `only tools/call supported; got ${req.method}`,
            },
        });
        return;
    }

    let verifiedActionId: string | undefined;

    if (req._oc_agent) {
        const v = await verifyMcpCall(req, req._oc_agent);
        if (!v.ok) {
            stderr.write(`reject [${req.id}] ${v.code}: ${v.message}\n`);
            const err: ToolCallErrorResponse = {
                id: req.id,
                error: { code: v.code, message: v.message },
            };
            writeResponse(err);
            return;
        }
        verifiedActionId = v.actionId;
        stderr.write(
            `verify ok [${req.id}] action=${v.actionId.slice(0, 12)}… scope=${v.scopeExercised}\n`
        );
    } else if (requireAgentAuth) {
        const err: ToolCallErrorResponse = {
            id: req.id,
            error: {
                code: 'E_MISSING_AGENT_AUTH',
                message:
                    'this server requires _oc_agent.delegation + _oc_agent.action on every call (start with --no-require-agent-auth to disable for local dev)',
            },
        };
        writeResponse(err);
        return;
    }

    try {
        const result = await dispatchTool(req.params.name, req.params.arguments);
        const resp: ToolCallSuccessResponse = {
            id: req.id,
            result,
            ...(verifiedActionId ? { verified_action_id: verifiedActionId } : {}),
        };
        writeResponse(resp);
    } catch (e) {
        writeResponse({
            id: req.id,
            error: { code: 'E_TOOL_FAILED', message: (e as Error).message },
        });
    }
}

function writeResponse(r: ToolCallResponse): void {
    stdout.write(JSON.stringify(r) + '\n');
}
