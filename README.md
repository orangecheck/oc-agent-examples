# oc-agent-examples

Copy-forkable integrations of [OC Agent](https://github.com/orangecheck/oc-agent-protocol) — the orangecheck verb for Bitcoin-bound delegated authority. Each subdirectory is a standalone template — fork, swap in your own delegation, ship.

## What's in here

| Path | Side | Adapter | What it is |
|---|---|---|---|
| [`mcp-wrap/`](./mcp-wrap) | client | [`@orangecheck/agent-mcp`](https://www.npmjs.com/package/@orangecheck/agent-mcp) | Node CLI that wraps an MCP tool invocation in a signed `agent-action` envelope. Reads a `.delegation` file, prints the message for the agent to sign, accepts the BIP-322 signature back on stdin, and emits a verifiable `.action` envelope. |
| [`verifying-mcp-server/`](./verifying-mcp-server) | server | [`@orangecheck/agent-core`](https://www.npmjs.com/package/@orangecheck/agent-core) | Stdio MCP-style server that refuses to execute tool calls unless each one carries a valid `_oc_agent.{delegation, action}` bundle. Checks both BIP-322 signatures and the SPEC §8 chain with `verifyAction()`, binds the action to the exact invocation, and pins the scope to this server and tool. Composable with `mcp-wrap` for end-to-end agent → server flows. |
| [`anthropic-tool-use/`](./anthropic-tool-use) | client | [`@orangecheck/agent-anthropic`](https://www.npmjs.com/package/@orangecheck/agent-anthropic) | Node CLI that wraps an Anthropic Tool Use call. Checks the scope, stamps the `tool_use`, runs the handler, and emits the signed envelope. Demonstrates `invokeWithStamp`. |
| [`openai-function-call/`](./openai-function-call) | client | [`@orangecheck/agent-openai`](https://www.npmjs.com/package/@orangecheck/agent-openai) | Node CLI for OpenAI Responses / function-calling. Accepts raw Chat Completions and Responses tool calls as well as normalized `OpenAiFunctionCall` shapes. Same `invokeWithStamp` pattern as the Anthropic example. |
| [`vercel-ai-tool/`](./vercel-ai-tool) | client | [`@orangecheck/agent-vercel`](https://www.npmjs.com/package/@orangecheck/agent-vercel) | Node CLI exercising the `ocTool` primitive used inside the Vercel AI SDK's `tool()`. Two-step composition (wrap, then mount) shown end-to-end without burning provider tokens. |
| [`langgraph-tool-node/`](./langgraph-tool-node) | client | [`@orangecheck/agent-langgraph`](https://www.npmjs.com/package/@orangecheck/agent-langgraph) | Node CLI exercising the `ocToolNode` primitive for LangGraph nodes. Hashes the graph state into the stamp so a verifier can prove which state the agent was operating from. |

The MCP pair (`mcp-wrap` + `verifying-mcp-server`) is complementary — run them in sequence to see the full authority loop, end-to-end. The four agent-stack adapters (`anthropic-tool-use`, `openai-function-call`, `vercel-ai-tool`, `langgraph-tool-node`) each demonstrate a single adapter. Every example emits a signed envelope; what you do with it (attach it to the tool result, append it to an audit log, publish it to Nostr) is up to you. More examples land as integrations stabilize. Pull requests welcome.

## Shared assumptions

- You have a **Bitcoin wallet** (UniSat, Xverse, Leather, OKX, Phantom, Sparrow, bitcoind, an HSM) capable of BIP-322 signing for the address that will sign as the agent. The client examples print the message to sign and read the signature back on stdin, so the agent's key never enters the process.
- You have a **delegation envelope** issued to your agent address. Produce one at [agent.ochk.io/app](https://agent.ochk.io/app), or in code with `createDelegation` from [`@orangecheck/agent-signer`](https://www.npmjs.com/package/@orangecheck/agent-signer).
- You have **Node 20+** and **yarn 1**. Run the CLIs with `yarn -s start` so yarn's banner stays out of stdout.

## Verifying an action

Every envelope these examples emit is self-contained and verifies offline with `verifyAction` from [`@orangecheck/agent-core`](https://www.npmjs.com/package/@orangecheck/agent-core), using [`@orangecheck/bip322`](https://www.npmjs.com/package/@orangecheck/bip322) for the signatures. The four agent-stack READMEs each include a `verify.mjs` you can run as-is; `verifying-mcp-server` shows the same check inside a server.

- Every scope the examples use is in agent-core's registry (`mcp:invoke`, and since agent-core 2.5.0 `anthropic:tool`, `openai:function`, `vercel:tool` and `langgraph:tool`), so the default strict mode accepts them. `npx @orangecheck/agent-cli verify` on a `[delegation, action]` array and the browser verifier at [agent.ochk.io/app/inspect](https://agent.ochk.io/app/inspect) work for all of them.
- The examples pass `skipRevocationCheck: true` to stay offline. In production, fetch kind-30085 revocations from Nostr with `"#t": [delegation id]` and pass them as `revocations`. A relay that sends `CLOSED`, errors or times out has not answered, so its silence is not "not revoked" (OC Agent SPEC §10.4).

## How OC Agent decouples

The point of these templates is to show how thin the integration layer is. OC Agent's data lives on Nostr; the delegation, action, and revocation envelopes are self-contained; verification is a pure function over (envelope + Nostr + Bitcoin headers + OTS calendar). Every example here is about three things:

1. Read a verified delegation that grants your agent address a scoped authority.
2. Wrap each operation (an MCP call, an HTTP request, a Lightning payment, etc.) as an `agent-action` envelope citing that delegation.
3. Hand the envelope to whoever needs to verify the action — the receiving service, an audit log, a dispute-resolution party.

Nothing here is load-bearing for the protocol. These are integration patterns, not protocol extensions.

## Running locally

Each subdirectory has its own `README.md`. None of them share dependencies; `cd` in, `yarn install`, follow the instructions.

## License

MIT. Fork freely.

## Related

- **Protocol**: [`orangecheck/oc-agent-protocol`](https://github.com/orangecheck/oc-agent-protocol)
- **Web client**: [`agent.ochk.io`](https://agent.ochk.io) — issue, sign, revoke and [inspect](https://agent.ochk.io/app/inspect) envelopes in the browser
- **Core library**: [`@orangecheck/agent-core`](https://www.npmjs.com/package/@orangecheck/agent-core), [`@orangecheck/agent-signer`](https://www.npmjs.com/package/@orangecheck/agent-signer), [`@orangecheck/bip322`](https://www.npmjs.com/package/@orangecheck/bip322)
- **CLI**: [`@orangecheck/agent-cli`](https://www.npmjs.com/package/@orangecheck/agent-cli) — verify, inspect and canonicalize envelopes from the shell
- **Adapters**: [`@orangecheck/agent-mcp`](https://www.npmjs.com/package/@orangecheck/agent-mcp), [`agent-anthropic`](https://www.npmjs.com/package/@orangecheck/agent-anthropic), [`agent-openai`](https://www.npmjs.com/package/@orangecheck/agent-openai), [`agent-vercel`](https://www.npmjs.com/package/@orangecheck/agent-vercel), [`agent-langgraph`](https://www.npmjs.com/package/@orangecheck/agent-langgraph)
- **Docs**: [`ochk.io/docs/agent`](https://ochk.io/docs/agent)
