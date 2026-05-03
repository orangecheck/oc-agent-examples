// oc-agent-anthropic-tool-use — wrap an Anthropic Tool Use call with an
// OC Agent action envelope, optionally posting to fleet.ochk.io.
//
// Usage:
//   tsx src/index.ts \
//     --delegation path/to/agent.delegation \
//     --tool-use path/to/tool-use.json \
//     --agent-address bc1q… \
//     [--scope anthropic:tool(name=invoice.create)] \
//     [--fleet-token ock_…] \
//     [--fleet-project proj_…] \
//     > my.action
//
// The script:
//   1. Reads + verifies the delegation envelope (offline, SPEC §8.1).
//   2. Confirms the agent address matches delegation.agent.address.
//   3. Reads the Anthropic `tool_use` block (id, name, input).
//   4. Runs your handler — for this example, an echo handler that
//      returns the input unchanged. Swap in your real implementation
//      where invoiceHandler is wired below.
//   5. Stamps the tool_use into an OC Agent action envelope, signing
//      via stdin so the agent's wallet does the actual BIP-322 work
//      (the agent's private key never enters this process).
//   6. Optionally posts the envelope to fleet.ochk.io/api/actions
//      when --fleet-token + --fleet-project are provided.
//   7. Emits the signed envelope as pretty JSON on stdout.
//
// The resulting envelope is verifiable end-to-end with @orangecheck/agent-core
// or via the public verifier at https://fleet.ochk.io/verify.

import { readFileSync } from 'node:fs';
import { argv, exit, stderr, stdout } from 'node:process';

import { verifyDelegation } from '@orangecheck/agent-core';
import {
    invokeWithStampAndPost,
    type AnthropicToolUse,
    type FleetClient,
} from '@orangecheck/agent-anthropic';

import { makeInteractiveSigner } from './interactive-signer.ts';

interface CliArgs {
    delegationPath: string;
    toolUsePath: string;
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
            'usage: tsx src/index.ts --delegation <path> --tool-use <path> --agent-address <bc1q…> [--scope <scope-string>] [--fleet-token <ock_…> --fleet-project <proj_…>] [--fleet-base-url <https://…>]'
        );
    }
    return {
        delegationPath,
        toolUsePath,
        agentAddress,
        scope: m.get('scope'),
        fleetToken: m.get('fleet-token'),
        fleetProject: m.get('fleet-project'),
        fleetBaseUrl: m.get('fleet-base-url'),
    };
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
    const delegationJson = readFileSync(args.delegationPath, 'utf8');
    const delegation = JSON.parse(delegationJson);
    const verdict = await verifyDelegation({ envelope: delegation });
    if (!verdict.ok) {
        throw new Error(`delegation does not verify: ${verdict.code} · ${verdict.message}`);
    }
    stderr.write(`✓ delegation verified · agent=${delegation.agent.address}\n`);

    // 2. Confirm the agent address matches.
    if (delegation.agent.address !== args.agentAddress) {
        throw new Error(
            `--agent-address ${args.agentAddress} does not match delegation.agent.address ${delegation.agent.address}`
        );
    }

    // 3. Read the Anthropic tool_use block.
    const toolUse: AnthropicToolUse = JSON.parse(
        readFileSync(args.toolUsePath, 'utf8')
    );
    if (!toolUse.id || !toolUse.name || typeof toolUse.input !== 'object') {
        throw new Error(
            'tool_use file must be { id: string, name: string, input: object }'
        );
    }

    // 4. Build the SignerRef. Signing happens via stdin so the agent's
    //    private key never enters this process.
    const signer = makeInteractiveSigner(args.agentAddress);

    // 5. Optional fleet client. When provided, the stamped envelope is
    //    POSTed to fleet.ochk.io/api/actions after the call completes.
    const fleet: FleetClient | undefined = args.fleetToken && args.fleetProject
        ? {
              apiToken: args.fleetToken,
              projectId: args.fleetProject,
              baseUrl: args.fleetBaseUrl,
          }
        : undefined;

    // 6. Stamp + execute + optional post — one call.
    const { result, action, posted } = await invokeWithStampAndPost({
        agent: signer,
        delegation,
        toolUse,
        scopeExercised: args.scope,
        call: invoiceHandler,
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
        stderr.write(
            `· skipped fleet POST (no --fleet-token / --fleet-project)\n`
        );
    }

    stderr.write(`\ntool result:\n`);
    stderr.write(JSON.stringify(result, null, 2) + '\n');

    // 7. Emit the signed envelope on stdout for piping / saving.
    stdout.write(JSON.stringify(action, null, 2) + '\n');
}

main().catch((err) => {
    stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    exit(1);
});
