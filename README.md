# oc-agent-examples

Copy-forkable integrations of [OC Agent](https://github.com/orangecheck/oc-agent-protocol) — the OrangeCheck verb for Bitcoin-bound delegated authority. Each subdirectory is a standalone template — fork, swap in your own delegation, ship.

## What's in here

| Path | Side | Adapter | What it is |
|---|---|---|---|
| [`mcp-wrap/`](./mcp-wrap) | client | [`@orangecheck/agent-mcp`](https://www.npmjs.com/package/@orangecheck/agent-mcp) | Node CLI that wraps an MCP tool invocation in a signed `agent-action` envelope. Reads a `.delegation` file, prints the canonical message for the agent to sign, accepts the BIP-322 signature back on stdin, and emits a verifiable `.action` envelope. |
| [`verifying-mcp-server/`](./verifying-mcp-server) | server | [`@orangecheck/agent-core`](https://www.npmjs.com/package/@orangecheck/agent-core) | Stdio MCP-style server that refuses to execute tool calls unless each one carries a valid `_oc_agent.{delegation, action}` bundle. Uses `verifyAction()` for the SPEC §8.1 chain plus content-hash bind and scope-family pinning. Composable with `mcp-wrap` for end-to-end agent → server flows. |
| [`anthropic-tool-use/`](./anthropic-tool-use) | client | [`@orangecheck/agent-anthropic`](https://www.npmjs.com/package/@orangecheck/agent-anthropic) | Node CLI that wraps an Anthropic Tool Use call. Stamps the `tool_use`, runs the handler, optionally posts the envelope to `fleet.ochk.io/api/actions`. Demonstrates `invokeWithStampAndPost`. |
| [`openai-function-call/`](./openai-function-call) | client | [`@orangecheck/agent-openai`](https://www.npmjs.com/package/@orangecheck/agent-openai) | Node CLI for OpenAI Responses / function-calling. Accepts both raw OpenAI tool_call objects and normalized `OpenAiFunctionCall` shapes. Same `invokeWithStampAndPost` pattern as the Anthropic example. |
| [`vercel-ai-tool/`](./vercel-ai-tool) | client | [`@orangecheck/agent-vercel`](https://www.npmjs.com/package/@orangecheck/agent-vercel) | Node CLI exercising the `ocTool` primitive used inside the Vercel AI SDK's `tool()`. Two-step composition (wrap, then mount) shown end-to-end without burning provider tokens. |
| [`langgraph-tool-node/`](./langgraph-tool-node) | client | [`@orangecheck/agent-langgraph`](https://www.npmjs.com/package/@orangecheck/agent-langgraph) | Node CLI exercising the `ocToolNode` primitive for LangGraph nodes. Includes the `graphState` binding so a verifier can prove which graph state the agent was operating from. |

The MCP pair (`mcp-wrap` + `verifying-mcp-server`) is complementary — run them in sequence to see the full authority loop, end-to-end. The four agent-stack adapters (`anthropic-tool-use`, `openai-function-call`, `vercel-ai-tool`, `langgraph-tool-node`) each demonstrate a single adapter against a fleet.ochk.io project. More examples land as integrations stabilize. Pull requests welcome.

## Shared assumptions

- You have a **Bitcoin wallet** (UniSat, Xverse, Leather, OKX, Phantom) capable of BIP-322 signing for the address that will sign as the agent. Examples here ask you to sign messages externally and paste signatures back — there's no in-process key handling.
- You have a **delegation envelope** issued to your agent address — produce one at [agent.ochk.io/app](https://agent.ochk.io/app) or with [`@orangecheck/agent-cli`](https://npmjs.com/package/@orangecheck/agent-cli).
- You have **Node 20+**.

## How OC Agent decouples

The point of these templates is to show how thin the integration layer is. OC Agent's data lives on Nostr; the delegation, action, and revocation envelopes are self-contained; verification is a pure function over (envelope + Nostr + Bitcoin headers + OTS calendar). Every example here is about three things:

1. Read a verified delegation that grants your agent address a scoped authority.
2. Wrap each operation (an MCP call, an HTTP request, a Lightning payment, etc.) as an `agent-action` envelope citing that delegation.
3. Hand the envelope to whoever needs to verify the action — the receiving service, an audit log, a dispute-resolution party.

Nothing here is load-bearing for the protocol. These are integration patterns, not protocol extensions.

## Running locally

Each subdirectory has its own `README.md`. None of them share dependencies; `cd` in, follow the instructions.

## License

MIT. Fork freely.

## Related

- **Protocol**: [`orangecheck/oc-agent-protocol`](https://github.com/orangecheck/oc-agent-protocol)
- **Web client**: [`agent.ochk.io`](https://agent.ochk.io)
- **Managed surface**: [`fleet.ochk.io`](https://fleet.ochk.io) — operator dashboard, audit pipeline, OC Stamp anchoring
- **Core library**: [`@orangecheck/agent-core`](https://www.npmjs.com/package/@orangecheck/agent-core), [`@orangecheck/agent-signer`](https://www.npmjs.com/package/@orangecheck/agent-signer)
- **Adapters**: [`@orangecheck/agent-mcp`](https://www.npmjs.com/package/@orangecheck/agent-mcp), [`agent-anthropic`](https://www.npmjs.com/package/@orangecheck/agent-anthropic), [`agent-openai`](https://www.npmjs.com/package/@orangecheck/agent-openai), [`agent-vercel`](https://www.npmjs.com/package/@orangecheck/agent-vercel), [`agent-langgraph`](https://www.npmjs.com/package/@orangecheck/agent-langgraph)
- **Webhook verification**: [`@orangecheck/webhook-verify`](https://www.npmjs.com/package/@orangecheck/webhook-verify) — drop-in HMAC-SHA256 timing-safe verifier for inbound fleet webhooks
- **Docs**: [`docs.ochk.io/agent`](https://docs.ochk.io/agent), [`docs.ochk.io/fleet`](https://docs.ochk.io/fleet)
