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

test('sendDiscordMessage returns wait outcome for 429 responses', async () => {
    const result = await sendDiscordMessage(channel, 'Hello!', 'token', 'UA', {
        fetchImpl: async () => createResponse(429, { retry_after: 1.25 }),
    });

    assert.deepEqual(result, { type: 'wait', waitSeconds: 1.25 });
});

test('sendDiscordMessage stops immediately on fatal HTTP status codes', async () => {
    const expectedReasons = new Map([
        [401, 'unauthorized'],
        [403, 'forbidden'],
        [404, 'not_found'],
    ]);

    for (const status of [401, 403, 404] as const) {
        const result = await sendDiscordMessage(channel, 'Hello!', 'token', 'UA', {
            fetchImpl: async () => createResponse(status, { code: status }),
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
        random: () => 0,
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
        },
    });

    const abortedResult = await sendDiscordMessage(
        {
            ...channel,
            id: '223456789012345678',
            referrer: 'https://discord.com/channels/@me/223456789012345678',
        },
        'Hello again!',
        'token',
        'UA',
        {
            coordinator,
            fetchImpl: async () => {
                attempts += 1;
                return createResponse(200, {});
            },
        },
    );

    assert.deepEqual(unauthorizedResult, { type: 'fatal', reason: 'unauthorized' });
    assert.deepEqual(abortedResult, { type: 'fatal', reason: 'aborted' });
    assert.equal(attempts, 1);
});

test(
    'sendDiscordMessage times out hung requests so the shared coordinator queue can keep moving',
    { timeout: 2000 },
    async () => {
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
                        signal?.addEventListener('abort', () => reject(new Error('aborted by timeout')), {
                            once: true,
                        });
                    });
                }

                callOrder.push('second');
                return createResponse(200, {});
            },
        });

        const secondSend = sendDiscordMessage(
            {
                ...channel,
                id: '423456789012345678',
                referrer: 'https://discord.com/channels/@me/423456789012345678',
            },
            'Hello again!',
            'token',
            'UA',
            {
                coordinator,
                requestTimeoutMs: 5,
                sleep: async () => {},
                random: () => 0,
                fetchImpl: async (url, init) => {
                    const signal = init?.signal;
                    if (String(url).includes(channel.id)) {
                        callOrder.push('first');
                        return await new Promise<Response>((resolve, reject) => {
                            signal?.addEventListener('abort', () => reject(new Error('aborted by timeout')), {
                                once: true,
                            });
                        });
                    }

                    callOrder.push('second');
                    return createResponse(200, {});
                },
            },
        );

        const [firstResult, secondResult] = await Promise.all([firstSend, secondSend]);

        assert.deepEqual(firstResult, { type: 'fatal', reason: 'exhausted' });
        assert.deepEqual(secondResult, { type: 'success' });
        assert.ok(callOrder.includes('second'));
    },
);

test('sendDiscordMessage aborts an in-flight request when the shared coordinator stops', async () => {
    const coordinator = createSenderCoordinator(0);
    let started = false;

    const sendPromise = sendDiscordMessage(channel, 'Hello!', 'token', 'UA', {
        coordinator,
        requestTimeoutMs: 1000,
        sleep: async () => {},
        fetchImpl: async (_url, init) => {
            started = true;
            return await new Promise<Response>((_, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
                    once: true,
                });
            });
        },
    });

    while (!started) {
        await new Promise((resolve) => setImmediate(resolve));
    }

    coordinator.abort('Stop requested from test.');

    const result = await sendPromise;
    assert.deepEqual(result, { type: 'fatal', reason: 'aborted' });
});
