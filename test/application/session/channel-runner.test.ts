import test from 'node:test';
import assert from 'node:assert/strict';
import { runChannel } from '../../../src/application/session/channel-runner';
import { getSuppressionDelayMs } from '../../../src/domain/session/suppression';
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

test('runChannel resets the daily cap after the configured timezone crosses midnight', async () => {
    let sends = 0;
    let now = Date.parse('2026-03-22T00:00:01.000Z');
    const resumeProgress = {
        channelId: channel.id,
        channelName: channel.name,
        status: 'running' as const,
        sentMessages: 1,
        sentToday: 1,
        sentTodayDayKey: '2026-03-21',
        consecutiveRateLimits: 0,
        lastSentAt: '2026-03-21T23:59:00.000Z',
    };

    await runChannel({
        target: {
            ...channel,
            schedule: {
                intervalSeconds: 2,
                randomMarginSeconds: 0,
                timezone: 'UTC',
                maxSendsPerDay: 1,
            },
        },
        numMessages: 2,
        baseWaitSeconds: 2,
        marginSeconds: 0,
        token: 'token',
        userAgent: 'UA',
        messageGroups: {
            default: ['Hello!'],
        },
        resumeProgress,
        fetchImpl: async () => {
            sends += 1;
            return createResponse(200, {});
        },
        sleep: async (ms) => {
            now += ms;
        },
        now: () => new Date(now),
        random: () => 0,
    });

    assert.equal(sends, 1);
    assert.equal(resumeProgress.sentToday, 1);
    assert.equal(resumeProgress.sentTodayDayKey, '2026-03-22');
});

test('runChannel counts a post-midnight retry against the new day before enforcing the daily cap', async () => {
    let successfulSends = 0;
    let attempts = 0;
    let now = Date.parse('2026-03-21T23:59:59.200Z');

    await runChannel({
        target: {
            ...channel,
            schedule: {
                intervalSeconds: 1,
                randomMarginSeconds: 0,
                timezone: 'UTC',
                maxSendsPerDay: 1,
            },
        },
        numMessages: 2,
        baseWaitSeconds: 1,
        marginSeconds: 0,
        token: 'token',
        userAgent: 'UA',
        messageGroups: {
            default: ['Hello!'],
        },
        fetchImpl: async () => {
            attempts += 1;
            if (attempts === 1) {
                return createResponse(429, { retry_after: 1 });
            }

            successfulSends += 1;
            return createResponse(200, {});
        },
        sleep: async (ms) => {
            now += ms;
        },
        now: () => new Date(now),
        random: () => 0,
    });

    assert.equal(successfulSends, 1);
    assert.equal(attempts, 2);
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
                    end: '17:00',
                },
            },
        },
        numMessages: 1,
        baseWaitSeconds: 0,
        marginSeconds: 0,
        token: 'token',
        userAgent: 'UA',
        messageGroups: {
            default: ['Hello!'],
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
        random: () => 0,
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
            default: ['Hello!'],
        },
        fetchImpl: async () => {
            sends += 1;
            return createResponse(200, {});
        },
        sleep: async (ms) => {
            sleepCalls.push(ms);
        },
        random: () => 0,
    });

    assert.equal(sends, 1);
    assert.deepEqual(sleepCalls, []);
});

test('runChannel suppresses a channel after repeated consecutive rate limits and retries later', async () => {
    let sends = 0;
    const sleepCalls: number[] = [];
    const suppressed: string[] = [];
    let recovered = 0;

    await runChannel({
        target: channel,
        numMessages: 1,
        baseWaitSeconds: 0,
        marginSeconds: 0,
        token: 'token',
        userAgent: 'UA',
        messageGroups: {
            default: ['Hello!'],
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
            },
            onChannelRecovered: () => {
                recovered += 1;
            },
        },
    });

    assert.equal(sends, 4);
    assert.equal(suppressed.length, 1);
    assert.equal(recovered, 1);
    assert.equal(
        sleepCalls.reduce((total, value) => total + value, 0),
        1500 + 1500 + getSuppressionDelayMs(1, 3),
    );
});
