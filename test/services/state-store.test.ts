import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    loadSenderState,
    resolveStateFile,
    saveSenderState,
    STATE_SCHEMA_VERSION
} from '../../src/services/state-store';

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'discord-auto-state-'));
}

test('loadSenderState returns a warning and resets when the state file is corrupted', () => {
    const tempDir = createTempDir();
    fs.writeFileSync(resolveStateFile(tempDir), '{ invalid json', 'utf8');

    const state = loadSenderState(tempDir);

    assert.equal(state.summaries.length, 0);
    assert.equal(state.recentFailures.length, 0);
    assert.match(state.warning ?? '', /corrupted/i);
});

test('saveSenderState clears transient warning metadata before persisting', () => {
    const tempDir = createTempDir();

    saveSenderState(tempDir, {
        schemaVersion: STATE_SCHEMA_VERSION,
        summaries: [],
        recentFailures: [],
        warning: 'should not persist'
    });

    const raw = JSON.parse(fs.readFileSync(resolveStateFile(tempDir), 'utf8')) as { warning?: string; schemaVersion?: number };
    assert.equal(raw.warning, undefined);
    assert.equal(raw.schemaVersion, STATE_SCHEMA_VERSION);
});

test('loadSenderState preserves recent message history for restart-safe anti-repeat behavior', () => {
    const tempDir = createTempDir();

    saveSenderState(tempDir, {
        schemaVersion: STATE_SCHEMA_VERSION,
        summaries: [],
        recentFailures: [],
        recentMessageHistory: {
            '123': ['hello', 'world']
        }
    });

    const state = loadSenderState(tempDir);

    assert.deepEqual(state.recentMessageHistory, {
        '123': ['hello', 'world']
    });
});

test('loadSenderState preserves resume checkpoints and channel health snapshots', () => {
    const tempDir = createTempDir();

    saveSenderState(tempDir, {
        schemaVersion: STATE_SCHEMA_VERSION,
        summaries: [],
        recentFailures: [],
        recentMessageHistory: {
            '123': ['hello']
        },
        channelHealth: {
            '123': {
                channelId: '123',
                channelName: 'general',
                status: 'suppressed',
                consecutiveRateLimits: 4,
                consecutiveFailures: 1,
                suppressionCount: 2,
                suppressedUntil: '2026-03-21T10:00:00.000Z'
            }
        },
        resumeSession: {
            sessionId: 'session-1',
            updatedAt: '2026-03-21T09:59:00.000Z',
            runtime: {
                numMessages: 5,
                baseWaitSeconds: 10,
                marginSeconds: 2
            },
            configSignature: '{"channels":[]}',
            state: {
                id: 'session-1',
                status: 'running',
                updatedAt: '2026-03-21T09:59:00.000Z',
                activeChannels: ['123'],
                completedChannels: [],
                failedChannels: [],
                sentMessages: 1
            },
            recentMessageHistory: {
                '123': ['hello']
            }
        }
    });

    const state = loadSenderState(tempDir);

    assert.equal(state.channelHealth?.['123']?.status, 'suppressed');
    assert.equal(state.resumeSession?.sessionId, 'session-1');
    assert.equal(state.resumeSession?.runtime.baseWaitSeconds, 10);
    assert.deepEqual(state.resumeSession?.recentMessageHistory, {
        '123': ['hello']
    });
});

test('loadSenderState migrates legacy versionless state files to the current schema', () => {
    const tempDir = createTempDir();
    fs.writeFileSync(resolveStateFile(tempDir), JSON.stringify({
        summaries: [],
        recentFailures: [],
        recentMessageHistory: {
            '123': ['hello']
        }
    }, null, 2), 'utf8');

    const state = loadSenderState(tempDir);
    const raw = JSON.parse(fs.readFileSync(resolveStateFile(tempDir), 'utf8')) as { schemaVersion?: number };

    assert.equal(state.schemaVersion, STATE_SCHEMA_VERSION);
    assert.match(state.warning ?? '', /migrated/i);
    assert.equal(raw.schemaVersion, STATE_SCHEMA_VERSION);
});
