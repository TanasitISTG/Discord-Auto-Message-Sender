import test from 'node:test';
import assert from 'node:assert/strict';
import { createSenderCoordinator } from '../../../src/application/session/pacing-coordinator';
import { sendDiscordMessage } from '../../../src/infrastructure/discord/send-discord-message';
import { AppChannel } from '../../../src/types';

const channel: AppChannel = {
    name: 'general',
    id: '123456789012345678',
    referrer: 'https://discord.com/channels/@me/123456789012345678',
    messageGroup: 'default',
};

function createResponse(status: number, body: unknown): Response {
    return new Response(body === undefined ? undefined : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

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
        sendDiscordMessage(
            {
                ...channel,
                id: '323456789012345678',
                referrer: 'https://discord.com/channels/@me/323456789012345678',
            },
            'Hello again!',
            'token',
            'UA',
            { coordinator, fetchImpl },
        ),
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
            coordinator.scheduleRequest(sleep, failingTask),
        ]);
    } finally {
        Date.now = originalDateNow;
    }

    assert.deepEqual(sleepCalls, [250, 250, 250, 250]);
    assert.equal(
        sleepCalls.reduce((total, value) => total + value, 0),
        1000,
    );
    assert.deepEqual(startTimes, [0, 1000]);
});
