import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboxMonitorService } from '../../src/services/inbox-monitor';
import { pollInboxSnapshot } from '../../src/application/inbox-monitor/poller';
import { getDefaultInboxMonitorSnapshot } from '../../src/services/state-store';
import { AppEvent } from '../../src/types';

function createDeferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((nextResolve) => {
        resolve = nextResolve;
    });

    return { promise, resolve };
}

function createResponse(status: number, body: unknown) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
        },
    });
}

function createFetch(fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
    return Object.assign(fn, { preconnect: () => undefined }) as typeof fetch;
}

test('inbox monitor establishes a silent baseline before notifying on later DMs', async () => {
    const snapshot = getDefaultInboxMonitorSnapshot();
    snapshot.settings.enabled = true;

    let latestMessages = [
        {
            id: '100',
            content: 'first',
            timestamp: '2026-03-24T10:00:00.000Z',
            author: { id: 'friend-1', username: 'friend' },
        },
    ];
    let sleepCount = 0;
    const notifications: AppEvent[] = [];
    const notificationReady = createDeferred<void>();
    const monitor = createInboxMonitorService({
        initialSnapshot: snapshot,
        emitEvent: (event) => {
            notifications.push(event);
            if (event.type === 'inbox_notification_ready') {
                notificationReady.resolve();
            }
        },
        fetchImpl: createFetch(async (input) => {
            const url = String(input);
            if (url.endsWith('/users/@me')) {
                return createResponse(200, { id: 'self-user' });
            }
            if (url.endsWith('/users/@me/channels')) {
                return createResponse(200, [
                    {
                        id: 'dm-1',
                        type: 1,
                        recipients: [{ id: 'friend-1', username: 'friend' }],
                    },
                ]);
            }
            if (url.includes('/channels/dm-1/messages')) {
                return createResponse(200, latestMessages);
            }
            throw new Error(`Unexpected URL ${url}`);
        }),
        sleep: async () => {
            sleepCount += 1;
            if (sleepCount === 1) {
                latestMessages = [
                    {
                        id: '101',
                        content: 'second',
                        timestamp: '2026-03-24T10:01:00.000Z',
                        author: { id: 'friend-1', username: 'friend' },
                    },
                    ...latestMessages,
                ];
                return;
            }
            monitor.stop();
        },
    });

    await monitor.start({ token: 'token' });
    await notificationReady.promise;

    const inboxEvents = notifications.filter((event) => event.type === 'inbox_notification_ready');
    assert.equal(inboxEvents.length, 1);
    assert.equal(inboxEvents[0].notification.messageId, '101');
});

test('inbox monitor does not notify for self-authored messages', async () => {
    const snapshot = getDefaultInboxMonitorSnapshot();
    snapshot.settings.enabled = true;

    let latestMessages = [
        {
            id: '200',
            content: 'hello from me',
            timestamp: '2026-03-24T10:00:00.000Z',
            author: { id: 'self-user', username: 'me' },
        },
    ];
    const notifications: AppEvent[] = [];
    const stopCompleted = createDeferred<void>();
    const monitor = createInboxMonitorService({
        initialSnapshot: snapshot,
        emitEvent: (event) => notifications.push(event),
        fetchImpl: createFetch(async (input) => {
            const url = String(input);
            if (url.endsWith('/users/@me')) {
                return createResponse(200, { id: 'self-user' });
            }
            if (url.endsWith('/users/@me/channels')) {
                return createResponse(200, [
                    {
                        id: 'dm-1',
                        type: 1,
                        recipients: [{ id: 'friend-1', username: 'friend' }],
                    },
                ]);
            }
            if (url.includes('/channels/dm-1/messages')) {
                return createResponse(200, latestMessages);
            }
            throw new Error(`Unexpected URL ${url}`);
        }),
        sleep: async () => {
            latestMessages = [
                {
                    id: '201',
                    content: 'follow-up from me',
                    timestamp: '2026-03-24T10:01:00.000Z',
                    author: { id: 'self-user', username: 'me' },
                },
                ...latestMessages,
            ];
            monitor.stop();
            stopCompleted.resolve();
        },
    });

    await monitor.start({ token: 'token' });
    await stopCompleted.promise;

    assert.equal(notifications.filter((event) => event.type === 'inbox_notification_ready').length, 0);
});

