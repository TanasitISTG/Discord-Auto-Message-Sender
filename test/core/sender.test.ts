import test from 'node:test';
import assert from 'node:assert/strict';
import { pickNextMessage, runChannel, sendDiscordMessage } from '../../src/core/sender';
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
    for (const status of [401, 403, 404]) {
        const result = await sendDiscordMessage(channel, 'Hello!', 'token', 'UA', {
            fetchImpl: async () => createResponse(status, { code: status })
        });

        assert.deepEqual(result, { type: 'fatal' });
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

    assert.deepEqual(result, { type: 'fatal' });
    assert.equal(attempts, 3);
    assert.deepEqual(sleepCalls, [500, 1000]);
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

test('pickNextMessage handles duplicate message content without looping', () => {
    const sentCache = new Set<string>();

    const first = pickNextMessage(['A', 'A'], sentCache, () => 0);
    const second = pickNextMessage(['A', 'A'], sentCache, () => 0);

    assert.equal(first, 'A');
    assert.equal(second, 'A');
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
