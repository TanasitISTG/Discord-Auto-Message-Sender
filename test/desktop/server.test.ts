import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';
import { createDefaultAppConfig } from '../../src/config/schema';
import { STATE_SCHEMA_VERSION } from '../../src/services/state-store';

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'discord-auto-sidecar-'));
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
}

function bunExecutable() {
    return process.platform === 'win32' ? 'bun.exe' : 'bun';
}

test('desktop sidecar serves typed config, dry-run, and state commands over one long-lived process', async () => {
    const tempDir = createTempDir();
    writeDesktopFiles(tempDir);

    const child = spawn(bunExecutable(), ['run', 'src/desktop/server.ts', '--base-dir', tempDir], {
        cwd: path.resolve(__dirname, '..', '..'),
        stdio: ['pipe', 'pipe', 'pipe']
    });

    const reader = readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity
    });

    const pending = new Map<string, (value: unknown) => void>();
    reader.on('line', (line) => {
        const message = JSON.parse(line) as { type: string; id?: string; ok?: boolean; result?: unknown };
        if (message.type === 'response' && message.id) {
            pending.get(message.id)?.(message);
            pending.delete(message.id);
        }
    });

    async function request(command: string, payload: unknown) {
        const id = `${Date.now()}-${Math.random()}`;
        const response = new Promise<{ ok: boolean; result?: unknown; error?: string }>((resolve) => {
            pending.set(id, (value) => resolve(value as { ok: boolean; result?: unknown; error?: string }));
        });
        child.stdin.write(`${JSON.stringify({ id, command, payload })}\n`);
        return await response;
    }

    try {
        const configResponse = await request('load_config', {});
        assert.equal(configResponse.ok, true);
        const configResult = configResponse.result as { kind: string; config?: { channels: Array<{ id: string }> } };
        assert.equal(configResult.kind, 'ok');
        assert.equal(configResult.config?.channels[0]?.id, '123456789012345678');

        const dryRunResponse = await request('run_dry_run', {
            runtime: {
                numMessages: 1,
                baseWaitSeconds: 5,
                marginSeconds: 2
            }
        });
        assert.equal(dryRunResponse.ok, true);
        const dryRunResult = dryRunResponse.result as { willSendMessages: boolean };
        assert.equal(dryRunResult.willSendMessages, true);

        const stateResponse = await request('load_state', {});
        assert.equal(stateResponse.ok, true);
        const senderState = stateResponse.result as { schemaVersion: number; summaries: unknown[] };
        assert.equal(senderState.schemaVersion, STATE_SCHEMA_VERSION);
        assert.ok(Array.isArray(senderState.summaries));

        fs.writeFileSync(path.join(tempDir, '.sender-state.json'), JSON.stringify({
            schemaVersion: STATE_SCHEMA_VERSION,
            summaries: [],
            recentFailures: [],
            resumeSession: {
                sessionId: 'session-resume',
                updatedAt: '2026-03-21T10:00:00.000Z',
                runtime: {
                    numMessages: 1,
                    baseWaitSeconds: 5,
                    marginSeconds: 2
                },
                configSignature: JSON.stringify(JSON.parse(fs.readFileSync(path.join(tempDir, 'config.json'), 'utf8'))),
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

        const discardResponse = await request('discard_resume_session', {});
        assert.equal(discardResponse.ok, true);
        const discardedState = discardResponse.result as { resumeSession?: unknown; schemaVersion: number };
        assert.equal(discardedState.schemaVersion, STATE_SCHEMA_VERSION);
        assert.equal(discardedState.resumeSession, undefined);
    } finally {
        child.kill();
    }
});
