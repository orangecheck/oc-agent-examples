// oc-agent-openai-function-call — wrap an OpenAI function call with an
// OC Agent action envelope.
//
// Compatible with both:
//   - Responses API function_call items ({ call_id, name, arguments })
//   - Chat Completions tool calls ({ id, function: { name, arguments } })
//
// Both normalize to the same OpenAiFunctionCall shape — see example-call.json.
//
// Usage:
//   tsx src/index.ts \
//     --delegation path/to/agent.delegation \
//     --call path/to/function-call.json \
//     --agent-address bc1q… \
//     [--scope openai:function(name=invoice.create)] \
//     > my.action

import { readFileSync } from 'node:fs';
import { argv, exit, stderr, stdout } from 'node:process';

import { verifyDelegation } from '@orangecheck/agent-core';
import { invokeWithStamp, type OpenAiFunctionCall } from '@orangecheck/agent-openai';
import { verifySignature } from '@orangecheck/bip322';

import { makeInteractiveSigner } from './interactive-signer.ts';

interface CliArgs {
    delegationPath: string;
    callPath: string;
    agentAddress: string;
    scope?: string;
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
            'usage: tsx src/index.ts --delegation <path> --call <path> --agent-address <bc1q…> [--scope <scope-string>]'
        );
    }
    return { delegationPath, callPath, agentAddress, scope: m.get('scope') };
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
    const verdict = await verifyDelegation({
        envelope: delegation,
        verifyBip322: async (msg, sig, addr) => verifySignature(addr, msg, sig),
        // openai:function is not in agent-core's scope registry.
        scopeMode: 'permissive',
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

    const rawCall = JSON.parse(readFileSync(args.callPath, 'utf8'));

    // Scope check, stamp (signing via stdin), then run the handler.
    // An out-of-scope call throws before the handler runs.
    const { result, action } = await invokeWithStamp({
        agent: makeInteractiveSigner(args.agentAddress),
        delegation,
        call: rawCall, // raw OpenAI tool_call / function_call, or a normalized OpenAiFunctionCall
        scopeExercised: args.scope,
        execute: invoiceHandler,
    });

    stderr.write(`✓ stamped action · id=${action.id} · scope=${action.scope_exercised}\n`);
    stderr.write(`\nfunction result:\n`);
    stderr.write(JSON.stringify(result, null, 2) + '\n');

    stdout.write(JSON.stringify(action, null, 2) + '\n');
}

main().catch((err) => {
    stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    exit(1);
});
