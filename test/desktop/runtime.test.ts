import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDefaultAppConfig } from '../../src/config/schema';
import { DesktopRuntime, resolveSessionLogPath } from '../../src/desktop/runtime';
import { SessionServiceOptions } from '../../src/services/session';
import { STATE_SCHEMA_VERSION } from '../../src/services/state-store';
import { SessionState } from '../../src/types';

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'discord-auto-runtime-'));
}

function writeDesktopFiles(baseDir: string) {
    const config = createDefaultAppConfig();
    config.channels = [{
        name: 'general',
        id: '123456789012345678',
        referrer: 'https://discord.com/channels/@me/123456789012345678',
        messageGroup: 'default'
    }];

    fs.writeFileSync(path.join(baseDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
    fs.writeFileSync(path.join(baseDir, '.env'), 'DISCORD_TOKEN=test-token', 'utf8');
    return config;
}

class FakeSession {
    private readonly emitEvent?: SessionServiceOptions['emitEvent'];
    private readonly state: SessionState;
    private resolveStart?: (value: SessionState) => void;

    constructor(options: SessionServiceOptions) {
        this.emitEvent = options.emitEvent;
        this.state = {
            id: options.sessionId ?? 'session-1',
            status: 'idle',
            updatedAt: new Date().toISOString(),
            activeChannels: [],
            completedChannels: [],
            failedChannels: [],
            sentMessages: 0
        };
    }

    getState() {
        return { ...this.state };
    }

    pause() {
        this.state.status = 'paused';
        this.emitEvent?.({ type: 'session_paused', state: this.getState() });
        return this.getState();
    }

    resume() {
        this.state.status = 'running';
        this.emitEvent?.({ type: 'session_resumed', state: this.getState() });
        return this.getState();
    }

    stop(reason?: string) {
        this.state.status = 'stopping';
        this.state.stopReason = reason;
        this.emitEvent?.({ type: 'session_stopping', state: this.getState() });
        const summaryState: SessionState = {
            ...this.getState(),
            status: 'failed',
            summary: {
                totalChannels: 1,
                completedChannels: 0,
                failedChannels: 1,
                sentMessages: 0,
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                stopReason: reason
            }
        };
        this.resolveStart?.(summaryState);
        return this.getState();
    }

    async start() {
        this.state.status = 'running';
        this.emitEvent?.({ type: 'session_started', state: this.getState() });
        return await new Promise<SessionState>((resolve) => {
            this.resolveStart = resolve;
        });
    }
}

test('DesktopRuntime uses a single in-process session controller for lifecycle commands', async () => {
    const tempDir = createTempDir();
    writeDesktopFiles(tempDir);

    const events: string[] = [];
    const runtime = new DesktopRuntime({
        baseDir: tempDir,
        emitEvent: (event) => {
            events.push(event.type);
        },
        sessionFactory: (options) => new FakeSession(options)
    });

    const started = await runtime.startSession({
        numMessages: 1,
        baseWaitSeconds: 1,
        marginSeconds: 0
    });
    assert.equal(started.status, 'running');
    assert.equal(runtime.getSessionState()?.status, 'running');

    const paused = runtime.pauseSession();
    assert.equal(paused?.status, 'paused');

    const resumed = runtime.resumeSession();
    assert.equal(resumed?.status, 'running');

    const stopping = runtime.stopSession();
    assert.equal(stopping?.status, 'stopping');

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(events.includes('session_started'));
    assert.ok(events.includes('session_paused'));
    assert.ok(events.includes('session_resumed'));
    assert.ok(events.includes('session_stopping'));
});

test('DesktopRuntime restores a resumable checkpoint when config and runtime still match', async () => {
    const tempDir = createTempDir();
    const config = writeDesktopFiles(tempDir);
    fs.writeFileSync(path.join(tempDir, '.sender-state.json'), JSON.stringify({
        schemaVersion: STATE_SCHEMA_VERSION,
        summaries: [],
        recentFailures: [],
        recentMessageHistory: {
            '123456789012345678': ['hello']
        },
        resumeSession: {
            sessionId: 'session-resume',
            updatedAt: '2026-03-21T10:00:00.000Z',
            runtime: {
                numMessages: 1,
                baseWaitSeconds: 1,
                marginSeconds: 0
            },
            configSignature: JSON.stringify(config),
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
                    marginSeconds: 0
                }
            },
            recentMessageHistory: {
                '123456789012345678': ['hello']
            }
        }
    }, null, 2), 'utf8');

    let receivedResumeSessionId: string | undefined;
    const runtime = new DesktopRuntime({
        baseDir: tempDir,
        sessionFactory: (options) => {
            receivedResumeSessionId = options.resumeSession?.sessionId;
            return new FakeSession(options);
        }
    });

    await runtime.startSession({
        numMessages: 1,
        baseWaitSeconds: 1,
        marginSeconds: 0
    });

    assert.equal(receivedResumeSessionId, 'session-resume');
});

