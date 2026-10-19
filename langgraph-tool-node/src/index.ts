// oc-agent-langgraph-tool-node — exercise the ocToolNode primitive
// from @orangecheck/agent-langgraph without spinning up a real graph.
//
// In production a node body is `async (state) => …`. The wrapper is
// the same regardless of the surrounding graph machinery — define the
// node with ocToolNode, then call .execute(args, ctx) inside whichever
// shape your graph wants.
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
import { ocToolNode } from '@orangecheck/agent-langgraph';
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
        // #delegation and pass them as `revocations` instead.
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

    // Define the node: ocToolNode wraps your real implementation with
    // pre-call scope check + post-call envelope emission. In a real
    // graph you'd .addNode('createInvoice', (state) => createInvoice
    // .execute(state.invoice, ctx)).
    const createInvoice = ocToolNode<Record<string, unknown>, unknown>({
        verb: toolCall.verb,
        execute: async (a) => {
            stderr.write(`\nrunning node: ${toolCall.verb}\n`);
            stderr.write(`args: ${JSON.stringify(a, null, 2)}\n`);
            return { ok: true, echoed: a, ts: new Date().toISOString() };
        },
    });

    // graphState is the persisted graph state at the moment of the call.
    // Its hash goes into the canonical bytes, so a verifier can prove which
    // graph state the agent was operating from. For this single-node example
    // we pass the input args; in a real graph this is `state`.
    const { result, action } = await createInvoice.execute(toolCall.args, {
        agent: makeInteractiveSigner(args.agentAddress),
        delegation,
        callId: toolCall.callId,
        graphState: toolCall.args,
    });

    stderr.write(`✓ stamped action · id=${action.id} · scope=${action.scope_exercised}\n`);
    stderr.write(`\nnode result:\n`);
    stderr.write(JSON.stringify(result, null, 2) + '\n');

    stdout.write(JSON.stringify(action, null, 2) + '\n');
}

main().catch((err) => {
    stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    exit(1);
});
