# anthropic-tool-use

Wrap an Anthropic [Tool Use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) invocation with an OC Agent action envelope.

This is the runnable companion to [`@orangecheck/agent-anthropic`](https://www.npmjs.com/package/@orangecheck/agent-anthropic). The package handles the canonicalization, scope check and BIP-322 stamping; this example wires them into a Node CLI you can fork.

The agent's private key never enters this process. Signing happens out-of-band on stdin against whatever BIP-322-capable wallet you have on hand (UniSat, Xverse, Sparrow, bitcoind's `signmessagewithprivkey`, an HSM…).

## What it does

1. Reads and verifies the delegation envelope offline ([SPEC §8.1](https://github.com/orangecheck/oc-agent-protocol/blob/main/SPEC.md)), including the principal's BIP-322 signature.
2. Confirms `--agent-address` matches `delegation.agent.address`.
3. Reads the Anthropic `tool_use` block (`{ id, name, input }`).
4. Checks the scope, then stamps the `tool_use` into an OC Agent action envelope. It prints the message to sign and reads the signature from stdin, so the wallet does the BIP-322 work. An out-of-scope call stops here, before your handler runs.
5. Runs your handler. The included `invoiceHandler` is an echo stub. Replace it with your real tool.
6. Writes the signed envelope as JSON to stdout. Log lines go to stderr.

## Install

```bash
yarn install
```

## Run

You need:

- a delegation envelope issued to your agent address, granting `anthropic:tool(name=invoice.create)` or a broader `anthropic:tool` scope. Produce one at [agent.ochk.io/app](https://agent.ochk.io/app), or in code with `createDelegation` from [`@orangecheck/agent-signer`](https://www.npmjs.com/package/@orangecheck/agent-signer).
- an Anthropic `tool_use` block to stamp. See [`example-tool-use.json`](./example-tool-use.json) for the shape.
- a BIP-322-capable wallet for the agent address.

```bash
yarn -s start \
  --delegation ./my-agent.delegation \
  --tool-use ./example-tool-use.json \
  --agent-address bc1qexample… \
  > stamped.action
```

Use `yarn -s` (silent). Plain `yarn start` prints its own banner to stdout and corrupts the envelope file.

### Override the scope

By default the adapter exercises the tightest scope for the tool: `anthropic:tool(name="<tool>")`, the name as a quoted value. Pass `--scope` to exercise a different one. It must be a sub-scope of a scope the delegation grants, or the adapter refuses before anything is signed:

```bash
yarn -s start \
  --delegation ./my-agent.delegation \
  --tool-use ./example-tool-use.json \
  --agent-address bc1qexample… \
  --scope 'anthropic:tool(name=invoice.delete)'
# error: stampToolUse: scope_exercised (anthropic:tool(name=invoice.delete)) is not a sub-scope of any granted scope (anthropic:tool(name=invoice.create))
```

## Verifying the output

The envelope is self-contained. Anyone holding the delegation can audit it offline with `verifyActionAsOfSignedAt` from [`@orangecheck/agent-core`](https://www.npmjs.com/package/@orangecheck/agent-core). Passing `content` also proves the action covers this exact `tool_use`. Save this as `verify.mjs` in this directory:

```js
import { readFileSync } from 'node:fs';
import { canonicalizeToolUse } from '@orangecheck/agent-anthropic';
import { verifyActionAsOfSignedAt } from '@orangecheck/agent-core';
import { verifySignature } from '@orangecheck/bip322';

const [delegationPath, actionPath, toolUsePath] = process.argv.slice(2);
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const verdict = await verifyActionAsOfSignedAt({
    delegation: read(delegationPath),
    action: read(actionPath),
    content: canonicalizeToolUse(read(toolUsePath)),
    verifyBip322: async (msg, sig, addr) => verifySignature(addr, msg, sig),
    skipRevocationCheck: true, // or pass `revocations` fetched from Nostr kind-30085 by "#t": [delegation id]
});
console.log(
    verdict.ok
        ? `ok · ${verdict.id} · as of ${verdict.asOf.signedAt}${verdict.asOf.anchored ? '' : ', the agent’s own claim'}`
        : `${verdict.code}: ${verdict.message}`
);
process.exit(verdict.ok ? 0 : 1);
```

```bash
node verify.mjs ./my-agent.delegation ./stamped.action ./example-tool-use.json
# ok · <action id> · as of <signed_at>, the agent’s own claim
```

This is an audit: it checks the action as of its own `signed_at`, which the agent chose, unless an OTS anchor fixes it. A service deciding whether to act on a call uses `verifyAction` instead, which also needs the delegation in force now, the action signed within 120 seconds, and each action used once ([MCP servers](https://ochk.io/docs/agent/mcp)).

Change one byte of the `tool_use` input and it fails with `E_BAD_ACTION_STAMP`. Change one byte of the envelope and it fails with `E_BAD_ID`.

`npx @orangecheck/agent-cli verify` on a `[delegation, action]` array, and [agent.ochk.io/app/inspect](https://agent.ochk.io/app/inspect), verify the envelope as well. Only the library call above also checks it against the tool input.

## Where this fits in your real Claude integration

Your production code would do something like:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { invokeWithStamp } from '@orangecheck/agent-anthropic';

const anthropic = new Anthropic();
const message = await anthropic.messages.create({
    model: 'claude-opus-5-5',
    tools,
    max_tokens: 16000,
    messages: [{ role: 'user', content: 'invoice acme for $14.20' }],
});

for (const block of message.content) {
    if (block.type !== 'tool_use') continue;
    const { result, action } = await invokeWithStamp({
        agent: signer,        // your SignerRef (wallet, HSM, …)
        delegation,           // active OC Agent delegation
        toolUse: { id: block.id, name: block.name, input: block.input as Record<string, unknown> },
        call: yourToolHandler,
    });
    // hand `result` back to Claude as the tool_result content block,
    // and ship `action` to whoever needs to verify the call
}
```

The library checks the scope before your handler runs, so out-of-scope calls are refused before any side effect. The envelope comes back with the result, in the same shape as every other adapter in the family.

## License

MIT. Fork freely.

## Related

- **Package**: [`@orangecheck/agent-anthropic`](https://www.npmjs.com/package/@orangecheck/agent-anthropic) · [source](https://github.com/orangecheck/oc-packages/tree/main/agent-anthropic)
- **Anthropic Tool Use docs**: [platform.claude.com/docs/en/agents-and-tools/tool-use/overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
- **OC Agent protocol**: [orangecheck/oc-agent-protocol](https://github.com/orangecheck/oc-agent-protocol)
- **Docs**: [ochk.io/docs/agent](https://ochk.io/docs/agent)
