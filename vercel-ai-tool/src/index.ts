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
//     [--fleet-token ock_… --fleet-project proj_…] \
//     > my.action

import { readFileSync } from 'node:fs';
import { argv, exit, stderr, stdout } from 'node:process';

import { verifyDelegation } from '@orangecheck/agent-core';
import { ocTool, type FleetClient } from '@orangecheck/agent-vercel';

import { makeInteractiveSigner } from './interactive-signer.ts';

interface CliArgs {
    delegationPath: string;
    toolCallPath: string;
    agentAddress: string;
    fleetToken?: string;
    fleetProject?: string;
    fleetBaseUrl?: string;
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
            'usage: tsx src/index.ts --delegation <path> --tool-call <path> --agent-address <bc1q…> [--fleet-token <ock_…> --fleet-project <proj_…>]'
        );
    }
    return {
        delegationPath,
        toolCallPath,
        agentAddress,
        fleetToken: m.get('fleet-token'),
        fleetProject: m.get('fleet-project'),
        fleetBaseUrl: m.get('fleet-base-url'),
    };
}

interface ToolCallFile {
    callId: string;
    verb: string;
    args: Record<string, unknown>;
}

async function main(): Promise<void> {
    const args = parseArgs(argv.slice(2));

    const delegation = JSON.parse(readFileSync(args.delegationPath, 'utf8'));
    const verdict = await verifyDelegation({ envelope: delegation });
    if (!verdict.ok) {
        throw new Error(`delegation does not verify: ${verdict.code} · ${verdict.message}`);
    }
    stderr.write(`✓ delegation verified · agent=${delegation.agent.address}\n`);

    if (delegation.agent.address !== args.agentAddress) {
        throw new Error(
            `--agent-address ${args.agentAddress} does not match delegation.agent.address ${delegation.agent.address}`
        );
    }

    const toolCall: ToolCallFile = JSON.parse(readFileSync(args.toolCallPath, 'utf8'));
    const signer = makeInteractiveSigner(args.agentAddress);

    const fleet: FleetClient | undefined =
        args.fleetToken && args.fleetProject
            ? { apiToken: args.fleetToken, projectId: args.fleetProject, baseUrl: args.fleetBaseUrl }
            : undefined;

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
    const { result, action, posted } = await invoiceCreate.execute(toolCall.args, {
        agent: signer,
        delegation,
        callId: toolCall.callId,
        fleet,
    });

    stderr.write(`✓ stamped action · id=${action.id}\n`);
    if (posted) {
        stderr.write(
            `✓ posted to fleet · project=${posted.project_id} · delegation=${posted.delegation_id}\n`
        );
    } else if (fleet) {
        stderr.write(`× fleet POST failed (see prior log line)\n`);
    } else {
        stderr.write(`· skipped fleet POST\n`);
    }

    stderr.write(`\ntool result:\n`);
    stderr.write(JSON.stringify(result, null, 2) + '\n');

    stdout.write(JSON.stringify(action, null, 2) + '\n');
}

main().catch((err) => {
    stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    exit(1);
});
