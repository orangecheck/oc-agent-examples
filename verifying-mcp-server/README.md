# verifying-mcp-server

> Server-side companion to [`mcp-wrap`](../mcp-wrap). Reads JSON-per-line tool-call requests on stdin; for each one, verifies the OC Agent action envelope against its cited delegation **before** dispatching the tool.

`mcp-wrap` shows the **client** side: produce a signed `agent-action` envelope around an MCP invocation. This shows the **server** side: refuse to execute the tool unless every call carries a valid action that's a sub-scope of a verified delegation. Together they close the authority loop.

## Install

```bash
cd verifying-mcp-server
yarn install
```

## Run

```bash
# strict (default) — every request must carry _oc_agent.delegation + _oc_agent.action
yarn -s start

# permissive — skip auth for local development
yarn -s start --no-require-agent-auth
```

The server speaks NDJSON: one JSON request per line on stdin, one JSON response per line on stdout. Verification audit messages go to stderr. `yarn -s` keeps yarn's own banner out of stdout.

## Try it (no auth)

```bash
echo '{"id":"1","method":"tools/call","params":{"name":"echo","arguments":{"hi":"world"}}}' \
  | yarn -s start --no-require-agent-auth
```

You should see:

```
{"id":"1","result":{"echoed":{"hi":"world"}}}
```

Without `--no-require-agent-auth` the same request is refused with `E_MISSING_AGENT_AUTH`. Available toy tools: `echo`, `search`. Replace `src/tools.ts` with your real backend.

## Try it (with OC Agent auth)

This is the realistic flow. You need a delegation issued to your agent address that grants `mcp:invoke(server=stdio:oc-agent-examples/verifying-mcp-server,tool=search)`. That `server` value is the identity this server checks for (`SERVER_ID` in `src/verify.ts`). Compose with `mcp-wrap` to produce the action envelope:

```bash
# 1. Produce a signed action envelope using mcp-wrap.
#    (See ../mcp-wrap/README.md — you'll need the delegation + your wallet's BIP-322 sig.)
cd ../mcp-wrap
yarn -s start \
  --delegation ~/agent.delegation \
  --invocation ../verifying-mcp-server/example/invocation.json \
  --agent-address bc1qagent… \
  > /tmp/out.action

# 2. Build a tool-call request that bundles the delegation + action with the
#    same arguments mcp-wrap stamped, and pipe it to the server.
cd ../verifying-mcp-server
DELEGATION=~/agent.delegation ACTION=/tmp/out.action node -e "
const fs = require('fs');
const delegation = JSON.parse(fs.readFileSync(process.env.DELEGATION, 'utf8'));
const action = JSON.parse(fs.readFileSync(process.env.ACTION, 'utf8'));
const inv = JSON.parse(fs.readFileSync('example/invocation.json', 'utf8'));
console.log(JSON.stringify({
  id: 'demo-1',
  method: 'tools/call',
  params: { name: inv.tool, arguments: inv.arguments },
  _oc_agent: { delegation, action },
}));
" | yarn -s start
```

Expected stdout:

```
{"id":"demo-1","result":{...},"verified_action_id":"<64-hex>"}
```

Expected stderr:

```
verify ok [demo-1] action=<12-hex>… scope=mcp:invoke(server=stdio:oc-agent-examples/verifying-mcp-server,tool=search)
```

Anything else gets an error response on stdout and a `reject` line on stderr, and the tool is **never** dispatched. For example:

| Request | Code |
|---|---|
| arguments, tool name or server differ from what the action stamped | `E_BAD_ACTION_STAMP` |
| action signature from a key other than the delegation's agent | `E_BAD_ACTION_STAMP` |
| one byte of the action envelope changed | `E_BAD_ID` |
| delegation signature does not verify for the principal | `E_BAD_SIG` |
| delegation expired | `E_EXPIRED` |
| action exercises a scope outside the delegation | `E_SCOPE_DENIED` |
| action exercises a granted scope that names another server or tool | `E_SCOPE_DENIED` |
| no `_oc_agent` bundle | `E_MISSING_AGENT_AUTH` |

## What this example demonstrates

1. **Where verification belongs**: between request parsing and dispatch. Add it to your real MCP server in the same place, just after you parse the JSON-RPC envelope and before you call into your tool registry.
2. **Signatures are checked**: both BIP-322 signatures (the principal's on the delegation, the agent's on the action) are verified with [`@orangecheck/bip322`](https://www.npmjs.com/package/@orangecheck/bip322).
3. **The content-hash bind**: a valid signature is not enough. The server rebuilds the canonical invocation bytes with `canonicalizeInvocation` from [`@orangecheck/agent-mcp`](https://www.npmjs.com/package/@orangecheck/agent-mcp), the same function `mcp-wrap` stamps with, and passes them to `verifyAction()` as `content`. Without this, an action envelope could be replayed against a different invocation.
4. **Scope pinning**: `verifyAction()` checks that the exercised scope is a sub-scope of a grant. The server also requires that scope to name this server and the tool being called, so authority granted for another server can't be spent here.
5. **What's intentionally not here**: revocation lookup against Nostr kind-30085. A production server SHOULD query kind 30085 with `"#t": [delegation id]` and pass `revocations: [...]` to `verifyDelegation()` and `verifyAction()` instead of `skipRevocationCheck: true`, to honor `E_REVOKED`. The demo skips it to stay offline-runnable. The request loop waits for in-flight verifications before exiting, so adding that network call is safe.

## Composition with the rest of the family

- **Client** signs at [`mcp-wrap`](../mcp-wrap) — produces the `.action` envelope.
- **Server** verifies here — refuses dispatch on rejection.
- **Audit/inspection** at [agent.ochk.io/app/inspect](https://agent.ochk.io/app/inspect) — paste a `[delegation, action]` pair to verify it in the browser, including a revocation lookup.
- **Revocation** at [agent.ochk.io/app](https://agent.ochk.io/app) — the principal can revoke; once the server checks revocations, later calls fail `E_REVOKED`.

## License

MIT.
