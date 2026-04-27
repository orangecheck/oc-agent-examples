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
//   1. Reads + verifies the delegation (offline, SPEC §8.1 steps 1–6).
//   2. Confirms the agent address matches delegation.agent.address.
//   3. Builds the canonical action message per @orangecheck/agent-mcp's
//      stampInvocation(), but routes signing through stdin so the agent's
//      wallet does the actual BIP-322 work.
//   4. Emits the signed agent-action envelope as pretty JSON on stdout.
//
// The resulting envelope is verifiable end-to-end at agent.ochk.io/inspect
// or by anyone with @orangecheck/agent-core.

import { readFileSync } from 'node:fs';
import { argv, exit, stderr } from 'node:process';

import { verifyDelegation } from '@orangecheck/agent-core';
import { stampInvocation, type McpInvocation } from '@orangecheck/agent-mcp';

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

    // Sanity-verify the delegation. This catches expired/malformed grants
    // before we waste the operator's time prompting them for a signature.
    // We skip the BIP-322 verify here since this script doesn't carry a
    // verifier (and the principal's signature is trusted at issue time).
    const v = await verifyDelegation({
        envelope: delegation,
        skipSignatureVerification: true,
    });
    if (!v.ok) {
        throw new Error(`delegation rejected: ${v.code} — ${v.message}`);
    }

    stderr.write(`✓ delegation verified offline (${v.envelope.id})\n`);
    stderr.write(`  scopes:\n`);
    for (const s of v.envelope.scopes) stderr.write(`    ${s}\n`);
    stderr.write(`  expires: ${v.envelope.expires_at}\n`);

    const agent = makeInteractiveSigner(args.agentAddress);

    const action = await stampInvocation({
        agent,
        delegation: v.envelope,
        invocation,
        scopeExercised: args.scope,
    });

    process.stdout.write(JSON.stringify(action, null, 2) + '\n');
    stderr.write(`\n✓ action signed — id ${action.id}\n`);
    stderr.write(
        `  pipe stdout to a .action file and verify at https://agent.ochk.io/inspect\n`
    );
}

main().catch((err) => {
    stderr.write(`\nERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    exit(1);
});
