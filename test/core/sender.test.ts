import test from 'node:test';
import assert from 'node:assert/strict';
import { createSenderCoordinator, getQuietHoursDelayMs, getSuppressionDelayMs, pickNextMessage, runChannel, sendDiscordMessage } from '../../src/core/sender';
import { AppChannel } from '../../src/types';

const channel: AppChannel = {
    name: 'general',
    id: '123456789012345678',
    referrer: 'https://discord.com/channels/@me/123456789012345678',
    messageGroup: 'default'
};

function createResponse(status: number, body: unknown): Response {
    return new Response(body === undefined ? undefined : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

test('sendDiscordMessage returns wait outcome for 429 responses', async () => {
    const result = await sendDiscordMessage(channel, 'Hello!', 'token', 'UA', {
        fetchImpl: async () => createResponse(429, { retry_after: 1.25 })
    });

    assert.deepEqual(result, { type: 'wait', waitSeconds: 1.25 });
});

test('sendDiscordMessage stops immediately on fatal HTTP status codes', async () => {
    const expectedReasons = new Map([
        [401, 'unauthorized'],
        [403, 'forbidden'],
        [404, 'not_found']
    ]);

    for (const status of [401, 403, 404] as const) {
        const result = await sendDiscordMessage(channel, 'Hello!', 'token', 'UA', {
            fetchImpl: async () => createResponse(status, { code: status })
        });

        assert.deepEqual(result, { type: 'fatal', reason: expectedReasons.get(status) });
    }
});

test('sendDiscordMessage retries transient network failures up to the attempt limit', async () => {
    let attempts = 0;
    const sleepCalls: number[] = [];

    const result = await sendDiscordMessage(channel, 'Hello!', 'token', 'UA', {
        fetchImpl: async () => {
            attempts += 1;
            throw new Error('socket hang up');
        },
        sleep: async (ms) => {
            sleepCalls.push(ms);
        },
        random: () => 0
    });

    assert.deepEqual(result, { type: 'fatal', reason: 'exhausted' });
    assert.equal(attempts, 3);
    assert.deepEqual(sleepCalls, [500, 1000]);
});

test('sendDiscordMessage aborts later sends after a shared 401 response', async () => {
    const coordinator = createSenderCoordinator(0);
    let attempts = 0;

    const unauthorizedResult = await sendDiscordMessage(channel, 'Hello!', 'token', 'UA', {
        coordinator,
        fetchImpl: async () => {
            attempts += 1;
            return createResponse(401, { code: 401 });
        }
    });

    const abortedResult = await sendDiscordMessage({
        ...channel,
        id: '223456789012345678',
        referrer: 'https://discord.com/channels/@me/223456789012345678'
    }, 'Hello again!', 'token', 'UA', {
        coordinator,
        fetchImpl: async () => {
            attempts += 1;
            return createResponse(200, {});
        }
    });

    assert.deepEqual(unauthorizedResult, { type: 'fatal', reason: 'unauthorized' });
    assert.deepEqual(abortedResult, { type: 'fatal', reason: 'aborted' });
    assert.equal(attempts, 1);
});

test('shared sender coordinator increases pacing after rate limits and decays after success', () => {
    const coordinator = createSenderCoordinator(250);

    const afterRateLimit = coordinator.recordRateLimit(2);
    const afterRecovery = coordinator.recordSuccess();

    assert.equal(afterRateLimit.baseRequestIntervalMs, 250);
    assert.ok(afterRateLimit.currentRequestIntervalMs > 250);
    assert.ok(afterRateLimit.maxRequestIntervalMs >= afterRateLimit.currentRequestIntervalMs);
    assert.ok(afterRecovery.currentRequestIntervalMs <= afterRateLimit.currentRequestIntervalMs);
    assert.ok(afterRecovery.currentRequestIntervalMs >= 250);
});

test('shared sender coordinator serializes concurrent requests across channels', async () => {
    const coordinator = createSenderCoordinator(0);
    let concurrentRequests = 0;
    let maxConcurrentRequests = 0;

    const fetchImpl = async () => {
        concurrentRequests += 1;
        maxConcurrentRequests = Math.max(maxConcurrentRequests, concurrentRequests);
        await new Promise<void>((resolve) => setImmediate(resolve));
        concurrentRequests -= 1;
        return createResponse(200, {});
    };

    await Promise.all([
        sendDiscordMessage(channel, 'Hello!', 'token', 'UA', { coordinator, fetchImpl }),
        sendDiscordMessage({
            ...channel,
            id: '323456789012345678',
            referrer: 'https://discord.com/channels/@me/323456789012345678'
        }, 'Hello again!', 'token', 'UA', { coordinator, fetchImpl })
    ]);

    assert.equal(maxConcurrentRequests, 1);
});

test('shared sender coordinator preserves the minimum interval even when requests fail', async () => {
    const coordinator = createSenderCoordinator(1000);
    const sleepCalls: number[] = [];
    const startTimes: number[] = [];
    const originalDateNow = Date.now;
    let now = 0;

    Date.now = () => now;

    try {
        const sleep = async (ms: number) => {
            sleepCalls.push(ms);
            now += ms;
        };

        const failingTask = async () => {
            startTimes.push(now);
            throw new Error('boom');
        };

        await Promise.allSettled([
            coordinator.scheduleRequest(sleep, failingTask),
            coordinator.scheduleRequest(sleep, failingTask)
        ]);
    } finally {
        Date.now = originalDateNow;
    }

    assert.deepEqual(sleepCalls, [250, 250, 250, 250]);
    assert.equal(sleepCalls.reduce((total, value) => total + value, 0), 1000);
    assert.deepEqual(startTimes, [0, 1000]);
});

test('sendDiscordMessage times out hung requests so the shared coordinator queue can keep moving', async () => {
    const coordinator = createSenderCoordinator(0);
    const callOrder: string[] = [];

    const firstSend = sendDiscordMessage(channel, 'Hello!', 'token', 'UA', {
        coordinator,
        requestTimeoutMs: 5,
        sleep: async () => {},
        random: () => 0,
        fetchImpl: async (url, init) => {
            const signal = init?.signal;
            if (String(url).includes(channel.id)) {
                callOrder.push('first');
                return await new Promise<Response>((resolve, reject) => {
                    signal?.addEventListener('abort', () => reject(new Error('aborted by timeout')), { once: true });
                });
            }

            callOrder.push('second');
            return createResponse(200, {});
        }
    });

    const secondSend = sendDiscordMessage({
        ...channel,
        id: '423456789012345678',
        referrer: 'https://discord.com/channels/@me/423456789012345678'
    }, 'Hello again!', 'token', 'UA', {
        coordinator,
        requestTimeoutMs: 5,
        sleep: async () => {},
        random: () => 0,
        fetchImpl: async (url, init) => {
            const signal = init?.signal;
            if (String(url).includes(channel.id)) {
                callOrder.push('first');
                return await new Promise<Response>((resolve, reject) => {
                    signal?.addEventListener('abort', () => reject(new Error('aborted by timeout')), { once: true });
                });
            }

            callOrder.push('second');
            return createResponse(200, {});
        }
    });

    const [firstResult, secondResult] = await Promise.race([
        Promise.all([firstSend, secondSend]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out waiting for queued sends')), 200))
    ]);

    assert.deepEqual(firstResult, { type: 'fatal', reason: 'exhausted' });
    assert.deepEqual(secondResult, { type: 'success' });
    assert.ok(callOrder.includes('second'));
});

test('pickNextMessage avoids repeats until the group is exhausted', () => {
    const sentCache = new Set<string>();
    const sequence = [0.0, 0.5, 0.9];
    let index = 0;

    const first = pickNextMessage(['A', 'B', 'C'], sentCache, () => sequence[index++]);
    const second = pickNextMessage(['A', 'B', 'C'], sentCache, () => sequence[index++]);
    const third = pickNextMessage(['A', 'B', 'C'], sentCache, () => sequence[index++]);

    assert.equal(new Set([first, second, third]).size, 3);
});

test('pickNextMessage supports single-message groups', () => {
    const sentCache = new Set<string>();

    const first = pickNextMessage(['Only'], sentCache, () => 0);
    const second = pickNextMessage(['Only'], sentCache, () => 0);

    assert.equal(first, 'Only');
    assert.equal(second, 'Only');
});

test('pickNextMessage terminates with deterministic random when one option remains', () => {
    const sentCache = new Set<string>(['A']);

    const next = pickNextMessage(['A', 'B'], sentCache, () => 0);

    assert.equal(next, 'B');
});

test('pickNextMessage handles duplicate message content without looping', () => {
    const sentCache = new Set<string>();

    const first = pickNextMessage(['A', 'A'], sentCache, () => 0);
    const second = pickNextMessage(['A', 'A'], sentCache, () => 0);

    assert.equal(first, 'A');
    assert.equal(second, 'A');
});

test('pickNextMessage preserves duplicate weighting among remaining unsent messages', () => {
    const sentCache = new Set<string>();

    const weightedPick = pickNextMessage(['A', 'A', 'B'], sentCache, () => 0.5);
    const forcedRemainingPick = pickNextMessage(['A', 'A', 'B'], sentCache, () => 0);

    assert.equal(weightedPick, 'A');
    assert.equal(forcedRemainingPick, 'B');
});

test('getQuietHoursDelayMs returns remaining quiet-time for same-day windows', () => {
    const delayMs = getQuietHoursDelayMs({
        ...channel,
        schedule: {
            intervalSeconds: 5,
            randomMarginSeconds: 0,
            timezone: 'UTC',
            quietHours: {
                start: '09:00',
                end: '17:00'
            }
        }
    }, new Date('2026-03-21T10:15:00.000Z'));

    assert.equal(delayMs, 24_300_000);
});

test('getQuietHoursDelayMs returns remaining quiet-time for overnight windows', () => {
    const delayMs = getQuietHoursDelayMs({
        ...channel,
        schedule: {
            intervalSeconds: 5,
            randomMarginSeconds: 0,
            timezone: 'UTC',
            quietHours: {
                start: '22:00',
                end: '06:00'
            }
        }
    }, new Date('2026-03-21T23:30:00.000Z'));

    assert.equal(delayMs, 23_400_000);
});

test('runChannel waits out quiet hours before sending', async () => {
    let sends = 0;
    const sleepCalls: number[] = [];
    let now = Date.parse('2026-03-21T10:15:00.000Z');

    await runChannel({
        target: {
            ...channel,
            schedule: {
                intervalSeconds: 0,
                randomMarginSeconds: 0,
                timezone: 'UTC',
                quietHours: {
                    start: '09:00',
                    end: '17:00'
                }
            }
        },
        numMessages: 1,
        baseWaitSeconds: 0,
        marginSeconds: 0,
        token: 'token',
        userAgent: 'UA',
        messageGroups: {
            default: ['Hello!']
        },
        fetchImpl: async () => {
            sends += 1;
            return createResponse(200, {});
        },
        sleep: async (ms) => {
            sleepCalls.push(ms);
            now += ms;
        },
        now: () => new Date(now),
        random: () => 0
    });

    assert.equal(sends, 1);
    assert.equal(sleepCalls[0], 24_300_000);
});

test('runChannel stops exactly at the finite message count without an extra wait', async () => {
    let sends = 0;
    const sleepCalls: number[] = [];

    await runChannel({
        target: channel,
        numMessages: 1,
        baseWaitSeconds: 10,
        marginSeconds: 0,
        token: 'token',
        userAgent: 'UA',
        messageGroups: {
            default: ['Hello!']
        },
        fetchImpl: async () => {
            sends += 1;
            return createResponse(200, {});
        },
        sleep: async (ms) => {
            sleepCalls.push(ms);
        },
        random: () => 0
    });

    assert.equal(sends, 1);
    assert.deepEqual(sleepCalls, []);
});

test('runChannel suppresses a channel after repeated consecutive rate limits and retries later', async () => {
    let sends = 0;
    const sleepCalls: number[] = [];
    const suppressed: string[] = [];

    await runChannel({
        target: channel,
        numMessages: 1,
        baseWaitSeconds: 0,
        marginSeconds: 0,
        token: 'token',
        userAgent: 'UA',
        messageGroups: {
            default: ['Hello!']
        },
        maxRateLimitWaits: 2,
        fetchImpl: async () => {
            sends += 1;
            if (sends <= 3) {
                return createResponse(429, { retry_after: 1 });
            }

            return createResponse(200, {});
        },
        sleep: async (ms) => {
            sleepCalls.push(ms);
        },
        random: () => 0,
        lifecycle: {
            isPaused: () => false,
            waitUntilResumed: async () => true,
            isStopping: () => false,
            getStopReason: () => null,
            onChannelSuppressed: (_target, details) => {
                suppressed.push(details.suppressedUntil);
            }
        }
    });

    assert.equal(sends, 4);
    assert.equal(suppressed.length, 1);
    assert.equal(sleepCalls.reduce((total, value) => total + value, 0), 1500 + 1500 + getSuppressionDelayMs(1, 3));
});
