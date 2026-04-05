import test from 'node:test';
import fs from 'fs';
import path from 'path';
import {
    assert,
    createTempDir,
    DesktopRuntime,
    FakeSession,
    SessionController,
    STATE_SCHEMA_VERSION,
    writeDesktopFiles,
} from './runtime-test-helpers';
import type { SessionState } from '../../src/types';
import { createSessionConfigSignature } from '../../src/application/session/session-service';

test('DesktopRuntime uses a single in-process session controller for lifecycle commands', async () => {
    const tempDir = createTempDir();
    writeDesktopFiles(tempDir);

    const events: string[] = [];
    const runtime = new DesktopRuntime({
        baseDir: tempDir,
        emitEvent: (event) => {
            events.push(event.type);
        },
        sessionFactory: (options) => new FakeSession(options),
    });

    const started = await runtime.startSession({
        numMessages: 1,
        baseWaitSeconds: 1,
        marginSeconds: 0,
        token: 'test-token',
    });
    assert.equal(started.status, 'running');
    assert.equal(runtime.getSessionState()?.status, 'running');

    const paused = runtime.pauseSession();
    assert.equal(paused?.status, 'paused');

    const resumed = runtime.resumeSession();
    assert.equal(resumed?.status, 'running');

    const stopping = runtime.stopSession();
    assert.equal(stopping?.status, 'stopping');

    assert.ok(events.includes('session_started'));
    assert.ok(events.includes('session_paused'));
    assert.ok(events.includes('session_resumed'));
    assert.ok(events.includes('session_stopping'));
});

test('DesktopRuntime keeps the newer session controller when an older completed session settles later', async () => {
    const tempDir = createTempDir();
    writeDesktopFiles(tempDir);

    const controllers: Array<
        SessionController & {
            markCompleted(): void;
            resolveCompleted(): void;
        }
    > = [];

    const runtime = new DesktopRuntime({
        baseDir: tempDir,
        sessionFactory: (options) => {
            const state: SessionState = {
                id: `session-${controllers.length + 1}`,
                status: 'idle',
                updatedAt: new Date().toISOString(),
                activeChannels: [],
                completedChannels: [],
                failedChannels: [],
                sentMessages: 0,
            };
            let resolveStart: ((value: SessionState) => void) | undefined;

            const controller: SessionController & {
                markCompleted(): void;
                resolveCompleted(): void;
            } = {
                getState() {
                    return { ...state };
                },
                pause() {
                    state.status = 'paused';
                    return { ...state };
                },
                resume() {
                    state.status = 'running';
                    return { ...state };
                },
                stop() {
                    state.status = 'stopping';
                    return { ...state };
                },
                markCompleted() {
                    state.status = 'completed';
                    state.updatedAt = new Date().toISOString();
                },
                resolveCompleted() {
                    const finishedAt = new Date().toISOString();
                    resolveStart?.({
                        ...state,
                        status: 'completed',
                        updatedAt: finishedAt,
                        summary: {
                            totalChannels: 1,
                            completedChannels: 1,
                            failedChannels: 0,
                            sentMessages: 0,
                            startedAt: state.updatedAt,
                            finishedAt,
                        },
                    });
                },
                async start() {
                    state.status = 'running';
                    options.emitEvent?.({ type: 'session_started', state: { ...state } });
                    return await new Promise<SessionState>((resolve) => {
                        resolveStart = resolve;
                    });
                },
            };

            controllers.push(controller);
            return controller;
        },
    });

    await runtime.startSession({
        numMessages: 1,
        baseWaitSeconds: 1,
        marginSeconds: 0,
        token: 'test-token',
    });
    controllers[0]?.markCompleted();

    const restarted = await runtime.startSession({
        numMessages: 2,
        baseWaitSeconds: 1,
        marginSeconds: 0,
        token: 'test-token',
    });
    assert.equal(restarted.id, 'session-2');
    assert.equal(runtime.getSessionState()?.id, 'session-2');

    controllers[0]?.resolveCompleted();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(runtime.getSessionState()?.id, 'session-2');
    assert.equal(runtime.getSessionState()?.status, 'running');
});

test('DesktopRuntime restores a resumable checkpoint when config and runtime still match', async () => {
    const tempDir = createTempDir();
    const config = writeDesktopFiles(tempDir);
    fs.writeFileSync(
        path.join(tempDir, '.sender-state.json'),
        JSON.stringify(
            {
                schemaVersion: STATE_SCHEMA_VERSION,
                summaries: [],
                recentFailures: [],
                recentMessageHistory: {
                    '123456789012345678': ['hello'],
                },
                resumeSession: {
                    sessionId: 'session-resume',
                    updatedAt: '2026-03-21T10:00:00.000Z',
                    runtime: {
                        numMessages: 1,
                        baseWaitSeconds: 1,
                        marginSeconds: 0,
                    },
                    configSignature: createSessionConfigSignature(config),
                    state: {
                        id: 'session-resume',
                        status: 'running',
                        updatedAt: '2026-03-21T10:00:00.000Z',
                        activeChannels: ['123456789012345678'],
                        completedChannels: [],
                        failedChannels: [],
                        sentMessages: 1,
                        runtime: {
                            numMessages: 1,
                            baseWaitSeconds: 1,
                            marginSeconds: 0,
                        },
                    },
                    recentMessageHistory: {
                        '123456789012345678': ['hello'],
                    },
                },
            },
            null,
            2,
        ),
        'utf8',
    );

    let receivedResumeSessionId: string | undefined;
    const runtime = new DesktopRuntime({
        baseDir: tempDir,
        sessionFactory: (options) => {
            receivedResumeSessionId = options.resumeSession?.sessionId;
            return new FakeSession(options);
        },
    });

    await runtime.startSession({
        numMessages: 1,
        baseWaitSeconds: 1,
        marginSeconds: 0,
        token: 'test-token',
    });

    assert.equal(receivedResumeSessionId, 'session-resume');
});

