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

test('SessionStateFlusher shares synchronous flush failures with concurrent callers and recovers on retry', async () => {
    let shouldThrow = true;
    let successfulFlushes = 0;
    const flusher = new SessionStateFlusher(250, () => {
        if (shouldThrow) {
            shouldThrow = false;
            throw new Error('sync flush failure');
        }

        successfulFlushes += 1;
    });

    flusher.schedule();
    flusher.clearTimer();

    const results = await Promise.allSettled([flusher.flushNow(), flusher.flushNow()]);

    assert.equal(results[0]?.status, 'rejected');
    assert.equal(results[1]?.status, 'rejected');
    assert.match(String(results[0]?.status === 'rejected' ? results[0].reason : ''), /sync flush failure/);
    assert.match(String(results[1]?.status === 'rejected' ? results[1].reason : ''), /sync flush failure/);

    flusher.schedule();
    flusher.clearTimer();
    await flusher.flushNow();

    assert.equal(successfulFlushes, 1);
});
