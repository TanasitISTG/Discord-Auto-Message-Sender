import test from 'node:test';
import fs from 'fs';
import path from 'path';
import {
    assert,
    createTempDir,
    DesktopRuntime,
    FakeInboxMonitor,
    STATE_SCHEMA_VERSION,
    resolveSessionLogPath,
    writeDesktopFiles
} from './runtime-test-helpers';

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

test('DesktopRuntime saves inbox monitor settings and starts/stops the monitor', async () => {
    const tempDir = createTempDir();
    writeDesktopFiles(tempDir);
    const runtime = new DesktopRuntime({
        baseDir: tempDir,
        inboxMonitorFactory: () => new FakeInboxMonitor()
    });

    const saved = runtime.saveInboxMonitorSettings({
        settings: {
            enabled: true,
            pollIntervalSeconds: 45,
            notifyDirectMessages: true,
            notifyMessageRequests: false
        }
    });
    const started = await runtime.startInboxMonitor({ token: 'token' });
    const stopped = runtime.stopInboxMonitor();

    assert.equal(saved.settings.enabled, true);
    assert.equal(saved.settings.pollIntervalSeconds, 45);
    assert.equal(started.status, 'running');
    assert.equal(stopped.status, 'stopped');
});
