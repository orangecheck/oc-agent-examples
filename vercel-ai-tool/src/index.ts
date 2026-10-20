// oc-agent-vercel-ai-tool — wrap a Vercel AI SDK tool() call with the
// ocTool primitive from @orangecheck/agent-vercel. Demonstrates the
// ergonomic two-step composition:
//
//   1. ocTool({ verb, parameters, execute }) wraps your real handler
//      and returns a tool that scope-checks + emits an action envelope.
//   2. Inside your AI SDK `tool()`, call wrapped.execute(args, ctx).
//
// For this example we skip the actual AI SDK call and exercise the
// wrapped tool directly, so you can see the envelope flow without
// burning provider tokens.
//
// Usage:
//   tsx src/index.ts \
//     --delegation path/to/agent.delegation \
//     --tool-call path/to/tool-call.json \
//     --agent-address bc1q… \
//     > my.action

import { readFileSync } from 'node:fs';
import { argv, exit, stderr, stdout } from 'node:process';

import { verifyDelegation } from '@orangecheck/agent-core';
import { ocTool } from '@orangecheck/agent-vercel';
import { verifySignature } from '@orangecheck/bip322';

import { makeInteractiveSigner } from './interactive-signer.ts';

interface CliArgs {
    delegationPath: string;
    toolCallPath: string;
    agentAddress: string;
}

function parseArgs(args: string[]): CliArgs {
    const m = new Map<string, string>();
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a?.startsWith('--')) {
            const k = a.slice(2);
            const v = args[i + 1];
            if (!v || v.startsWith('--')) throw new Error(`flag --${k} expects a value`);
            m.set(k, v);
            i++;
        }
    }
    const delegationPath = m.get('delegation');
    const toolCallPath = m.get('tool-call');
    const agentAddress = m.get('agent-address');
    if (!delegationPath || !toolCallPath || !agentAddress) {
        throw new Error(
            'usage: tsx src/index.ts --delegation <path> --tool-call <path> --agent-address <bc1q…>'
        );
    }
    return { delegationPath, toolCallPath, agentAddress };
}

interface ToolCallFile {
    callId: string;
    verb: string;
    args: Record<string, unknown>;
}

async function main(): Promise<void> {
    const args = parseArgs(argv.slice(2));

    const delegation = JSON.parse(readFileSync(args.delegationPath, 'utf8'));
    const verdict = await verifyDelegation({
        envelope: delegation,
        verifyBip322: async (msg, sig, addr) => verifySignature(addr, msg, sig),
        // Offline example. In production, fetch kind-30085 revocations by
        // `"#t": [delegation id]` and pass them as `revocations` instead.
        skipRevocationCheck: true,
    });
    if (!verdict.ok) {
        throw new Error(`delegation does not verify: ${verdict.code} · ${verdict.message}`);
    }
    stderr.write(`✓ delegation verified · id=${verdict.id} · agent=${delegation.agent.address}\n`);

    if (delegation.agent.address !== args.agentAddress) {
        throw new Error(
            `--agent-address ${args.agentAddress} does not match delegation.agent.address ${delegation.agent.address}`
        );
    }

    const toolCall: ToolCallFile = JSON.parse(readFileSync(args.toolCallPath, 'utf8'));

    // Step 1: wrap the real handler with ocTool.
    const invoiceCreate = ocTool<Record<string, unknown>, unknown>({
        verb: toolCall.verb,
        execute: async (a) => {
            stderr.write(`\nrunning tool: ${toolCall.verb}\n`);
            stderr.write(`args: ${JSON.stringify(a, null, 2)}\n`);
            return { ok: true, echoed: a, ts: new Date().toISOString() };
        },
    });

    // Step 2: invoke. In a real Vercel AI SDK app this is where your
    // tool()'s `execute` would call wrapped.execute and return result.
    // An out-of-scope call throws before the handler runs.
    const { result, action } = await invoiceCreate.execute(toolCall.args, {
        agent: makeInteractiveSigner(args.agentAddress),
        delegation,
        callId: toolCall.callId,
    });

    stderr.write(`✓ stamped action · id=${action.id} · scope=${action.scope_exercised}\n`);
    stderr.write(`\ntool result:\n`);
    stderr.write(JSON.stringify(result, null, 2) + '\n');

    stdout.write(JSON.stringify(action, null, 2) + '\n');
}

main().catch((err) => {
    stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    exit(1);
});
