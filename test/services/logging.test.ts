import test from 'node:test';
import assert from 'node:assert/strict';
import { createStructuredLogger } from '../../src/utils/logger';

test('structured logger emits stable log entries to configured sinks', () => {
    const entries: Array<{ context: string; message: string; sessionId?: string }> = [];
    const logger = createStructuredLogger({
        defaults: {
            sessionId: 'session-1'
        },
        sinks: [
            (entry) => {
                entries.push({
                    context: entry.context,
                    message: entry.message,
                    sessionId: entry.sessionId
                });
            }
        ]
    });

    const entry = logger.emit({
        context: 'System',
        level: 'info',
        message: 'Logger online'
    });

    assert.equal(entry.sessionId, 'session-1');
    assert.equal(entries[0].message, 'Logger online');
});
