# openai-function-call

Wrap an OpenAI function call (Responses API or Chat Completions tool path) with an OC Agent action envelope.

Runnable companion to [`@orangecheck/agent-openai`](https://www.npmjs.com/package/@orangecheck/agent-openai). The agent's private key never enters this process. Signing happens out-of-band on stdin against a BIP-322-capable wallet.

## What it does

1. Reads and verifies the delegation envelope offline, including the principal's BIP-322 signature.
2. Confirms `--agent-address` matches `delegation.agent.address`.
3. Checks the scope, then stamps the function call into an OC Agent action envelope. It prints the message to sign and reads the signature from stdin. An out-of-scope call stops here, before your handler runs.
4. Runs your handler (an echo stub here).
5. Writes the signed envelope as JSON to stdout. Log lines go to stderr.

## Run

You need a delegation issued to your agent address that grants `openai:function(name=invoice.create)` or a broader `openai:function` scope. Produce one at [agent.ochk.io/app](https://agent.ochk.io/app), or in code with `createDelegation` from [`@orangecheck/agent-signer`](https://www.npmjs.com/package/@orangecheck/agent-signer).

```bash
yarn install

yarn -s start \
  --delegation ./my-agent.delegation \
  --call ./example-call.json \
  --agent-address bc1qexample… \
  > stamped.action
```

Use `yarn -s` (silent). Plain `yarn start` prints its own banner to stdout and corrupts the envelope file. Pass `--scope <scope>` to exercise a scope other than the default `openai:function(name=<name>)`; it must be a sub-scope of a granted scope.

The `--call` file can be any of:

- a Chat Completions tool call: `{ "id", "type": "function", "function": { "name", "arguments": "<json string>" } }`
- a Responses API function call: `{ "type": "function_call", "call_id", "name", "arguments": "<json string>" }`
- a normalized `OpenAiFunctionCall`: `{ "id", "name", "arguments": { … } }`. See [`example-call.json`](./example-call.json).

`@orangecheck/agent-openai` normalizes all three to `{ id, name, arguments }` before hashing, so the same call stamps the same `content.hash` whichever shape it arrives in.

## Verifying the output

Anyone holding the delegation can verify the envelope offline with `verifyAction` from [`@orangecheck/agent-core`](https://www.npmjs.com/package/@orangecheck/agent-core). Passing `content` also proves the action covers this exact call. Save this as `verify.mjs` in this directory:

```js
import { readFileSync } from 'node:fs';
import { verifyAction } from '@orangecheck/agent-core';
import { canonicalizeFunctionCall, parseFunctionCall } from '@orangecheck/agent-openai';
import { verifySignature } from '@orangecheck/bip322';

const [delegationPath, actionPath, callPath] = process.argv.slice(2);
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const verdict = await verifyAction({
    delegation: read(delegationPath),
    action: read(actionPath),
    content: canonicalizeFunctionCall(parseFunctionCall(read(callPath))),
    verifyBip322: async (msg, sig, addr) => verifySignature(addr, msg, sig),
    skipRevocationCheck: true, // or pass `revocations` fetched from Nostr kind-30085 by #delegation
});
console.log(verdict.ok ? `ok · ${verdict.id}` : `${verdict.code}: ${verdict.message}`);
process.exit(verdict.ok ? 0 : 1);
```

```bash
node verify.mjs ./my-agent.delegation ./stamped.action ./example-call.json
# ok · <action id>
```

Change one byte of the call's arguments and it fails with `E_BAD_ACTION_STAMP`. Change one byte of the envelope and it fails with `E_BAD_ID`.

`npx @orangecheck/agent-cli verify` on a `[delegation, action]` array, and [agent.ochk.io/app/inspect](https://agent.ochk.io/app/inspect), verify the envelope as well. Only the library call above also checks it against the tool input.

## License

MIT.

## Related

- **Package**: [`@orangecheck/agent-openai`](https://www.npmjs.com/package/@orangecheck/agent-openai) · [source](https://github.com/orangecheck/oc-packages/tree/main/agent-openai)
- **OpenAI function-calling docs**: [developers.openai.com/api/docs/guides/function-calling](https://developers.openai.com/api/docs/guides/function-calling)
- **OC Agent protocol**: [orangecheck/oc-agent-protocol](https://github.com/orangecheck/oc-agent-protocol)
- **Docs**: [ochk.io/docs/agent](https://ochk.io/docs/agent)
