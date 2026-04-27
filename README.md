# oc-agent-examples

Copy-forkable integrations of [OC Agent](https://github.com/orangecheck/oc-agent-protocol) — the OrangeCheck verb for Bitcoin-bound delegated authority. Each subdirectory is a standalone template — fork, swap in your own delegation, ship.

## What's in here

| Path | Side | What it is |
|---|---|---|
| [`mcp-wrap/`](./mcp-wrap) | client | A Node CLI that wraps an MCP tool invocation in a signed `agent-action` envelope. Reads a `.delegation` file, prints the canonical message for the agent to sign in their own wallet, accepts the BIP-322 signature back on stdin, and emits a verifiable `.action` envelope. The agent's private key never leaves the wallet. |
| [`verifying-mcp-server/`](./verifying-mcp-server) | server | A stdio MCP-style server that refuses to execute tool calls unless each one carries a valid `_oc_agent.{delegation, action}` bundle. Uses `verifyAction()` for the SPEC §8.1 chain plus content-hash bind and scope-family pinning. Composable with `mcp-wrap` for end-to-end agent → server flows. |

The two examples are complementary: `mcp-wrap` produces what `verifying-mcp-server` consumes. Run them in sequence to see the full authority loop. More examples land here as integrations stabilize. Pull requests welcome.

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
- **Library**: [`@orangecheck/agent-core`](https://npmjs.com/package/@orangecheck/agent-core), [`@orangecheck/agent-signer`](https://npmjs.com/package/@orangecheck/agent-signer)
- **MCP integration**: [`@orangecheck/agent-mcp`](https://npmjs.com/package/@orangecheck/agent-mcp)
- **Docs**: [`docs.ochk.io/agent`](https://docs.ochk.io/agent)