test('inbox monitor surfaces a failed state after HTTP 401', async () => {
    const snapshot = getDefaultInboxMonitorSnapshot();
    snapshot.settings.enabled = true;

    const states: string[] = [];
    const failedState = createDeferred<void>();
    const monitor = createInboxMonitorService({
        initialSnapshot: snapshot,
        emitEvent: (event) => {
            if (event.type === 'inbox_monitor_state_changed') {
                states.push(event.monitor.status);
                if (event.monitor.status === 'failed') {
                    failedState.resolve();
                }
            }
        },
        fetchImpl: createFetch(async (input) => {
            const url = String(input);
            if (url.endsWith('/users/@me')) {
                return createResponse(200, { id: 'self-user' });
            }
            if (url.endsWith('/users/@me/channels')) {
                return createResponse(401, { message: 'Unauthorized' });
            }
            throw new Error(`Unexpected URL ${url}`);
        }),
    });

    await monitor.start({ token: 'token' });
    await failedState.promise;

    assert.ok(states.includes('failed'));
});

test('inbox monitor emits a degraded state after HTTP 429', async () => {
    const snapshot = getDefaultInboxMonitorSnapshot();
    snapshot.settings.enabled = true;

    const states: string[] = [];
    const degradedState = createDeferred<void>();
    const monitor = createInboxMonitorService({
        initialSnapshot: snapshot,
        emitEvent: (event) => {
            if (event.type === 'inbox_monitor_state_changed') {
                states.push(event.monitor.status);
                if (event.monitor.status === 'degraded') {
                    degradedState.resolve();
                }
            }
        },
        fetchImpl: createFetch(async (input) => {
            const url = String(input);
            if (url.endsWith('/users/@me')) {
                return createResponse(200, { id: 'self-user' });
            }
            if (url.endsWith('/users/@me/channels')) {
                return createResponse(429, { message: 'Rate limited' });
            }
            throw new Error(`Unexpected URL ${url}`);
        }),
        sleep: async () => {
            monitor.stop();
        },
    });

    await monitor.start({ token: 'token' });
    await degradedState.promise;

    assert.ok(states.includes('degraded'));
});

test('inbox monitor stops the active loop when settings are disabled', async () => {
    const snapshot = getDefaultInboxMonitorSnapshot();
    snapshot.settings.enabled = true;

    let channelFetchCount = 0;
    const stoppedState = createDeferred<void>();
    const monitor = createInboxMonitorService({
        initialSnapshot: snapshot,
        emitEvent: (event) => {
            if (event.type === 'inbox_monitor_state_changed' && event.monitor.status === 'stopped') {
                stoppedState.resolve();
            }
        },
        fetchImpl: createFetch(async (input) => {
            const url = String(input);
            if (url.endsWith('/users/@me')) {
                return createResponse(200, { id: 'self-user' });
            }
            if (url.endsWith('/users/@me/channels')) {
                channelFetchCount += 1;
                return createResponse(200, [
                    {
                        id: 'dm-1',
                        type: 1,
                        recipients: [{ id: 'friend-1', username: 'friend' }],
                    },
                ]);
            }
            if (url.includes('/channels/dm-1/messages')) {
                return createResponse(200, [
                    {
                        id: '300',
                        content: 'hello',
                        timestamp: '2026-03-24T10:00:00.000Z',
                        author: { id: 'friend-1', username: 'friend' },
                    },
                ]);
            }
            throw new Error(`Unexpected URL ${url}`);
        }),
        sleep: async () => {
            monitor.saveSettings({
                ...monitor.loadSettings(),
                enabled: false,
            });
        },
    });

    await monitor.start({ token: 'token' });
    await stoppedState.promise;

    assert.equal(channelFetchCount, 1);
    assert.equal(monitor.getState().status, 'stopped');
});

