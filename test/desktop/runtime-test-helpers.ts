import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDefaultAppConfig } from '../../src/config/schema';
import { DesktopRuntime, resolveSessionLogPath } from '../../src/desktop/runtime';
import { InboxMonitorController } from '../../src/services/inbox-monitor';
import { SessionServiceOptions } from '../../src/services/session';
import { getDefaultInboxMonitorSnapshot, STATE_SCHEMA_VERSION } from '../../src/services/state-store';
import { SessionState } from '../../src/types';

export { assert, DesktopRuntime, resolveSessionLogPath, STATE_SCHEMA_VERSION };

export type SessionController = {
    start(): Promise<SessionState>;
    pause(): SessionState;
    resume(): SessionState;
    stop(reason?: string): SessionState;
    getState(): SessionState;
};

export function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'discord-auto-runtime-'));
}

export function writeDesktopFiles(baseDir: string) {
    const config = createDefaultAppConfig();
    config.channels = [{
        name: 'general',
        id: '123456789012345678',
        referrer: 'https://discord.com/channels/@me/123456789012345678',
        messageGroup: 'default'
    }];

    fs.writeFileSync(path.join(baseDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
    return config;
}

export class FakeSession {
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

export class FakeInboxMonitor implements InboxMonitorController {
    private snapshot = getDefaultInboxMonitorSnapshot();

    loadSettings() {
        return { ...this.snapshot.settings };
    }

    saveSettings(settings: typeof this.snapshot.settings) {
        this.snapshot = {
            ...this.snapshot,
            settings: { ...settings },
            state: {
                ...this.snapshot.state,
                enabled: settings.enabled,
                pollIntervalSeconds: settings.pollIntervalSeconds
            }
        };
        return this.getSnapshot();
    }

    getState() {
        return { ...this.snapshot.state };
    }

    getSnapshot() {
        return {
            settings: { ...this.snapshot.settings },
            state: { ...this.snapshot.state },
            lastSeen: {
                initializedAt: this.snapshot.lastSeen.initializedAt,
                selfUserId: this.snapshot.lastSeen.selfUserId,
                channelMessageIds: { ...this.snapshot.lastSeen.channelMessageIds }
            }
        };
    }

    async start() {
        this.snapshot = {
            ...this.snapshot,
            state: {
                ...this.snapshot.state,
                status: 'running',
                enabled: this.snapshot.settings.enabled
            }
        };
        return this.getState();
    }

    stop() {
        this.snapshot = {
            ...this.snapshot,
            state: {
                ...this.snapshot.state,
                status: 'stopped'
            }
        };
        return this.getState();
    }
}
