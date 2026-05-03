// oc-agent-openai-function-call — wrap an OpenAI function call with an
// OC Agent action envelope, optionally posting to fleet.ochk.io.
//
// Compatible with both:
//   - Responses API (newer, streaming-first)
//   - Chat Completions tool calls (older, sync)
//
// Both produce the same OpenAiFunctionCall shape — see example-call.json.
//
// Usage:
//   tsx src/index.ts \
//     --delegation path/to/agent.delegation \
//     --call path/to/function-call.json \
//     --agent-address bc1q… \
//     [--scope openai:function(name=invoice.create)] \
//     [--fleet-token ock_… --fleet-project proj_…] \
//     > my.action

import { readFileSync } from 'node:fs';
import { argv, exit, stderr, stdout } from 'node:process';

import { verifyDelegation } from '@orangecheck/agent-core';
import {
    invokeWithStampAndPost,
    type OpenAiFunctionCall,
    type FleetClient,
} from '@orangecheck/agent-openai';

import { makeInteractiveSigner } from './interactive-signer.ts';

interface CliArgs {
    delegationPath: string;
    callPath: string;
    agentAddress: string;
    scope?: string;
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
    const callPath = m.get('call');
    const agentAddress = m.get('agent-address');
    if (!delegationPath || !callPath || !agentAddress) {
        throw new Error(
            'usage: tsx src/index.ts --delegation <path> --call <path> --agent-address <bc1q…> [--scope <scope-string>] [--fleet-token <ock_…> --fleet-project <proj_…>]'
        );
    }
    return {
        delegationPath,
        callPath,
        agentAddress,
        scope: m.get('scope'),
        fleetToken: m.get('fleet-token'),
        fleetProject: m.get('fleet-project'),
        fleetBaseUrl: m.get('fleet-base-url'),
    };
}

/** Stand-in for your real implementation. Echo the input. */
async function invoiceHandler(call: OpenAiFunctionCall): Promise<unknown> {
    stderr.write(`\nrunning function: ${call.name}\n`);
    stderr.write(`args: ${JSON.stringify(call.arguments, null, 2)}\n`);
    return { ok: true, echoed: call.arguments, ts: new Date().toISOString() };
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

    const rawCall = JSON.parse(readFileSync(args.callPath, 'utf8'));
    const signer = makeInteractiveSigner(args.agentAddress);

    const fleet: FleetClient | undefined =
        args.fleetToken && args.fleetProject
            ? { apiToken: args.fleetToken, projectId: args.fleetProject, baseUrl: args.fleetBaseUrl }
            : undefined;

    const { result, action, posted } = await invokeWithStampAndPost({
        agent: signer,
        delegation,
        call: rawCall,                 // accepts raw OpenAI tool_call OR a normalized OpenAiFunctionCall
        scopeExercised: args.scope,
        execute: invoiceHandler,
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

    stderr.write(`\nfunction result:\n`);
    stderr.write(JSON.stringify(result, null, 2) + '\n');

    stdout.write(JSON.stringify(action, null, 2) + '\n');
}

main().catch((err) => {
    stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    exit(1);
});
