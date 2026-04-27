# verifying-mcp-server

> Server-side companion to [`mcp-wrap`](../mcp-wrap). Reads JSON-per-line tool-call requests on stdin; for each one, verifies the OC Agent action envelope against its cited delegation **before** dispatching the tool.

`mcp-wrap` shows the **client** side: produce a signed `agent-action` envelope around an MCP invocation. This shows the **server** side: refuse to execute the tool unless every call carries a valid action that's a sub-scope of a verified delegation. Together they close the authority loop.

## Install

```bash
cd verifying-mcp-server
yarn install   # or npm install
```

## Run

```bash
# strict (default) — every request must carry _oc_agent.delegation + _oc_agent.action
yarn start

# permissive — skip auth for local development
yarn start -- --no-require-agent-auth
```

The server speaks NDJSON: one JSON request per line on stdin, one JSON response per line on stdout. Verification audit messages go to stderr.

## Try it (no auth)

```bash
echo '{"id":"1","method":"tools/call","params":{"name":"echo","arguments":{"hi":"world"}}}' \
  | yarn start -- --no-require-agent-auth
```

You should see:

```
{"id":"1","result":{"echoed":{"hi":"world"}}}
```

Available toy tools: `echo`, `search`. Replace `src/tools.ts` with your real backend.

## Try it (with OC Agent auth)

This is the realistic flow. Compose with `mcp-wrap` to produce the action envelope:

```bash
# 1. Produce a signed action envelope using mcp-wrap.
#    (See ../mcp-wrap/README.md — you'll need a delegation + your wallet's BIP-322 sig.)
cd ../mcp-wrap
yarn start \
  --delegation ./agent.delegation \
  --invocation ../verifying-mcp-server/example/invocation.json \
  --agent-address bc1qagent… \
  > /tmp/out.action

# 2. Build a tool-call request that bundles the delegation + action with the
#    same arguments mcp-wrap canonicalized over.
cd ../verifying-mcp-server
node -e "
const fs = require('fs');
const action = JSON.parse(fs.readFileSync('/tmp/out.action','utf8'));
const delegation = JSON.parse(fs.readFileSync('../mcp-wrap/agent.delegation','utf8'));
const inv = JSON.parse(fs.readFileSync('example/invocation.json','utf8'));
console.log(JSON.stringify({
  id: 'demo-1',
  method: 'tools/call',
  params: { name: inv.tool, arguments: inv.arguments },
  _oc_agent: { delegation, action },
}));
" | yarn start
```

Expected stdout:

```
{"id":"demo-1","result":{...},"verified_action_id":"<64-hex>"}
```

Expected stderr:

```
verify ok [demo-1] action=0fe8e90a1240… scope=mcp:invoke(server=…,tool=…)
```

If the action's `content_hash` doesn't match the canonical invocation, or the scope isn't a sub-scope of an `mcp:invoke` grant, or the delegation is malformed/expired/revoked, you get a verification rejection on stderr and an error response on stdout — the tool is **never** dispatched.

## What this example demonstrates

1. **Where verification belongs** — between request parsing and dispatch. Add it to your real MCP server in the same place: just after you parse the JSON-RPC envelope, before you call into your tool registry.
2. **The content-hash bind** — verifying the BIP-322 signature isn't enough. The server must also recompute the canonical invocation bytes and confirm `action.content.hash` matches; otherwise an attacker can replay an action envelope against a different invocation.
3. **Scope-family pinning** — `verifyAction()` already enforces sub-scope, but a server should additionally pin the `product:verb` family to what it actually serves (this server only honors `mcp:invoke`).
4. **What's intentionally not here** — revocation lookup against Nostr kind-30085. A production server SHOULD query `#delegation` and pass `revocations: [...]` to `verifyAction()` to honor `E_REVOKED`. We skip it in the demo to keep the example offline-runnable.

## Composition with the rest of the family

- **Client** signs at [`mcp-wrap`](../mcp-wrap) — produces the `.action` envelope.
- **Server** verifies here — refuses dispatch on rejection.
- **Audit/inspection** at [`agent.ochk.io/inspect`](https://agent.ochk.io/inspect) — paste a `[delegation, action]` pair to see the same verdict the server saw.
- **Revocation** at [`agent.ochk.io/app`](https://agent.ochk.io/app) — principal can revoke; future calls fail `E_REVOKED`.

## License

MIT.
