# anthropic-tool-use

Wrap an Anthropic [Tool Use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use) invocation with an OC Agent action envelope, optionally posting to [fleet.ochk.io](https://fleet.ochk.io).

This is the runnable companion to [`@orangecheck/agent-anthropic`](https://www.npmjs.com/package/@orangecheck/agent-anthropic). The package handles the canonicalization, scope check, BIP-322 stamping, and fleet POST; this example wires them into a Node CLI you can fork.

The agent's private key never enters this process — signing happens out-of-band on stdin against whatever BIP-322-capable wallet you have on hand (UniSat, Xverse, Sparrow, bitcoind's `signmessagewithprivkey`, an HSM…).

## What it does

1. Reads + verifies the delegation envelope (offline, [SPEC §8.1](https://github.com/orangecheck/oc-agent-protocol/blob/main/SPEC.md)).
2. Confirms `--agent-address` matches `delegation.agent.address`.
3. Reads the Anthropic `tool_use` block (`{ id, name, input }`).
4. Runs your handler. The included `invoiceHandler` is an echo stub — replace it with your real tool implementation.
5. Stamps the `tool_use` into an OC Agent action envelope (kind 30084, `oc-agent-act:` d-tag), signing via stdin so the wallet does the BIP-322 work.
6. Optionally POSTs the envelope to `fleet.ochk.io/api/actions` when `--fleet-token` + `--fleet-project` are supplied.
7. Emits the signed envelope as pretty JSON on stdout.

## Install

```bash
yarn install
```

## Run

You'll need:

- a delegation envelope issued to your agent address — produce one at [agent.ochk.io/app](https://agent.ochk.io/app), or with [`@orangecheck/agent-cli`](https://www.npmjs.com/package/@orangecheck/agent-cli), or via the [fleet operator dashboard at /agents/new](https://fleet.ochk.io/agents/new)
- an Anthropic `tool_use` block to stamp — see [`example-tool-use.json`](./example-tool-use.json) for the shape
- a BIP-322-capable wallet for the agent address (UniSat, Xverse, Sparrow, bitcoind, …)

### Stamp without posting (offline)

```bash
yarn start \
  --delegation ./my-agent.delegation \
  --tool-use ./example-tool-use.json \
  --agent-address bc1qexample… \
  > stamped.action
```

### Stamp + POST to fleet.ochk.io

Get an API token from [fleet.ochk.io/settings](https://fleet.ochk.io/settings) § 03 and a project id from [fleet.ochk.io/dashboard](https://fleet.ochk.io/dashboard).

```bash
yarn start \
  --delegation ./my-agent.delegation \
  --tool-use ./example-tool-use.json \
  --agent-address bc1qexample… \
  --fleet-token ock_… \
  --fleet-project proj_… \
  > stamped.action
```

The script writes log lines to stderr, the signed envelope to stdout. When fleet posting succeeds, the dashboard's audit log shows the action within seconds.

### Override the scope

By default the adapter picks the tightest admissible scope for the tool: `anthropic:tool(name=<tool>)`. If your delegation grants a coarser scope, override:

```bash
yarn start \
  --scope 'anthropic:tool(name=*)' \
  ...
```

The adapter still rejects scopes that aren't a sub-scope of anything in `delegation.scopes`.

## Verifying the output

The emitted envelope is self-contained and verifiable offline:

```bash
# CLI
npx @orangecheck/agent-cli verify ./stamped.action

# library
import { verifyAction } from '@orangecheck/agent-core';
const verdict = await verifyAction(JSON.parse(envelope));

# web
open https://fleet.ochk.io/verify
```

## Where this fits in your real Claude integration

Your production code would do something like:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { invokeWithStampAndPost } from '@orangecheck/agent-anthropic';

const anthropic = new Anthropic();
const stream = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    tools,
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'invoice acme for $14.20' }],
});

for await (const event of stream) {
    if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        const toolUse = event.content_block;
        const { result, posted } = await invokeWithStampAndPost({
            agent: signer,        // your SignerRef (wallet, HSM, …)
            delegation,           // active OC Agent delegation
            toolUse,              // the anthropic tool_use block
            call: yourToolHandler,
            fleet: { apiToken, projectId },
        });
        // hand `result` back to Claude as the tool_result content block
    }
}
```

The library does scope-checking before your handler runs (so out-of-scope calls are refused before any side effect) and emits the OC Agent envelope after — same shape as every other adapter in the family.

## License

MIT. Fork freely.

## Related

- **Package**: [`@orangecheck/agent-anthropic`](https://www.npmjs.com/package/@orangecheck/agent-anthropic) · [source](https://github.com/orangecheck/oc-packages/tree/main/agent-anthropic)
- **Anthropic Tool Use docs**: [docs.anthropic.com/en/docs/build-with-claude/tool-use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
- **OC Agent protocol**: [orangecheck/oc-agent-protocol](https://github.com/orangecheck/oc-agent-protocol)
- **Managed surface**: [fleet.ochk.io/integrations/anthropic](https://fleet.ochk.io/integrations/anthropic)
- **Family docs**: [docs.ochk.io/fleet/integrations](https://docs.ochk.io/fleet/integrations)
