import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DEFAULT_CONFIG_BASE_DIR, readAppConfigResult, readLegacyMessagesResult, resolveConfigPaths, writeAppConfig } from '../../src/config/store';

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

test('readAppConfigResult keeps mixed canonical and legacy keys on the canonical validation path', () => {
    const tempDir = createTempDir();
    fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify({
        userAgent: 'UA',
        user_agent: 'legacy UA',
        channels: []
    }, null, 2));

    const result = readAppConfigResult(resolveConfigPaths(tempDir));
    assert.equal(result.kind, 'invalid');
    assert.match(result.error, /Error loading config: .*messageGroups/i);
    assert.doesNotMatch(result.error, /messages\.json is required/i);
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

test('writeAppConfig returns the normalized config that was persisted', () => {
    const tempDir = createTempDir();
    const paths = resolveConfigPaths(tempDir);

    const normalized = writeAppConfig({
        userAgent: '  UA  ',
        channels: [
            {
                name: '  general  ',
                id: ' 123456789012345678 ',
                referrer: 'https://discord.com/channels/@me/123456789012345678',
                messageGroup: ' default '
            }
        ],
        messageGroups: {
            default: ['  Hello!  ']
        }
    }, paths);

    assert.equal(normalized.userAgent, 'UA');
    assert.equal(normalized.channels[0].name, 'general');
    assert.equal(normalized.channels[0].id, '123456789012345678');
    assert.equal(normalized.channels[0].messageGroup, 'default');
    assert.deepEqual(normalized.messageGroups.default, ['Hello!']);

    const fromDisk = JSON.parse(fs.readFileSync(paths.configFile, 'utf8'));
    assert.deepEqual(fromDisk.channels, normalized.channels);
    assert.equal(fromDisk.userAgent, normalized.userAgent);
    assert.deepEqual(fromDisk.messageGroups.default, normalized.messageGroups.default);
});
