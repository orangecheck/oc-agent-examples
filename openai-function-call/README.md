# openai-function-call

Wrap an OpenAI function call (Responses API or Chat Completions tool path) with an OC Agent action envelope, optionally posting to [fleet.ochk.io](https://fleet.ochk.io).

Runnable companion to [`@orangecheck/agent-openai`](https://www.npmjs.com/package/@orangecheck/agent-openai). The agent's private key never enters this process — signing happens out-of-band on stdin against a BIP-322-capable wallet.

## Run

```bash
yarn install

# offline stamp
yarn start \
  --delegation ./my-agent.delegation \
  --call ./example-call.json \
  --agent-address bc1qexample…

# stamp + POST to fleet.ochk.io
yarn start \
  --delegation ./my-agent.delegation \
  --call ./example-call.json \
  --agent-address bc1qexample… \
  --fleet-token ock_… \
  --fleet-project proj_…
```

The script accepts both:

- a raw OpenAI tool_call object (what comes off `response.output[*]` or `response.choices[0].message.tool_calls[*]`)
- a normalized `OpenAiFunctionCall` (`{ name, arguments }`) — see [`example-call.json`](./example-call.json)

`@orangecheck/agent-openai` handles the parsing — pass either shape and the package figures it out.

## License

MIT.

## Related

- **Package**: [`@orangecheck/agent-openai`](https://www.npmjs.com/package/@orangecheck/agent-openai)
- **OpenAI function-calling docs**: [platform.openai.com/docs/guides/function-calling](https://platform.openai.com/docs/guides/function-calling)
- **Managed surface**: [fleet.ochk.io/integrations/openai](https://fleet.ochk.io/integrations/openai)
