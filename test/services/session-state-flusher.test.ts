import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStateFlusher } from '../../src/application/session/session-state-flusher';

test('SessionStateFlusher drains follow-up flushes scheduled during an active flush', async () => {
    let flushCount = 0;
    let releaseFirstFlush: (() => void) | undefined;

    const firstFlushStarted = new Promise<void>((resolve) => {
        releaseFirstFlush = resolve;
    });

    let firstFlushObserved = false;
    const flusher = new SessionStateFlusher(250, async () => {
        flushCount += 1;
        if (!firstFlushObserved) {
            firstFlushObserved = true;
            await firstFlushStarted;
        }
    });

    flusher.schedule();
    flusher.clearTimer();
    const flushPromise = flusher.flushNow();

    while (!firstFlushObserved) {
        await new Promise((resolve) => setImmediate(resolve));
    }

    flusher.schedule();
    flusher.clearTimer();
    releaseFirstFlush?.();

    await flushPromise;

    assert.equal(flushCount, 2);
});