test('DesktopRuntime can discard a saved resume checkpoint when no session is active', () => {
    const tempDir = createTempDir();
    const config = writeDesktopFiles(tempDir);
    fs.writeFileSync(path.join(tempDir, '.sender-state.json'), JSON.stringify({
        schemaVersion: STATE_SCHEMA_VERSION,
        summaries: [],
        recentFailures: [],
        resumeSession: {
            sessionId: 'session-resume',
            updatedAt: '2026-03-21T10:00:00.000Z',
            runtime: {
                numMessages: 1,
                baseWaitSeconds: 1,
                marginSeconds: 0
            },
            configSignature: JSON.stringify(config),
            state: {
                id: 'session-resume',
                status: 'running',
                updatedAt: '2026-03-21T10:00:00.000Z',
                activeChannels: ['123456789012345678'],
                completedChannels: [],
                failedChannels: [],
                sentMessages: 1
            },
            recentMessageHistory: {
                '123456789012345678': ['hello']
            }
        }
    }, null, 2), 'utf8');

    const runtime = new DesktopRuntime({
        baseDir: tempDir
    });

    const state = runtime.discardResumeSession();

    assert.equal(state.resumeSession, undefined);
});

test('DesktopRuntime accepts an injected token from the desktop shell instead of requiring a local .env file', async () => {
    const tempDir = createTempDir();
    writeDesktopFiles(tempDir);
    fs.rmSync(path.join(tempDir, '.env'));

    let receivedToken: string | undefined;
    const runtime = new DesktopRuntime({
        baseDir: tempDir,
        sessionFactory: (options) => {
            receivedToken = options.token;
            return new FakeSession(options);
        }
    });

    await runtime.startSession({
        numMessages: 1,
        baseWaitSeconds: 1,
        marginSeconds: 0,
        token: 'injected-token'
    });

    assert.equal(receivedToken, 'injected-token');
});

test('DesktopRuntime does not restore a checkpoint when the requested runtime no longer matches', async () => {
    const tempDir = createTempDir();
    const config = writeDesktopFiles(tempDir);
    fs.writeFileSync(path.join(tempDir, '.sender-state.json'), JSON.stringify({
        schemaVersion: STATE_SCHEMA_VERSION,
        summaries: [],
        recentFailures: [],
        resumeSession: {
            sessionId: 'session-resume',
            updatedAt: '2026-03-21T10:00:00.000Z',
            runtime: {
                numMessages: 1,
                baseWaitSeconds: 1,
                marginSeconds: 0
            },
            configSignature: JSON.stringify(config),
            state: {
                id: 'session-resume',
                status: 'running',
                updatedAt: '2026-03-21T10:00:00.000Z',
                activeChannels: ['123456789012345678'],
                completedChannels: [],
                failedChannels: [],
                sentMessages: 1
            },
            recentMessageHistory: {
                '123456789012345678': ['hello']
            }
        }
    }, null, 2), 'utf8');

    let receivedResumeSessionId: string | undefined;
    const runtime = new DesktopRuntime({
        baseDir: tempDir,
        sessionFactory: (options) => {
            receivedResumeSessionId = options.resumeSession?.sessionId;
            return new FakeSession(options);
        }
    });

    await runtime.startSession({
        numMessages: 2,
        baseWaitSeconds: 1,
        marginSeconds: 0
    });

    assert.equal(receivedResumeSessionId, undefined);
});

test('DesktopRuntime rejects invalid session ids when loading logs', async () => {
    const tempDir = createTempDir();
    writeDesktopFiles(tempDir);
    const runtime = new DesktopRuntime({
        baseDir: tempDir
    });

    await assert.rejects(
        () => runtime.loadLogs({ sessionId: '../secret' }),
        /Invalid session id/
    );
});

test('DesktopRuntime skips invalid JSONL lines while loading logs', async () => {
    const tempDir = createTempDir();
    writeDesktopFiles(tempDir);
    const logPath = resolveSessionLogPath(tempDir, 'session-1');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, [
        JSON.stringify({
            id: 'entry-1',
            timestamp: '2026-03-22T00:00:00.000Z',
            level: 'info',
            context: 'System',
            message: 'ok'
        }),
        '{ invalid jsonl',
        JSON.stringify({
            id: 'entry-2',
            timestamp: '2026-03-22T00:00:01.000Z',
            level: 'warning',
            context: 'System',
            message: 'still ok'
        })
    ].join('\n'), 'utf8');

    const runtime = new DesktopRuntime({
        baseDir: tempDir
    });

    const result = await runtime.loadLogs({ sessionId: 'session-1' });

    assert.equal(result.entries.length, 2);
    assert.deepEqual(result.warnings, ['Skipped invalid log line 2.']);
});
