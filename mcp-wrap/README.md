# mcp-wrap

> Wrap an MCP tool invocation in a signed `agent-action` envelope, without ever holding the agent's private key.

This example takes the smallest possible step from "an MCP server tool was called" to "every call is a signed, scope-constrained, verifiable OC Agent action." It's a Node CLI that:

1. Reads a delegation envelope (the principal's grant of scoped authority).
2. Reads an MCP invocation as JSON (`{ server, tool, arguments }`).
3. Verifies the delegation offline.
4. Builds the canonical action message and prints it to stderr.
5. Waits for you to paste the BIP-322 signature back on stdin (signed in the agent's wallet).
6. Emits a fully-formed `agent-action` envelope to stdout.

The agent's secret key never enters this process. The wrapper composes with **any** BIP-322-capable signer: a hardware wallet, an HSM, `bitcoin-cli signmessage`, a remote signing service.

## Install

```bash
cd mcp-wrap
yarn install   # or npm install
```

## What you need

- A delegation envelope issued **to your agent address**. Produce one at [agent.ochk.io/app](https://agent.ochk.io/app) and download with `.delegation`. Store it locally.
- The agent's Bitcoin address.
- A BIP-322-capable wallet for that address (UniSat, Xverse, Leather, OKX, Phantom, Sparrow's "Sign Message", `bitcoin-cli signmessagewithprivkey`, an HSM, …).
- An MCP invocation as JSON. See [`example-invocation.json`](./example-invocation.json) for the shape.

## Usage

```bash
yarn start \
  --delegation ./agent.delegation \
  --invocation ./example-invocation.json \
  --agent-address bc1qagent… \
  > out.action
```

The script will:

1. Verify your delegation offline and print a summary on stderr (id, scopes, expiry).
2. Print the canonical message that needs signing — copy it into your wallet's "Sign Message" UI.
3. Read the resulting base64 signature from stdin.
4. Write the signed action envelope to stdout.

Pipe `out.action` to whoever needs to verify the call — the receiving service, an audit log, a dispute-resolution party. Anyone with [`@orangecheck/agent-core`](https://npmjs.com/package/@orangecheck/agent-core) can verify it offline. The web inspector at [agent.ochk.io/inspect](https://agent.ochk.io/inspect) accepts a `[delegation, action]` array directly.

## Optional: explicit scope

By default the script computes the scope as `mcp:invoke(server=<server>,tool=<tool>)`. If your delegation grants something narrower (e.g., `mcp:invoke(server=https://x.com,tool=search,max_invocations<=50)`), pass it explicitly so the action's `scope_exercised` matches:

```bash
yarn start \
  --delegation ./agent.delegation \
  --invocation ./inv.json \
  --agent-address bc1qagent… \
  --scope 'mcp:invoke(server=https://x.com,tool=search,max_invocations<=50)' \
  > out.action
```

The script pre-flights the sub-scope relation (SPEC §7.4) so a mismatch fails fast — before you sign.

## Wiring this into Claude Code, Cursor, or any MCP client

This wrapper is a "stamp every call" pattern. Two integration shapes:

### 1. Wrap a stdio MCP server

If you operate the MCP server, intercept each invocation just before dispatch. Pass `(server, tool, arguments)` to `stampInvocation()` from [`@orangecheck/agent-mcp`](https://npmjs.com/package/@orangecheck/agent-mcp), attach the resulting `action` envelope to the response, and your callers get a verifiable receipt for free.

### 2. Wrap from the client side

If you're invoking someone else's MCP server, run this CLI between your agent and the network. The action envelope you produce is what *you* attest to — useful for audit logs, billing, dispute resolution, or proving "the bot did the thing."

For the full library API see the [`@orangecheck/agent-mcp` README](https://github.com/orangecheck/oc-packages/tree/main/agent-mcp). This example is a thin wrapper around `stampInvocation()` plus stdin-based deferred signing.

## Why this is a lifecycle, not a single CLI

OC Agent's value is the loop:

- The **principal** issues a `delegation` envelope (Bitcoin-signed grant to the agent).
- The **agent** issues `action` envelopes, each citing the delegation (this CLI's job).
- The **principal** can revoke — every action signed *after* the revocation's OTS anchor fails verification with `E_REVOKED`.

If you only sign actions and skip the delegation/revocation context, you're back to a plain audit log. The composition is the point.

## License

MIT.
