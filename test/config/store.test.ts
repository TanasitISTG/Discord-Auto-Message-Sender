import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readAppConfigResult, resolveConfigPaths } from '../../src/config/store';

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'discord-auto-'));
}

test('readAppConfigResult distinguishes missing config from invalid config', () => {
    const missingDir = createTempDir();
    const missingResult = readAppConfigResult(resolveConfigPaths(missingDir));
    assert.deepEqual(missingResult, { kind: 'missing' });

    const invalidDir = createTempDir();
    fs.writeFileSync(path.join(invalidDir, 'config.json'), '{ invalid json');

    const invalidResult = readAppConfigResult(resolveConfigPaths(invalidDir));
    assert.equal(invalidResult.kind, 'invalid');
    assert.match(invalidResult.error, /Error reading config file:/);
});

test('readAppConfigResult reports legacy config without messages as invalid', () => {
    const tempDir = createTempDir();
    fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify({
        user_agent: 'UA',
        channels: [
            {
                name: 'general',
                id: '123456789012345678'
            }
        ]
    }, null, 2));

    const result = readAppConfigResult(resolveConfigPaths(tempDir));
    assert.deepEqual(result, {
        kind: 'invalid',
        error: 'Error loading legacy config: messages.json is required for legacy imports.'
    });
});
