import test from 'node:test';
import assert from 'node:assert/strict';
import { runPreflight } from '../../src/services/preflight';
import { createDefaultAppConfig } from '../../src/config/schema';
import { addChannel } from '../../src/services/config-editor';

function createConfig() {
    return addChannel(createDefaultAppConfig(), {
        name: 'general',
        id: '123456789012345678',
        messageGroup: 'default'
    });
}

test('runPreflight marks skipped access checks as ok and skipped when token is present', async () => {
    const result = await runPreflight(createConfig(), {
        token: 'test-token',
        checkAccess: false
    });

    assert.equal(result.ok, true);
    assert.equal(result.channels[0].ok, true);
    assert.equal(result.channels[0].skipped, true);
    assert.equal(result.channels[0].reason, 'Access check skipped.');
});

test('runPreflight still fails when token is missing', async () => {
    const result = await runPreflight(createConfig(), {
        checkAccess: false
    });

    assert.equal(result.ok, false);
    assert.equal(result.tokenPresent, false);
    assert.equal(result.channels[0].ok, false);
    assert.equal(result.channels[0].skipped, false);
    assert.equal(result.channels[0].reason, 'Missing token.');
});
