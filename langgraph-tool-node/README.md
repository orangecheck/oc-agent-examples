# langgraph-tool-node

Wrap a [LangGraph](https://docs.langchain.com/oss/javascript/langgraph/overview) tool node with the `ocToolNode` primitive from [`@orangecheck/agent-langgraph`](https://www.npmjs.com/package/@orangecheck/agent-langgraph).

The agent's private key never enters this process. Signing happens out-of-band on stdin against a BIP-322-capable wallet.

## Pattern

```ts
import { StateGraph } from '@langchain/langgraph';
import { ocToolNode } from '@orangecheck/agent-langgraph';

const createInvoice = ocToolNode({
    verb: 'invoice.create',
    execute: async (args) => createImpl(args),
});

const graph = new StateGraph(MyState)
    .addNode('createInvoice', async (state) => {
        const { result, action } = await createInvoice.execute(state.invoice, {
            agent, delegation, callId: state.runId, graphState: state,
        });
        await auditLog.append(action);
        return { ...state, lastResult: result, lastReceipt: action.id };
    })
    // … more nodes, conditional edges, etc.
```

`ocToolNode` hashes `graphState` into the stamped bytes (`graph_state_hash`), so a verifier holding the persisted graph snapshot can prove which state the agent acted from. That is the difference from the per-call adapters for Anthropic, OpenAI and the Vercel AI SDK.

This example exercises a single node, so you can see the envelope flow without standing up a real graph. It passes the tool args as `graphState`.

## Run

You need a delegation issued to your agent address that grants `langgraph:tool(verb=invoice.create)` or a broader `langgraph:tool` scope. Produce one at [agent.ochk.io/app](https://agent.ochk.io/app), or in code with `createDelegation` from [`@orangecheck/agent-signer`](https://www.npmjs.com/package/@orangecheck/agent-signer).

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

Anyone holding the delegation and the graph state can verify the envelope offline with `verifyAction` from [`@orangecheck/agent-core`](https://www.npmjs.com/package/@orangecheck/agent-core). Passing `content` also proves the action covers this exact call and state. Save this as `verify.mjs` in this directory:

```js
import { readFileSync } from 'node:fs';
import { verifyAction } from '@orangecheck/agent-core';
import { canonicalizeToolCall, graphStateHash } from '@orangecheck/agent-langgraph';
import { verifySignature } from '@orangecheck/bip322';

const [delegationPath, actionPath, toolCallPath] = process.argv.slice(2);
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const { callId, verb, args } = read(toolCallPath);
const graphState = args; // this example stamps the args as the graph state

const verdict = await verifyAction({
    delegation: read(delegationPath),
    action: read(actionPath),
    content: canonicalizeToolCall({ callId, verb, args, graphStateHash: graphStateHash(graphState) }),
    verifyBip322: async (msg, sig, addr) => verifySignature(addr, msg, sig),
    skipRevocationCheck: true, // or pass `revocations` fetched from Nostr kind-30085 by #delegation
});
console.log(verdict.ok ? `ok · ${verdict.id}` : `${verdict.code}: ${verdict.message}`);
process.exit(verdict.ok ? 0 : 1);
```

```bash
node verify.mjs ./my-agent.delegation ./stamped.action ./example-tool-call.json
# ok · <action id>
```

Change one byte of the args or the graph state and it fails with `E_BAD_ACTION_STAMP`. Change one byte of the envelope and it fails with `E_BAD_ID`.

`npx @orangecheck/agent-cli verify` on a `[delegation, action]` array, and [agent.ochk.io/app/inspect](https://agent.ochk.io/app/inspect), verify the envelope as well. Only the library call above also checks it against the tool input.

## License

MIT.

## Related

- **Package**: [`@orangecheck/agent-langgraph`](https://www.npmjs.com/package/@orangecheck/agent-langgraph) · [source](https://github.com/orangecheck/oc-packages/tree/main/agent-langgraph)
- **LangGraph docs**: [docs.langchain.com/oss/javascript/langgraph/overview](https://docs.langchain.com/oss/javascript/langgraph/overview)
- **OC Agent protocol**: [orangecheck/oc-agent-protocol](https://github.com/orangecheck/oc-agent-protocol)
- **Docs**: [ochk.io/docs/agent](https://ochk.io/docs/agent)
