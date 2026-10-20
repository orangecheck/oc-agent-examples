# vercel-ai-tool

Wrap a Vercel AI SDK `tool()` call with the `ocTool` primitive from [`@orangecheck/agent-vercel`](https://www.npmjs.com/package/@orangecheck/agent-vercel).

The agent's private key never enters this process. Signing happens out-of-band on stdin against a BIP-322-capable wallet.

## Pattern

`ocTool` is a two-step composition:

```ts
// 1. wrap your real handler
const invoiceCreate = ocTool({
    verb: 'invoice.create',
    parameters: invoiceSchema,
    execute: async (args) => createImpl(args),
});

// 2. mount inside the AI SDK tool(); the wrapped execute checks the scope,
//    stamps the call, then runs your handler.
const tools = {
    'invoice.create': tool({
        description: 'create a new invoice',
        parameters: invoiceSchema,
        execute: async (args, { toolCallId }) => {
            const { result, action } = await invoiceCreate.execute(args, {
                agent, delegation, callId: toolCallId,
            });
            await auditLog.append(action);
            return result;
        },
    }),
};

await generateText({ model, tools, prompt });
```

The example CLI in this directory exercises step 2 directly, so you can see the envelope flow without burning provider tokens.

## Run

You need a delegation issued to your agent address that grants `vercel:tool(verb=invoice.create)` or a broader `vercel:tool` scope. Produce one at [agent.ochk.io/app](https://agent.ochk.io/app), or in code with `createDelegation` from [`@orangecheck/agent-signer`](https://www.npmjs.com/package/@orangecheck/agent-signer).

```bash
yarn install

yarn -s start \
  --delegation ./my-agent.delegation \
  --tool-call ./example-tool-call.json \
  --agent-address bc1qexample… \
  > stamped.action
```

Use `yarn -s` (silent). Plain `yarn start` prints its own banner to stdout and corrupts the envelope file. The CLI verifies the delegation (including the principal's BIP-322 signature), prints the message to sign, reads the signature from stdin, and writes the signed envelope to stdout.

## Verifying the output

Anyone holding the delegation can verify the envelope offline with `verifyAction` from [`@orangecheck/agent-core`](https://www.npmjs.com/package/@orangecheck/agent-core). Passing `content` also proves the action covers this exact call. Save this as `verify.mjs` in this directory:

```js
import { readFileSync } from 'node:fs';
import { verifyAction } from '@orangecheck/agent-core';
import { canonicalizeToolCall } from '@orangecheck/agent-vercel';
import { verifySignature } from '@orangecheck/bip322';

const [delegationPath, actionPath, toolCallPath] = process.argv.slice(2);
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const { callId, verb, args } = read(toolCallPath);

const verdict = await verifyAction({
    delegation: read(delegationPath),
    action: read(actionPath),
    content: canonicalizeToolCall({ callId, verb, args }),
    verifyBip322: async (msg, sig, addr) => verifySignature(addr, msg, sig),
    skipRevocationCheck: true, // or pass `revocations` fetched from Nostr kind-30085 by "#t": [delegation id]
});
console.log(verdict.ok ? `ok · ${verdict.id}` : `${verdict.code}: ${verdict.message}`);
process.exit(verdict.ok ? 0 : 1);
```

```bash
node verify.mjs ./my-agent.delegation ./stamped.action ./example-tool-call.json
# ok · <action id>
```

Change one byte of the call's args and it fails with `E_BAD_ACTION_STAMP`. Change one byte of the envelope and it fails with `E_BAD_ID`.

`npx @orangecheck/agent-cli verify` on a `[delegation, action]` array, and [agent.ochk.io/app/inspect](https://agent.ochk.io/app/inspect), verify the envelope as well. Only the library call above also checks it against the tool input.

## License

MIT.

## Related

- **Package**: [`@orangecheck/agent-vercel`](https://www.npmjs.com/package/@orangecheck/agent-vercel) · [source](https://github.com/orangecheck/oc-packages/tree/main/agent-vercel)
- **AI SDK tool docs**: [ai-sdk.dev/docs/foundations/tools](https://ai-sdk.dev/docs/foundations/tools)
- **OC Agent protocol**: [orangecheck/oc-agent-protocol](https://github.com/orangecheck/oc-agent-protocol)
- **Docs**: [ochk.io/docs/agent](https://ochk.io/docs/agent)
