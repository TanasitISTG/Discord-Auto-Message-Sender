import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DEFAULT_CONFIG_BASE_DIR, readAppConfigResult, readLegacyMessagesResult, resolveConfigPaths } from '../../src/config/store';

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

test('readAppConfigResult surfaces canonical validation errors when userAgent is missing', () => {
    const tempDir = createTempDir();
    fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify({
        channels: [],
        messageGroups: {
            default: ['Hello!']
        }
    }, null, 2));

    const result = readAppConfigResult(resolveConfigPaths(tempDir));
    assert.equal(result.kind, 'invalid');
    assert.match(result.error, /Error loading config: .*userAgent/i);
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

test('readLegacyMessagesResult distinguishes missing messages from invalid messages', () => {
    const missingDir = createTempDir();
    const missingResult = readLegacyMessagesResult(resolveConfigPaths(missingDir));
    assert.deepEqual(missingResult, { kind: 'missing' });

    const invalidDir = createTempDir();
    fs.writeFileSync(path.join(invalidDir, 'messages.json'), '{ invalid json');

    const invalidResult = readLegacyMessagesResult(resolveConfigPaths(invalidDir));
    assert.equal(invalidResult.kind, 'invalid');
    assert.match(invalidResult.error, /Error loading legacy messages:/);
});

test('readAppConfigResult surfaces invalid legacy messages distinctly', () => {
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
    fs.writeFileSync(path.join(tempDir, 'messages.json'), '{ invalid json');

    const result = readAppConfigResult(resolveConfigPaths(tempDir));
    assert.equal(result.kind, 'invalid');
    assert.match(result.error, /Error loading legacy messages:/);
});

test('resolveConfigPaths defaults to the project root instead of the current working directory', () => {
    const tempDir = createTempDir();
    const previousCwd = process.cwd();

    process.chdir(tempDir);
    try {
        const paths = resolveConfigPaths();
        assert.equal(paths.configFile, path.join(DEFAULT_CONFIG_BASE_DIR, 'config.json'));
        assert.equal(paths.messagesFile, path.join(DEFAULT_CONFIG_BASE_DIR, 'messages.json'));
    } finally {
        process.chdir(previousCwd);
    }
});
