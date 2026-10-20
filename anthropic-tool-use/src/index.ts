// oc-agent-anthropic-tool-use — wrap an Anthropic Tool Use call with an
// OC Agent action envelope.
//
// Usage:
//   tsx src/index.ts \
//     --delegation path/to/agent.delegation \
//     --tool-use path/to/tool-use.json \
//     --agent-address bc1q… \
//     [--scope anthropic:tool(name=invoice.create)] \
//     > my.action
//
// The script:
//   1. Reads + verifies the delegation envelope offline (SPEC §8.1),
//      including the principal's BIP-322 signature.
//   2. Confirms the agent address matches delegation.agent.address.
//   3. Reads the Anthropic `tool_use` block (id, name, input).
//   4. Stamps the tool_use into an OC Agent action envelope, signing
//      via stdin so the agent's wallet does the actual BIP-322 work
//      (the agent's private key never enters this process).
//   5. Runs your handler — here an echo stub. Swap in your real
//      implementation where invoiceHandler is wired below.
//   6. Emits the signed envelope as pretty JSON on stdout.
//
// Anyone holding the delegation can verify the envelope offline with
// verifyAction from @orangecheck/agent-core. See README.md.

import { readFileSync } from 'node:fs';
import { argv, exit, stderr, stdout } from 'node:process';

import { invokeWithStamp, type AnthropicToolUse } from '@orangecheck/agent-anthropic';
import { verifyDelegation } from '@orangecheck/agent-core';
import { verifySignature } from '@orangecheck/bip322';

import { makeInteractiveSigner } from './interactive-signer.ts';

interface CliArgs {
    delegationPath: string;
    toolUsePath: string;
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
            if (!v || v.startsWith('--')) {
                throw new Error(`flag --${k} expects a value`);
            }
            m.set(k, v);
            i++;
        }
    }
    const delegationPath = m.get('delegation');
    const toolUsePath = m.get('tool-use');
    const agentAddress = m.get('agent-address');
    if (!delegationPath || !toolUsePath || !agentAddress) {
        throw new Error(
            'usage: tsx src/index.ts --delegation <path> --tool-use <path> --agent-address <bc1q…> [--scope <scope-string>]'
        );
    }
    return { delegationPath, toolUsePath, agentAddress, scope: m.get('scope') };
}

/**
 * Stand-in for your real tool implementation. Receives the same
 * AnthropicToolUse the model produced; returns whatever your tool would
 * normally return. This example just echoes the input back so the
 * end-to-end flow is observable without external side effects.
 */
async function invoiceHandler(toolUse: AnthropicToolUse): Promise<unknown> {
    stderr.write(`\nrunning tool: ${toolUse.name}\n`);
    stderr.write(`input: ${JSON.stringify(toolUse.input, null, 2)}\n`);
    return {
        ok: true,
        echoed: toolUse.input,
        ts: new Date().toISOString(),
    };
}

async function main(): Promise<void> {
    const args = parseArgs(argv.slice(2));

    // 1. Read + verify the delegation envelope offline.
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

    // 2. Confirm the agent address matches.
    if (delegation.agent.address !== args.agentAddress) {
        throw new Error(
            `--agent-address ${args.agentAddress} does not match delegation.agent.address ${delegation.agent.address}`
        );
    }

    // 3. Read the Anthropic tool_use block.
    const toolUse: AnthropicToolUse = JSON.parse(readFileSync(args.toolUsePath, 'utf8'));
    if (!toolUse.id || !toolUse.name || typeof toolUse.input !== 'object') {
        throw new Error('tool_use file must be { id: string, name: string, input: object }');
    }

    // 4–5. Scope check, stamp (signing via stdin), then run the handler.
    //      An out-of-scope call throws before the handler runs.
    const { result, action } = await invokeWithStamp({
        agent: makeInteractiveSigner(args.agentAddress),
        delegation,
        toolUse,
        scopeExercised: args.scope,
        call: invoiceHandler,
    });

    stderr.write(`✓ stamped action · id=${action.id} · scope=${action.scope_exercised}\n`);
    stderr.write(`\ntool result:\n`);
    stderr.write(JSON.stringify(result, null, 2) + '\n');

    // 6. Emit the signed envelope on stdout for piping / saving.
    stdout.write(JSON.stringify(action, null, 2) + '\n');
}

main().catch((err) => {
    stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    exit(1);
});
