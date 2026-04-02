import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDefaultAppConfig } from '../../src/config/schema';
import { SessionService } from '../../src/services/session';
import { loadSenderState, saveSenderState, STATE_SCHEMA_VERSION } from '../../src/services/state-store';
import { createStructuredLogger } from '../../src/utils/logger';

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'discord-auto-session-'));
}

function createConfig() {
    const config = createDefaultAppConfig();
    config.channels = [
        {
            name: 'general',
            id: '123456789012345678',
            referrer: 'https://discord.com/channels/@me/123456789012345678',
            messageGroup: 'default',
        },
    ];
    config.messageGroups = {
        default: ['Hello from the test suite'],
    };
    return config;
}

function createResponse(status: number, body: unknown): Response {
    return new Response(body === undefined ? undefined : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

test('SessionService emits a fresh session segment marker before channel activity', async () => {
    const captured: Array<ReturnType<ReturnType<typeof createStructuredLogger>['emit']>> = [];
    const logger = createStructuredLogger({
        sinks: [
            (entry) => {
                captured.push(entry);
            },
        ],
    });
    const service = new SessionService({
        baseDir: createTempDir(),
        config: createConfig(),
        token: 'test-token',
        runtime: {
            numMessages: 1,
            baseWaitSeconds: 0,
            marginSeconds: 0,
        },
        logger,
        fetchImpl: async () => createResponse(200, {}),
        sleep: async () => {},
    });

    const finalState = await service.start();
    const marker = captured.find((entry) => entry.meta?.event === 'session_segment_started');

    assert.ok(marker);
    assert.equal(marker?.segmentKind, 'fresh');
    assert.equal(marker?.sessionId, finalState.id);
    assert.ok(marker?.segmentId);
    assert.equal(finalState.currentSegmentId, marker?.segmentId);
    assert.equal(finalState.currentSegmentKind, 'fresh');
});

test('SessionService preserves session continuity while creating a new resumed segment', async () => {
    const previousSegmentId = 'segment-old';
    const captured: Array<ReturnType<ReturnType<typeof createStructuredLogger>['emit']>> = [];
    const logger = createStructuredLogger({
        sinks: [
            (entry) => {
                captured.push(entry);
            },
        ],
    });
    const service = new SessionService({
        baseDir: createTempDir(),
        config: createConfig(),
        token: 'test-token',
        runtime: {
            numMessages: 1,
            baseWaitSeconds: 0,
            marginSeconds: 0,
        },
        resumeSession: {
            sessionId: 'session-1',
            updatedAt: '2026-03-21T10:00:00.000Z',
            runtime: {
                numMessages: 1,
                baseWaitSeconds: 0,
                marginSeconds: 0,
            },
            configSignature: '{}',
            state: {
                id: 'session-1',
                status: 'paused',
                updatedAt: '2026-03-21T10:00:00.000Z',
                currentSegmentId: previousSegmentId,
                currentSegmentKind: 'fresh',
                currentSegmentStartedAt: '2026-03-21T09:00:00.000Z',
                activeChannels: ['123456789012345678'],
                completedChannels: [],
                failedChannels: [],
                sentMessages: 1,
            },
            recentMessageHistory: {
                '123456789012345678': ['Hello from the test suite'],
            },
        },
        logger,
        fetchImpl: async () => createResponse(200, {}),
        sleep: async () => {},
    });

    const finalState = await service.start();
    const marker = captured.find((entry) => entry.meta?.event === 'session_segment_started');

    assert.ok(marker);
    assert.equal(marker?.sessionId, 'session-1');
    assert.equal(marker?.segmentKind, 'resumed');
    assert.notEqual(marker?.segmentId, previousSegmentId);
    assert.equal(marker?.meta?.resumedFromCheckpointAt, '2026-03-21T10:00:00.000Z');
    assert.equal(finalState.id, 'session-1');
    assert.equal(finalState.resumedFromCheckpoint, true);
    assert.equal(finalState.currentSegmentKind, 'resumed');
    assert.equal(finalState.currentSegmentId, marker?.segmentId);
});

test('SessionService preserves externally updated notification delivery state while flushing session state', async () => {
    const tempDir = createTempDir();
    const service = new SessionService({
        baseDir: tempDir,
        config: createConfig(),
        token: 'test-token',
        runtime: {
            numMessages: 1,
            baseWaitSeconds: 0,
            marginSeconds: 0,
        },
        fetchImpl: async () => createResponse(200, {}),
        sleep: async () => {},
    });

    const externallySavedDelivery = {
        settings: {
            windowsDesktopEnabled: true,
            telegram: {
                enabled: true,
                botTokenStored: true,
                chatId: '576653372',
                previewMode: 'full' as const,
            },
        },
        telegramState: {
            status: 'ready' as const,
            lastDeliveredAt: '2026-03-24T05:18:52.000Z',
        },
    };

    const existingState = loadSenderState(tempDir);
    saveSenderState(tempDir, {
        ...existingState,
        schemaVersion: STATE_SCHEMA_VERSION,
        notificationDelivery: externallySavedDelivery,
    });

    await service.start();

    const persistedState = loadSenderState(tempDir);
    assert.equal(persistedState.notificationDelivery?.settings.telegram.enabled, true);
    assert.equal(persistedState.notificationDelivery?.settings.telegram.botTokenStored, true);
    assert.equal(persistedState.notificationDelivery?.settings.telegram.chatId, '576653372');
    assert.equal(persistedState.notificationDelivery?.telegramState.status, 'ready');
    assert.equal(persistedState.notificationDelivery?.telegramState.lastDeliveredAt, '2026-03-24T05:18:52.000Z');
});

test('SessionService keeps a resumable checkpoint after a user-requested stop', async () => {
    const tempDir = createTempDir();
    let releaseFetch: (() => void) | null = null;
    const service = new SessionService({
        baseDir: tempDir,
        config: createConfig(),
        token: 'test-token',
        runtime: {
            numMessages: 1,
            baseWaitSeconds: 0,
            marginSeconds: 0,
        },
        fetchImpl: async (_url, init) => {
            return await new Promise<Response>((resolve, reject) => {
                releaseFetch = () => resolve(createResponse(200, {}));
                init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
                    once: true,
                });
            });
        },
        sleep: async () => {},
    });

    const startPromise = service.start();
    while (!releaseFetch) {
        await new Promise((resolve) => setImmediate(resolve));
    }

    service.stop('Stop requested from test.');
    const completeFetch: () => void =
        releaseFetch ??
        (() => {
            throw new Error('Expected the in-flight fetch to be ready.');
        });
    completeFetch();

    const finalState = await startPromise;
    const persistedState = loadSenderState(tempDir);

    assert.equal(finalState.status, 'stopped');
    assert.equal(finalState.failedChannels.length, 0);
    assert.equal(persistedState.resumeSession?.sessionId, finalState.id);
    assert.equal(persistedState.resumeSession?.state.status, 'stopped');
});
