# langgraph-tool-node

Wrap a [LangGraph](https://langchain-ai.github.io/langgraph/) tool node with the `ocToolNode` primitive from [`@orangecheck/agent-langgraph`](https://www.npmjs.com/package/@orangecheck/agent-langgraph). Optionally posts to [fleet.ochk.io](https://fleet.ochk.io).

The agent's private key never enters this process — signing happens out-of-band on stdin against a BIP-322-capable wallet.

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
        const { result, posted } = await createInvoice.execute(state.invoice, {
            agent, delegation, callId: state.runId,
            fleet: { apiToken, projectId },
        });
        return { ...state, lastReceipt: posted?.id };
    })
    // … more nodes, conditional edges, etc.
```

This example exercises a single node so you can see the envelope flow without standing up a real graph.

> **Graph-state hashing + replay verification** are the differentiator for the LangGraph adapter (vs the per-call adapters for Anthropic/OpenAI/Vercel-AI). v0.2.0 ships the per-call envelope shape; full graph-state replay lands behind a design-partner ask.

## Run

```bash
yarn install

# offline stamp
yarn start \
  --delegation ./my-agent.delegation \
  --tool-call ./example-tool-call.json \
  --agent-address bc1qexample…

# stamp + POST to fleet.ochk.io
yarn start \
  --delegation ./my-agent.delegation \
  --tool-call ./example-tool-call.json \
  --agent-address bc1qexample… \
  --fleet-token ock_… \
  --fleet-project proj_…
```

## License

MIT.

## Related

- **Package**: [`@orangecheck/agent-langgraph`](https://www.npmjs.com/package/@orangecheck/agent-langgraph)
- **LangGraph docs**: [langchain-ai.github.io/langgraph](https://langchain-ai.github.io/langgraph/)
- **Managed surface**: [fleet.ochk.io/integrations/langgraph](https://fleet.ochk.io/integrations/langgraph)
