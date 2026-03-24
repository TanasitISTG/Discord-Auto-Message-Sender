import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboxMonitorService } from '../../src/services/inbox-monitor';
import { getDefaultInboxMonitorSnapshot } from '../../src/services/state-store';
import { AppEvent } from '../../src/types';

function createResponse(status: number, body: unknown) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json'
        }
    });
}

function createFetch(fn: (input: RequestInfo | URL) => Promise<Response>): typeof fetch {
    return Object.assign(fn, { preconnect: () => undefined }) as typeof fetch;
}

test('inbox monitor establishes a silent baseline before notifying on later DMs', async () => {
    const snapshot = getDefaultInboxMonitorSnapshot();
    snapshot.settings.enabled = true;

    let latestMessages = [{
        id: '100',
        content: 'first',
        timestamp: '2026-03-24T10:00:00.000Z',
        author: { id: 'friend-1', username: 'friend' }
    }];
    let sleepCount = 0;
    const notifications: AppEvent[] = [];
    const monitor = createInboxMonitorService({
        initialSnapshot: snapshot,
        emitEvent: (event) => notifications.push(event),
        fetchImpl: createFetch(async (input) => {
            const url = String(input);
            if (url.endsWith('/users/@me')) {
                return createResponse(200, { id: 'self-user' });
            }
            if (url.endsWith('/users/@me/channels')) {
                return createResponse(200, [{
                    id: 'dm-1',
                    type: 1,
                    recipients: [{ id: 'friend-1', username: 'friend' }]
                }]);
            }
            if (url.includes('/channels/dm-1/messages')) {
                return createResponse(200, latestMessages);
            }
            throw new Error(`Unexpected URL ${url}`);
        }),
        sleep: async () => {
            sleepCount += 1;
            if (sleepCount === 1) {
                latestMessages = [{
                    id: '101',
                    content: 'second',
                    timestamp: '2026-03-24T10:01:00.000Z',
                    author: { id: 'friend-1', username: 'friend' }
                }, ...latestMessages];
                return;
            }
            monitor.stop();
        }
    });

    await monitor.start({ token: 'token' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const inboxEvents = notifications.filter((event) => event.type === 'inbox_notification_ready');
    assert.equal(inboxEvents.length, 1);
    assert.equal(inboxEvents[0].notification.messageId, '101');
});

test('inbox monitor does not notify for self-authored messages', async () => {
    const snapshot = getDefaultInboxMonitorSnapshot();
    snapshot.settings.enabled = true;

    let latestMessages = [{
        id: '200',
        content: 'hello from me',
        timestamp: '2026-03-24T10:00:00.000Z',
        author: { id: 'self-user', username: 'me' }
    }];
    const notifications: AppEvent[] = [];
    const monitor = createInboxMonitorService({
        initialSnapshot: snapshot,
        emitEvent: (event) => notifications.push(event),
        fetchImpl: createFetch(async (input) => {
            const url = String(input);
            if (url.endsWith('/users/@me')) {
                return createResponse(200, { id: 'self-user' });
            }
            if (url.endsWith('/users/@me/channels')) {
                return createResponse(200, [{
                    id: 'dm-1',
                    type: 1,
                    recipients: [{ id: 'friend-1', username: 'friend' }]
                }]);
            }
            if (url.includes('/channels/dm-1/messages')) {
                return createResponse(200, latestMessages);
            }
            throw new Error(`Unexpected URL ${url}`);
        }),
        sleep: async () => {
            latestMessages = [{
                id: '201',
                content: 'follow-up from me',
                timestamp: '2026-03-24T10:01:00.000Z',
                author: { id: 'self-user', username: 'me' }
            }, ...latestMessages];
            monitor.stop();
        }
    });

    await monitor.start({ token: 'token' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(notifications.filter((event) => event.type === 'inbox_notification_ready').length, 0);
});

test('inbox monitor surfaces a failed state after HTTP 401', async () => {
    const snapshot = getDefaultInboxMonitorSnapshot();
    snapshot.settings.enabled = true;

    const states: string[] = [];
    const monitor = createInboxMonitorService({
        initialSnapshot: snapshot,
        emitEvent: (event) => {
            if (event.type === 'inbox_monitor_state_changed') {
                states.push(event.monitor.status);
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
        })
    });

    await monitor.start({ token: 'token' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(states.includes('failed'));
});

test('inbox monitor emits a degraded state after HTTP 429', async () => {
    const snapshot = getDefaultInboxMonitorSnapshot();
    snapshot.settings.enabled = true;

    const states: string[] = [];
    const monitor = createInboxMonitorService({
        initialSnapshot: snapshot,
        emitEvent: (event) => {
            if (event.type === 'inbox_monitor_state_changed') {
                states.push(event.monitor.status);
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
        }
    });

    await monitor.start({ token: 'token' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(states.includes('degraded'));
});