test('DesktopRuntime can discard a saved resume checkpoint when no session is active', () => {
    const tempDir = createTempDir();
    const config = writeDesktopFiles(tempDir);
    fs.writeFileSync(
        path.join(tempDir, '.sender-state.json'),
        JSON.stringify(
            {
                schemaVersion: STATE_SCHEMA_VERSION,
                summaries: [],
                recentFailures: [],
                resumeSession: {
                    sessionId: 'session-resume',
                    updatedAt: '2026-03-21T10:00:00.000Z',
                    runtime: {
                        numMessages: 1,
                        baseWaitSeconds: 1,
                        marginSeconds: 0,
                    },
                    configSignature: createSessionConfigSignature(config),
                    state: {
                        id: 'session-resume',
                        status: 'running',
                        updatedAt: '2026-03-21T10:00:00.000Z',
                        activeChannels: ['123456789012345678'],
                        completedChannels: [],
                        failedChannels: [],
                        sentMessages: 1,
                    },
                    recentMessageHistory: {
                        '123456789012345678': ['hello'],
                    },
                },
            },
            null,
            2,
        ),
        'utf8',
    );

    const runtime = new DesktopRuntime({
        baseDir: tempDir,
    });

    const state = runtime.discardResumeSession();

    assert.equal(state.resumeSession, undefined);
});

test('DesktopRuntime accepts an injected token from the desktop shell', async () => {
    const tempDir = createTempDir();
    writeDesktopFiles(tempDir);

    let receivedToken: string | undefined;
    const runtime = new DesktopRuntime({
        baseDir: tempDir,
        sessionFactory: (options) => {
            receivedToken = options.token;
            return new FakeSession(options);
        },
    });

    await runtime.startSession({
        numMessages: 1,
        baseWaitSeconds: 1,
        marginSeconds: 0,
        token: 'injected-token',
    });

    assert.equal(receivedToken, 'injected-token');
});

test('DesktopRuntime does not restore a checkpoint when the requested runtime no longer matches', async () => {
    const tempDir = createTempDir();
    const config = writeDesktopFiles(tempDir);
    fs.writeFileSync(
        path.join(tempDir, '.sender-state.json'),
        JSON.stringify(
            {
                schemaVersion: STATE_SCHEMA_VERSION,
                summaries: [],
                recentFailures: [],
                resumeSession: {
                    sessionId: 'session-resume',
                    updatedAt: '2026-03-21T10:00:00.000Z',
                    runtime: {
                        numMessages: 1,
                        baseWaitSeconds: 1,
                        marginSeconds: 0,
                    },
                    configSignature: createSessionConfigSignature(config),
                    state: {
                        id: 'session-resume',
                        status: 'running',
                        updatedAt: '2026-03-21T10:00:00.000Z',
                        activeChannels: ['123456789012345678'],
                        completedChannels: [],
                        failedChannels: [],
                        sentMessages: 1,
                    },
                    recentMessageHistory: {
                        '123456789012345678': ['hello'],
                    },
                },
            },
            null,
            2,
        ),
        'utf8',
    );

    let receivedResumeSessionId: string | undefined;
    const runtime = new DesktopRuntime({
        baseDir: tempDir,
        sessionFactory: (options) => {
            receivedResumeSessionId = options.resumeSession?.sessionId;
            return new FakeSession(options);
        },
    });

    await runtime.startSession({
        numMessages: 2,
        baseWaitSeconds: 1,
        marginSeconds: 0,
        token: 'test-token',
    });

    assert.equal(receivedResumeSessionId, undefined);
});

test('DesktopRuntime resumes when the stored config is semantically identical but ordered differently', async () => {
    const tempDir = createTempDir();
    const config = writeDesktopFiles(tempDir);
    const reorderedConfig = {
        messageGroups: {
            ...config.messageGroups,
        },
        channels: config.channels.map((channel) => ({
            id: channel.id,
            name: channel.name,
            messageGroup: channel.messageGroup,
            referrer: channel.referrer,
        })),
        userAgent: config.userAgent,
    };

    fs.writeFileSync(
        path.join(tempDir, '.sender-state.json'),
        JSON.stringify(
            {
                schemaVersion: STATE_SCHEMA_VERSION,
                summaries: [],
                recentFailures: [],
                resumeSession: {
                    sessionId: 'session-resume',
                    updatedAt: '2026-03-21T10:00:00.000Z',
                    runtime: {
                        numMessages: 1,
                        baseWaitSeconds: 1,
                        marginSeconds: 0,
                    },
                    configSignature: createSessionConfigSignature(reorderedConfig),
                    state: {
                        id: 'session-resume',
                        status: 'running',
                        updatedAt: '2026-03-21T10:00:00.000Z',
                        activeChannels: ['123456789012345678'],
                        completedChannels: [],
                        failedChannels: [],
                        sentMessages: 1,
                    },
                    recentMessageHistory: {
                        '123456789012345678': ['hello'],
                    },
                },
            },
            null,
            2,
        ),
        'utf8',
    );

    let receivedResumeSessionId: string | undefined;
    const runtime = new DesktopRuntime({
        baseDir: tempDir,
        sessionFactory: (options) => {
            receivedResumeSessionId = options.resumeSession?.sessionId;
            return new FakeSession(options);
        },
    });

    await runtime.startSession({
        numMessages: 1,
        baseWaitSeconds: 1,
        marginSeconds: 0,
        token: 'test-token',
    });

    assert.equal(receivedResumeSessionId, 'session-resume');
});
