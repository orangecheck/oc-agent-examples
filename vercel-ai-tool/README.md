# vercel-ai-tool

Wrap a Vercel AI SDK `tool()` call with the `ocTool` primitive from [`@orangecheck/agent-vercel`](https://www.npmjs.com/package/@orangecheck/agent-vercel). Optionally posts to [fleet.ochk.io](https://fleet.ochk.io).

The agent's private key never enters this process — signing happens out-of-band on stdin against a BIP-322-capable wallet.

## Pattern

`ocTool` is a two-step ergonomic composition:

```ts
// 1. wrap your real handler
const invoiceCreate = ocTool({
    verb: 'invoice.create',
    parameters: invoiceSchema,
    execute: async (args) => createImpl(args),
});

// 2. mount inside the AI SDK tool(); inner execute scope-checks +
//    emits envelope + (optionally) POSTs to fleet.
const tools = {
    'invoice.create': tool({
        description: 'create a new invoice',
        parameters: invoiceSchema,
        execute: async (args, { toolCallId }) => {
            const { result } = await invoiceCreate.execute(args, {
                agent, delegation, callId: toolCallId,
                fleet: { apiToken, projectId },
            });
            return result;
        },
    }),
};

await generateText({ model, tools, prompt });
```

The example CLI in this directory exercises step 2 directly so you can see the envelope flow without burning provider tokens.

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

- **Package**: [`@orangecheck/agent-vercel`](https://www.npmjs.com/package/@orangecheck/agent-vercel)
- **AI SDK tool docs**: [sdk.vercel.ai/docs/foundations/tools](https://sdk.vercel.ai/docs/foundations/tools)
- **Managed surface**: [fleet.ochk.io/integrations/vercel-ai](https://fleet.ochk.io/integrations/vercel-ai)
