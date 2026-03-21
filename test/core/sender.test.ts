import test from 'node:test';
import assert from 'node:assert/strict';
import { createSenderCoordinator, pickNextMessage, runChannel, sendDiscordMessage } from '../../src/core/sender';
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

test('runChannel stops after repeated consecutive rate limits instead of waiting forever', async () => {
    let sends = 0;
    const sleepCalls: number[] = [];

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
            return createResponse(429, { retry_after: 1 });
        },
        sleep: async (ms) => {
            sleepCalls.push(ms);
        },
        random: () => 0
    });

    assert.equal(sends, 3);
    assert.deepEqual(sleepCalls, [1500, 1500]);
});