test('inbox monitor restarts cleanly when the token changes while running', async () => {
    const snapshot = getDefaultInboxMonitorSnapshot();
    snapshot.settings.enabled = true;

    const firstSleepReached = createDeferred<void>();
    const releaseFirstSleep = createDeferred<void>();
    const secondTokenSeen = createDeferred<void>();
    let sleepCalls = 0;

    const monitor = createInboxMonitorService({
        initialSnapshot: snapshot,
        fetchImpl: createFetch(async (input, init) => {
            const url = String(input);
            const token =
                init?.headers instanceof Headers
                    ? (init.headers.get('Authorization') ?? '')
                    : ((init?.headers as Record<string, string> | undefined)?.Authorization ?? '');
            if (url.endsWith('/users/@me')) {
                return createResponse(200, { id: 'self-user' });
            }
            if (url.endsWith('/users/@me/channels')) {
                if (token === 'token-2') {
                    secondTokenSeen.resolve();
                }
                return createResponse(200, [
                    {
                        id: 'dm-1',
                        type: 1,
                        recipients: [{ id: 'friend-1', username: 'friend' }],
                    },
                ]);
            }
            if (url.includes('/channels/dm-1/messages')) {
                return createResponse(200, []);
            }
            throw new Error(`Unexpected URL ${url}`);
        }),
        sleep: async () => {
            sleepCalls += 1;
            if (sleepCalls === 1) {
                firstSleepReached.resolve();
                await releaseFirstSleep.promise;
                return;
            }

            monitor.stop();
        },
    });

    await monitor.start({ token: 'token-1' });
    await firstSleepReached.promise;

    const restartPromise = monitor.start({ token: 'token-2' });
    releaseFirstSleep.resolve();

    await restartPromise;
    await secondTokenSeen.promise;

    assert.equal(monitor.getState().lastError, undefined);
});

test('inbox monitor aborts a hung poll before restarting with a new token', async () => {
    const snapshot = getDefaultInboxMonitorSnapshot();
    snapshot.settings.enabled = true;

    const firstTokenBlocked = createDeferred<void>();
    const secondTokenSeen = createDeferred<void>();

    const monitor = createInboxMonitorService({
        initialSnapshot: snapshot,
        fetchImpl: createFetch(async (input, init) => {
            const url = String(input);
            const token =
                init?.headers instanceof Headers
                    ? (init.headers.get('Authorization') ?? '')
                    : ((init?.headers as Record<string, string> | undefined)?.Authorization ?? '');

            if (url.endsWith('/users/@me')) {
                return createResponse(200, { id: 'self-user' });
            }

            if (url.endsWith('/users/@me/channels') && token === 'token-1') {
                firstTokenBlocked.resolve();
                return await new Promise<Response>((_, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
                        once: true,
                    });
                });
            }

            if (url.endsWith('/users/@me/channels') && token === 'token-2') {
                secondTokenSeen.resolve();
                return createResponse(200, [
                    {
                        id: 'dm-1',
                        type: 1,
                        recipients: [{ id: 'friend-1', username: 'friend' }],
                    },
                ]);
            }

            if (url.includes('/channels/dm-1/messages')) {
                return createResponse(200, []);
            }

            throw new Error(`Unexpected URL ${url}`);
        }),
        sleep: async () => {
            monitor.stop();
        },
    });

    await monitor.start({ token: 'token-1' });
    await firstTokenBlocked.promise;

    await monitor.start({ token: 'token-2' });
    await secondTokenSeen.promise;

    assert.equal(monitor.getState().lastError, undefined);
});

test('pollInboxSnapshot aborts immediately when the incoming signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Aborted', 'AbortError'));

    let fetchCalls = 0;

    await assert.rejects(
        pollInboxSnapshot({
            snapshot: getDefaultInboxMonitorSnapshot(),
            token: 'token',
            fetchImpl: createFetch(async () => {
                fetchCalls += 1;
                return createResponse(200, {});
            }),
            now: () => new Date('2026-03-24T10:00:00.000Z'),
            abortSignal: controller.signal,
        }),
        /Aborted/,
    );

    assert.equal(fetchCalls, 0);
});
