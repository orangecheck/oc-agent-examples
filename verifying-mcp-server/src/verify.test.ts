// verifyMcpCall with real BIP-322 signatures: a grant's max_invocations caps how
// many actions run under it, and the call named in the request is the one pinned.
// Run: yarn test
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

import { canonicalizeInvocation } from '@orangecheck/agent-mcp';
import { createDelegation, signAsAgent } from '@orangecheck/agent-signer';
import { addressFromPrivateKey, signMessage } from '@orangecheck/bip322';

import { SERVER_ID, verifyMcpCall } from './verify.ts';

const who = () => {
    const key = randomBytes(32).toString('hex');
    const address = addressFromPrivateKey(key, 'p2wpkh');
    return { address, ref: { address, signMessage: async (m: string) => signMessage(address, m, key) } };
};

async function harness(scope: string) {
    const principal = who();
    const agent = who();
    const delegation = await createDelegation({
        principal: principal.ref,
        agentAddress: agent.address,
        scopes: [scope],
        ttlMs: 3600e3,
    });
    let n = 0;
    return async (exercised: string) => {
        const args = { query: `q${n++}` };
        const action = await signAsAgent({
            agent: agent.ref,
            delegation,
            content: canonicalizeInvocation({ server: SERVER_ID, tool: 'search', arguments: args }),
            mime: 'application/vnd.oc-agent.mcp-invocation+json',
            scopeExercised: exercised,
        });
        const r = await verifyMcpCall(
            { id: String(n), method: 'tools/call', params: { name: 'search', arguments: args } },
            { delegation, action }
        );
        return r.ok ? 'ok' : r.code;
    };
}

test('a grant of max_invocations<=2 runs two actions and refuses the third', async () => {
    const scope = `mcp:invoke(max_invocations<=2,server=${SERVER_ID},tool=search)`;
    const call = await harness(scope);
    assert.equal(await call(scope), 'ok');
    assert.equal(await call(scope), 'ok');
    assert.equal(await call(scope), 'E_MAX_INVOCATIONS');
});

test('a grant with no max_invocations sets no cap', async () => {
    const scope = `mcp:invoke(server=${SERVER_ID},tool=search)`;
    const call = await harness(scope);
    for (let i = 0; i < 4; i++) assert.equal(await call(scope), 'ok');
});

test('each delegation has its own count', async () => {
    const scope = `mcp:invoke(max_invocations<=1,server=${SERVER_ID},tool=search)`;
    const first = await harness(scope);
    const second = await harness(scope);
    assert.equal(await first(scope), 'ok');
    assert.equal(await second(scope), 'ok');
    assert.equal(await first(scope), 'E_MAX_INVOCATIONS');
});
