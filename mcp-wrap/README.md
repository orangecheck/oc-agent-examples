# mcp-wrap

> Wrap an MCP tool invocation in a signed `agent-action` envelope, without ever holding the agent's private key.

This example takes the smallest possible step from "an MCP server tool was called" to "every call is a signed, scope-constrained, verifiable OC Agent action." It's a Node CLI that:

1. Reads a delegation envelope (the principal's grant of scoped authority).
2. Reads an MCP invocation as JSON (`{ server, tool, arguments }`).
3. Verifies the delegation offline, including the principal's BIP-322 signature.
4. Stamps the invocation and prints the message to sign on stderr.
5. Waits for you to paste the BIP-322 signature back on stdin (signed in the agent's wallet).
6. Emits a fully-formed `agent-action` envelope to stdout.

The agent's secret key never enters this process. The wrapper composes with **any** BIP-322-capable signer: a hardware wallet, an HSM, `bitcoin-cli signmessage`, a remote signing service.

## Install

```bash
cd mcp-wrap
yarn install
```

## What you need

- A delegation envelope issued **to your agent address**, granting an `mcp:invoke` scope for the server and tool. Produce one at [agent.ochk.io/app](https://agent.ochk.io/app) and download it as a `.delegation` file, or create one in code with `createDelegation` from [`@orangecheck/agent-signer`](https://www.npmjs.com/package/@orangecheck/agent-signer).
- The agent's Bitcoin address.
- A BIP-322-capable wallet for that address (UniSat, Xverse, Leather, OKX, Phantom, Sparrow's "Sign Message", `bitcoin-cli signmessagewithprivkey`, an HSM, …).
- An MCP invocation as JSON. See [`example-invocation.json`](./example-invocation.json) for the shape.

## Usage

```bash
yarn -s start \
  --delegation ./agent.delegation \
  --invocation ./example-invocation.json \
  --agent-address bc1qagent… \
  > out.action
```

Use `yarn -s` (silent). Plain `yarn start` prints its own banner to stdout and corrupts the envelope file.

The script will:

1. Verify your delegation offline and print a summary on stderr (id, scopes, expiry).
2. Print the message that needs signing (the action id). Copy it into your wallet's "Sign Message" UI.
3. Read the resulting base64 signature from stdin.
4. Write the signed action envelope to stdout.

Pipe `out.action` to whoever needs to verify the call: the receiving service, an audit log, a dispute-resolution party.

## Verify

Anyone with the delegation can verify the action offline. The CLI takes a `[delegation, action]` array:

```bash
jq -s . ./agent.delegation ./out.action > pair.json
npx @orangecheck/agent-cli verify pair.json
# OK · action + delegation verified
#   id: <action id>
#   checked at <the current time>
#   ! revocation not checked (offline) — query kind 30085 with "#t": [delegation id] and pass --revocations
```

`verify` checks the action as of now: the delegation in force, and `signed_at` within two minutes of the clock, so a slow wallet round trip reads `E_STALE`. To check an action after the fact, add `--as-of-signed-at`; it answers for the time the agent claims, and says that time is the agent's own unless an anchor fixes it.

Change one byte of the action's `content.hash` and the same command prints `REJECTED · E_BAD_ID` and exits 1. The web inspector at [agent.ochk.io/app/inspect](https://agent.ochk.io/app/inspect) accepts the same array, and also checks Nostr for revocations. In code, a service deciding whether to run the call uses `verifyAction` from [`@orangecheck/agent-core`](https://www.npmjs.com/package/@orangecheck/agent-core), which checks as of now, with `content: canonicalizeInvocation(invocation)` from `@orangecheck/agent-mcp` to prove the action covers this exact invocation, and acts on each action id once (`createReplayGuard`); [`../verifying-mcp-server`](../verifying-mcp-server) does exactly that.

## Optional: explicit scope

By default the script computes the scope as `mcp:invoke(server=<server>,tool=<tool>)`. If your delegation grants something narrower (e.g., `mcp:invoke(server=https://x.com,tool=search,max_invocations<=50)`), pass it explicitly so the action's `scope_exercised` matches:

```bash
yarn -s start \
  --delegation ./agent.delegation \
  --invocation ./inv.json \
  --agent-address bc1qagent… \
  --scope 'mcp:invoke(server=https://x.com,tool=search,max_invocations<=50)' \
  > out.action
```

The script pre-flights the sub-scope relation (SPEC §7.4), so a mismatch fails before you sign:

```
ERROR: stampInvocation: scope_exercised (mcp:invoke(server=https://mcp.example.com,tool=delete)) is not a sub-scope of any granted scope (mcp:invoke(server=https://mcp.example.com,tool=search))
```

## Wiring this into Claude Code, Cursor, or any MCP client

This wrapper is a "stamp every call" pattern. Two integration shapes:

### 1. Wrap a stdio MCP server

If you operate the MCP server, intercept each invocation just before dispatch. Pass `(server, tool, arguments)` to `stampInvocation()` from [`@orangecheck/agent-mcp`](https://www.npmjs.com/package/@orangecheck/agent-mcp), attach the resulting `action` envelope to the response, and your callers get a verifiable receipt for free.

### 2. Wrap from the client side

If you're invoking someone else's MCP server, run this CLI between your agent and the network. The action envelope you produce is what *you* attest to — useful for audit logs, billing, dispute resolution, or proving "the bot did the thing."

For the full library API see the [`@orangecheck/agent-mcp` README](https://github.com/orangecheck/oc-packages/tree/main/agent-mcp). This example is a thin wrapper around `stampInvocation()` plus stdin-based deferred signing.

## Why this is a lifecycle, not a single CLI

OC Agent's value is the loop:

- The **principal** issues a `delegation` envelope (Bitcoin-signed grant to the agent).
- The **agent** issues `action` envelopes, each citing the delegation (this CLI's job).
- The **principal** or the **agent** can revoke at any time. Once the revocation is in effect, verification refuses every action with `E_REVOKED`.

If you only sign actions and skip the delegation/revocation context, you're back to a plain audit log. The composition is the point.

## License

MIT.
