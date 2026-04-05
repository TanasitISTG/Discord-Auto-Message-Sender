import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createBufferedFileWriter, createStructuredLogger } from '../../src/utils/logger';

test('structured logger emits stable log entries to configured sinks', () => {
    const entries: Array<{ context: string; message: string; sessionId?: string }> = [];
    const logger = createStructuredLogger({
        defaults: {
            sessionId: 'session-1',
        },
        sinks: [
            (entry) => {
                entries.push({
                    context: entry.context,
                    message: entry.message,
                    sessionId: entry.sessionId,
                });
            },
        ],
    });

    const entry = logger.emit({
        context: 'System',
        level: 'info',
        message: 'Logger online',
    });

    assert.equal(entry.sessionId, 'session-1');
    assert.equal(entries[0].message, 'Logger online');
});

test('structured logger caps retained entries to the configured maximum', () => {
    const logger = createStructuredLogger({
        maxEntries: 2,
    });

    logger.emit({ context: 'System', level: 'info', message: 'one' });
    logger.emit({ context: 'System', level: 'info', message: 'two' });
    logger.emit({ context: 'System', level: 'info', message: 'three' });

    assert.deepEqual(
        logger.getEntries().map((entry) => entry.message),
        ['two', 'three'],
    );
});

test('buffered file writer flushes queued entries on close', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-auto-log-writer-'));
    const filePath = path.join(tempDir, 'session.jsonl');
    const writer = createBufferedFileWriter(filePath);

    writer.sink({
        id: 'entry-1',
        timestamp: '2026-03-22T00:00:00.000Z',
        level: 'info',
        context: 'System',
        message: 'hello',
    });

    await writer.close();

    const contents = fs.readFileSync(filePath, 'utf8');
    assert.match(contents, /"message":"hello"/);
});
