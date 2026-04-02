import { InboxMonitorLastSeen, InboxMonitorSnapshot, InboxNotificationItem, InboxNotificationKind } from '../../types';
import {
    buildChannelName,
    compareSnowflakes,
    InboxChannel,
    InboxMessage,
    isMessageRequestChannel,
} from './notifications';
import type { FetchImpl, MonitorPollResult } from './snapshot';

const API_BASE = 'https://discord.com/api/v10';
const MAX_MESSAGES_PER_CHANNEL = 10;
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

interface PollInboxOptions {
    snapshot: InboxMonitorSnapshot;
    token: string;
    fetchImpl: FetchImpl;
    now: () => Date;
    abortSignal: AbortSignal;
}

async function readJson<T>(response: Response): Promise<T> {
    return (await response.json()) as T;
}

async function fetchWithTimeout(
    url: string,
    headers: HeadersInit,
    fetchImpl: FetchImpl,
    abortSignal: AbortSignal,
): Promise<Response> {
    const controller = new AbortController();
    const abortListener = () => {
        controller.abort(abortSignal.reason);
    };
    abortSignal.addEventListener('abort', abortListener, { once: true });

    let timeoutId: NodeJS.Timeout | undefined;

    try {
        return await Promise.race([
            fetchImpl(url, {
                headers,
                signal: controller.signal,
            }),
            new Promise<Response>((_, reject) => {
                timeoutId = setTimeout(() => {
                    controller.abort();
                    reject(new Error(`Inbox monitor request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms.`));
                }, DEFAULT_REQUEST_TIMEOUT_MS);
            }),
        ]);
    } finally {
        abortSignal.removeEventListener('abort', abortListener);
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

async function fetchSelfUserId(headers: HeadersInit, fetchImpl: FetchImpl, abortSignal: AbortSignal): Promise<string> {
    const response = await fetchWithTimeout(`${API_BASE}/users/@me`, headers, fetchImpl, abortSignal);
    if (!response.ok) {
        throw new Error(`Inbox monitor failed to fetch @me (${response.status}).`);
    }

    const payload = await readJson<{ id: string }>(response);
    return payload.id;
}

async function fetchChannels(
    headers: HeadersInit,
    fetchImpl: FetchImpl,
    abortSignal: AbortSignal,
): Promise<InboxChannel[]> {
    const response = await fetchWithTimeout(`${API_BASE}/users/@me/channels`, headers, fetchImpl, abortSignal);
    if (response.status === 401) {
        throw new Error('Inbox monitor received HTTP 401 while loading DM channels.');
    }
    if (response.status === 429) {
        throw new Error('Inbox monitor received HTTP 429 while loading DM channels.');
    }
    if (!response.ok) {
        throw new Error(`Inbox monitor failed to load DM channels (${response.status}).`);
    }

    const channels = await readJson<InboxChannel[]>(response);
    return channels.filter((channel) => channel && typeof channel.id === 'string');
}

async function fetchChannelMessages(
    headers: HeadersInit,
    fetchImpl: FetchImpl,
    channelId: string,
    abortSignal: AbortSignal,
): Promise<InboxMessage[]> {
    const response = await fetchWithTimeout(
        `${API_BASE}/channels/${channelId}/messages?limit=${MAX_MESSAGES_PER_CHANNEL}`,
        headers,
        fetchImpl,
        abortSignal,
    );
    if (response.status === 401) {
        throw new Error(`Inbox monitor received HTTP 401 while loading channel ${channelId}.`);
    }
    if (response.status === 429) {
        throw new Error(`Inbox monitor received HTTP 429 while loading channel ${channelId}.`);
    }
    if (!response.ok) {
        throw new Error(`Inbox monitor failed to load channel ${channelId} messages (${response.status}).`);
    }

    const messages = await readJson<InboxMessage[]>(response);
    return messages.filter((message) => message && typeof message.id === 'string');
}

export async function pollInboxSnapshot({
    snapshot,
    token,
    fetchImpl,
    now,
    abortSignal,
}: PollInboxOptions): Promise<MonitorPollResult> {
    const headers = {
        Authorization: token,
        'Content-Type': 'application/json',
    };
    const checkedAt = now().toISOString();
    const selfUserId = snapshot.lastSeen.selfUserId ?? (await fetchSelfUserId(headers, fetchImpl, abortSignal));
    const channels = await fetchChannels(headers, fetchImpl, abortSignal);
    const notifications: InboxNotificationItem[] = [];
    const nextLastSeen: InboxMonitorLastSeen = {
        initializedAt: snapshot.lastSeen.initializedAt ?? checkedAt,
        selfUserId,
        channelMessageIds: { ...snapshot.lastSeen.channelMessageIds },
    };

    for (const channel of channels) {
        const kind: InboxNotificationKind = isMessageRequestChannel(channel) ? 'message_request' : 'direct_message';
        if (
            (kind === 'direct_message' && !snapshot.settings.notifyDirectMessages) ||
            (kind === 'message_request' && !snapshot.settings.notifyMessageRequests)
        ) {
            continue;
        }

        const messages = await fetchChannelMessages(headers, fetchImpl, channel.id, abortSignal);
        if (messages.length === 0) {
            continue;
        }

        const lastSeenMessageId = nextLastSeen.channelMessageIds[channel.id];
        const newestMessageId = messages[0].id;
        const unseenMessages: InboxMessage[] = [];
        for (const message of messages) {
            if (lastSeenMessageId && compareSnowflakes(message.id, lastSeenMessageId) <= 0) {
                break;
            }
            unseenMessages.push(message);
        }

        nextLastSeen.channelMessageIds[channel.id] = newestMessageId;

        if (!snapshot.lastSeen.initializedAt) {
            continue;
        }

        for (const message of unseenMessages.reverse()) {
            const authorId = message.author?.id;
            if (!authorId || authorId === selfUserId) {
                continue;
            }

            notifications.push({
                id: `${kind}:${channel.id}:${message.id}`,
                kind,
                channelId: channel.id,
                channelName: buildChannelName(channel),
                authorId,
                authorName: message.author?.global_name ?? message.author?.username ?? authorId,
                previewText:
                    typeof message.content === 'string' && message.content.trim().length > 0
                        ? message.content.trim().slice(0, 180)
                        : '(No text content)',
                messageId: message.id,
                receivedAt: typeof message.timestamp === 'string' ? message.timestamp : checkedAt,
            });
        }
    }

    return {
        notifications,
        lastSeen: nextLastSeen,
        checkedAt,
    };
}
