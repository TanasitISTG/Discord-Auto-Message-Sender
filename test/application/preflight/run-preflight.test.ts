import test from 'node:test';
import assert from 'node:assert/strict';
import { PREFLIGHT_ACCESS_CONCURRENCY, runPreflight } from '../../../src/application/preflight/run-preflight';
import { createDefaultAppConfig } from '../../../src/config/schema';
import { addChannel } from '../../../src/domain/config-editor';

function createConfig() {
    return addChannel(createDefaultAppConfig(), {
        name: 'general',
        id: '123456789012345678',
        messageGroup: 'default',
    });
}

test('runPreflight marks skipped access checks as ok and skipped when token is present', async () => {
    const result = await runPreflight(createConfig(), {
        token: 'test-token',
        checkAccess: false,
    });

    assert.equal(result.ok, true);
    assert.equal(result.channels[0].ok, true);
    assert.equal(result.channels[0].skipped, true);
    assert.equal(result.channels[0].reason, 'Access check skipped.');
});

test('runPreflight still fails when token is missing', async () => {
    const result = await runPreflight(createConfig(), {
        checkAccess: false,
    });

    assert.equal(result.ok, false);
    assert.equal(result.tokenPresent, false);
    assert.equal(result.channels[0].ok, false);
    assert.equal(result.channels[0].skipped, true);
    assert.equal(result.channels[0].reason, 'Missing token.');
    assert.deepEqual(result.issues, ['DISCORD_TOKEN is missing.']);
});

test('runPreflight limits concurrent access checks to avoid unbounded fan-out', async () => {
    let config = createDefaultAppConfig();
    for (let index = 0; index < 10; index += 1) {
        config = addChannel(config, {
            name: `general-${index}`,
            id: `12345678901234567${index}`,
            messageGroup: 'default',
        });
    }

    let inFlight = 0;
    let peakInFlight = 0;

    const result = await runPreflight(config, {
        token: 'test-token',
        checkAccess: true,
        fetchImpl: async () => {
            inFlight += 1;
            peakInFlight = Math.max(peakInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 10));
            inFlight -= 1;
            return new Response(undefined, { status: 200 });
        },
    });

    assert.equal(result.ok, true);
    assert.equal(result.channels.length, 10);
    assert.ok(peakInFlight <= PREFLIGHT_ACCESS_CONCURRENCY);
});
