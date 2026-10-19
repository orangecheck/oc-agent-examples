// oc-agent-mcp-wrap — wrap an MCP tool invocation in a signed OC Agent
// action envelope without ever holding the agent's private key.
//
// Usage:
//   tsx src/index.ts \
//     --delegation path/to/agent.delegation \
//     --invocation path/to/invocation.json \
//     --agent-address bc1q… \
//     [--scope mcp:invoke(server=https://example.com,tool=search)] \
//     > my.action
//
// The script:
//   1. Verifies the delegation offline (SPEC §8.1), including the
//      principal's BIP-322 signature.
//   2. Confirms the agent address matches delegation.agent.address.
//   3. Stamps the invocation with @orangecheck/agent-mcp's
//      stampInvocation(), routing signing through stdin so the agent's
//      wallet does the actual BIP-322 work.
//   4. Emits the signed agent-action envelope as pretty JSON on stdout.
//
// Verify the result with `npx @orangecheck/agent-cli verify` on a
// [delegation, action] array, or paste that array into
// https://agent.ochk.io/app/inspect.

import { readFileSync } from 'node:fs';
import { argv, exit, stderr } from 'node:process';

import { verifyDelegation } from '@orangecheck/agent-core';
import { stampInvocation, type McpInvocation } from '@orangecheck/agent-mcp';
import { verifySignature } from '@orangecheck/bip322';

import { makeInteractiveSigner } from './interactive-signer.ts';

interface CliArgs {
    delegationPath: string;
    invocationPath: string;
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
    const invocationPath = m.get('invocation');
    const agentAddress = m.get('agent-address');
    if (!delegationPath || !invocationPath || !agentAddress) {
        throw new Error(
            'usage: tsx src/index.ts --delegation <path> --invocation <path> --agent-address <bc1q…> [--scope <scope-string>]'
        );
    }
    return {
        delegationPath,
        invocationPath,
        agentAddress,
        scope: m.get('scope'),
    };
}

async function main() {
    const args = parseArgs(argv.slice(2));

    const delegation = JSON.parse(readFileSync(args.delegationPath, 'utf8'));
    const invocation = JSON.parse(readFileSync(args.invocationPath, 'utf8')) as McpInvocation;

    if (delegation.kind !== 'agent-delegation') {
        throw new Error(`expected delegation envelope, got kind=${delegation.kind}`);
    }
    if (delegation.agent.address !== args.agentAddress) {
        throw new Error(
            `delegation grants authority to ${delegation.agent.address}, not ${args.agentAddress}`
        );
    }

    // Verify the delegation before prompting for a signature, so an expired,
    // malformed or forged grant fails without wasting the operator's time.
    const v = await verifyDelegation({
        envelope: delegation,
        verifyBip322: async (msg, sig, addr) => verifySignature(addr, msg, sig),
        // Offline example. In production, fetch kind-30085 revocations by
        // #delegation and pass them as `revocations` instead.
        skipRevocationCheck: true,
    });
    if (!v.ok) {
        throw new Error(`delegation rejected: ${v.code} — ${v.message}`);
    }

    stderr.write(`✓ delegation verified offline (${v.envelope.id})\n`);
    stderr.write(`  scopes:\n`);
    for (const s of v.envelope.scopes ?? []) stderr.write(`    ${s}\n`);
    stderr.write(`  expires: ${v.envelope.expires_at}\n`);

    const action = await stampInvocation({
        agent: makeInteractiveSigner(args.agentAddress),
        delegation: v.envelope,
        invocation,
        scopeExercised: args.scope,
    });

    process.stdout.write(JSON.stringify(action, null, 2) + '\n');
    stderr.write(`\n✓ action signed — id ${action.id}\n`);
    stderr.write(
        `  verify: npx @orangecheck/agent-cli verify on [delegation, action], or https://agent.ochk.io/app/inspect\n`
    );
}

main().catch((err) => {
    stderr.write(`\nERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    exit(1);
});
