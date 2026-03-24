import {
    AppEvent,
    InboxMonitorLastSeen,
    InboxMonitorSettings,
    InboxMonitorSnapshot,
    InboxMonitorState,
    InboxNotificationItem,
    InboxNotificationKind
} from '../types';
import {
    getDefaultInboxMonitorSettings,
    getDefaultInboxMonitorSnapshot,
    getDefaultInboxMonitorState
} from './state-store';

const API_BASE = 'https://discord.com/api/v10';
const MIN_POLL_INTERVAL_SECONDS = 15;
const MAX_POLL_INTERVAL_SECONDS = 300;
const MAX_MESSAGES_PER_CHANNEL = 10;

type SleepFn = (ms: number) => Promise<void>;
type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface InboxUser {
    id: string;
    username?: string;
    global_name?: string | null;
}

interface InboxChannel {
    id: string;
    type?: number;
    recipients?: InboxUser[];
    name?: string | null;
    is_message_request?: boolean;
    is_message_request_timestamp?: string | null;
    message_request_timestamp?: string | null;
    spam?: boolean;
    is_spam?: boolean;
}

interface InboxMessage {
    id: string;
    channel_id?: string;
    content?: string;
    timestamp?: string;
    author?: InboxUser;
}

interface MonitorPollResult {
    notifications: InboxNotificationItem[];
    lastSeen: InboxMonitorLastSeen;
    checkedAt: string;
}

export interface InboxMonitorOptions {
    initialSnapshot?: InboxMonitorSnapshot;
    emitEvent?: (event: AppEvent) => void;
    onSnapshotChange?: (snapshot: InboxMonitorSnapshot) => void;
    fetchImpl?: FetchImpl;
    sleep?: SleepFn;
    now?: () => Date;
    random?: () => number;
}

export interface StartInboxMonitorOptions {
    token?: string;
}

export interface InboxMonitorController {
    loadSettings(): InboxMonitorSettings;
    saveSettings(settings: InboxMonitorSettings): InboxMonitorSnapshot;
    getState(): InboxMonitorState;
    getSnapshot(): InboxMonitorSnapshot;
    start(options?: StartInboxMonitorOptions): Promise<InboxMonitorState>;
    stop(reason?: string): InboxMonitorState;
}

function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function clampPollIntervalSeconds(value: number): number {
    if (!Number.isFinite(value)) {
        return getDefaultInboxMonitorSettings().pollIntervalSeconds;
    }

    return Math.max(MIN_POLL_INTERVAL_SECONDS, Math.min(MAX_POLL_INTERVAL_SECONDS, Math.round(value)));
}

function normalizeSettings(settings: InboxMonitorSettings): InboxMonitorSettings {
    return {
        enabled: settings.enabled,
        pollIntervalSeconds: clampPollIntervalSeconds(settings.pollIntervalSeconds),
        notifyDirectMessages: settings.notifyDirectMessages,
        notifyMessageRequests: settings.notifyMessageRequests
    };
}

function buildStatePatch(
    state: InboxMonitorState,
    patch: Partial<InboxMonitorState>
): InboxMonitorState {
    return {
        ...state,
        ...patch
    };
}

function buildChannelName(channel: InboxChannel): string {
    if (typeof channel.name === 'string' && channel.name.trim().length > 0) {
        return channel.name;
    }

    const recipients = channel.recipients ?? [];
    if (recipients.length === 0) {
        return channel.id;
    }

    return recipients
        .map((recipient) => recipient.global_name ?? recipient.username ?? recipient.id)
        .join(', ');
}

function isMessageRequestChannel(channel: InboxChannel): boolean {
    return channel.is_message_request === true
        || typeof channel.is_message_request_timestamp === 'string'
        || typeof channel.message_request_timestamp === 'string'
        || channel.is_spam === true
        || channel.spam === true;
}

function compareSnowflakes(left: string, right: string): number {
    try {
        const leftId = BigInt(left);
        const rightId = BigInt(right);
        if (leftId === rightId) {
            return 0;
        }
        return leftId > rightId ? 1 : -1;
    } catch {
        return left.localeCompare(right);
    }
}

async function readJson<T>(response: Response): Promise<T> {
    return await response.json() as T;
}

export class InboxMonitorService implements InboxMonitorController {
    private readonly emitEvent?: (event: AppEvent) => void;
    private readonly onSnapshotChange?: (snapshot: InboxMonitorSnapshot) => void;
    private readonly fetchImpl: FetchImpl;
    private readonly sleepImpl: SleepFn;
    private readonly now: () => Date;
    private readonly random: () => number;
    private snapshot: InboxMonitorSnapshot;
    private running = false;
    private loopPromise: Promise<void> | null = null;
    private currentToken: string | undefined;

    constructor(options: InboxMonitorOptions = {}) {
        this.emitEvent = options.emitEvent;
        this.onSnapshotChange = options.onSnapshotChange;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.sleepImpl = options.sleep ?? sleep;
        this.now = options.now ?? (() => new Date());
        this.random = options.random ?? Math.random;
        this.snapshot = options.initialSnapshot
            ? {
                settings: normalizeSettings(options.initialSnapshot.settings),
                state: {
                    ...options.initialSnapshot.state,
                    pollIntervalSeconds: clampPollIntervalSeconds(options.initialSnapshot.state.pollIntervalSeconds),
                    enabled: options.initialSnapshot.settings.enabled
                },
                lastSeen: {
                    initializedAt: options.initialSnapshot.lastSeen.initializedAt,
                    selfUserId: options.initialSnapshot.lastSeen.selfUserId,
                    channelMessageIds: { ...options.initialSnapshot.lastSeen.channelMessageIds }
                }
            }
            : getDefaultInboxMonitorSnapshot();
    }

    loadSettings(): InboxMonitorSettings {
        return { ...this.snapshot.settings };
    }

    saveSettings(settings: InboxMonitorSettings): InboxMonitorSnapshot {
        const normalized = normalizeSettings(settings);
        this.snapshot = {
            ...this.snapshot,
            settings: normalized,
            state: buildStatePatch(this.snapshot.state, {
                enabled: normalized.enabled,
                pollIntervalSeconds: normalized.pollIntervalSeconds,
                status: normalized.enabled ? this.snapshot.state.status : 'stopped',
                lastError: normalized.enabled ? this.snapshot.state.lastError : undefined,
                backoffUntil: normalized.enabled ? this.snapshot.state.backoffUntil : undefined
            })
        };
        this.persistAndEmitState();
        return this.getSnapshot();
    }

    getState(): InboxMonitorState {
        return { ...this.snapshot.state };
    }

    getSnapshot(): InboxMonitorSnapshot {
        return {
            settings: this.loadSettings(),
            state: this.getState(),
            lastSeen: {
                initializedAt: this.snapshot.lastSeen.initializedAt,
                selfUserId: this.snapshot.lastSeen.selfUserId,
                channelMessageIds: { ...this.snapshot.lastSeen.channelMessageIds }
            }
        };
    }

    async start(options: StartInboxMonitorOptions = {}): Promise<InboxMonitorState> {
        if (typeof options.token === 'string' && options.token.trim().length > 0) {
            this.currentToken = options.token.trim();
        }

        if (!this.snapshot.settings.enabled) {
            this.setState({
                status: 'stopped',
                enabled: false,
                pollIntervalSeconds: this.snapshot.settings.pollIntervalSeconds,
                lastError: undefined,
                backoffUntil: undefined
            });
            return this.getState();
        }

        if (!this.currentToken) {
            this.setState({
                status: 'blocked',
                enabled: true,
                pollIntervalSeconds: this.snapshot.settings.pollIntervalSeconds,
                lastError: 'Discord token is missing. Save a token before starting inbox notifications.',
                backoffUntil: undefined
            });
            return this.getState();
        }

        if (this.running) {
            return this.getState();
        }

        this.running = true;
        this.setState({
            status: 'starting',
            enabled: true,
            pollIntervalSeconds: this.snapshot.settings.pollIntervalSeconds,
            lastError: undefined,
            backoffUntil: undefined
        });
        this.loopPromise = this.runLoop();
        return this.getState();
    }

    stop(reason?: string): InboxMonitorState {
        this.running = false;
        this.setState({
            status: 'stopped',
            enabled: this.snapshot.settings.enabled,
            pollIntervalSeconds: this.snapshot.settings.pollIntervalSeconds,
            lastError: reason,
            backoffUntil: undefined
        });
        return this.getState();
    }

    private async runLoop() {
        while (this.running) {
            const token = this.currentToken;
            if (!token) {
                this.setState({
                    status: 'blocked',
                    enabled: this.snapshot.settings.enabled,
                    pollIntervalSeconds: this.snapshot.settings.pollIntervalSeconds,
                    lastError: 'Discord token is missing. Save a token before starting inbox notifications.',
                    backoffUntil: undefined
                });
                this.running = false;
                break;
            }

            try {
                const result = await this.poll(token);
                if (!this.running || token !== this.currentToken) {
                    break;
                }

                this.snapshot = {
                    ...this.snapshot,
                    lastSeen: result.lastSeen,
                    state: buildStatePatch(this.snapshot.state, {
                        status: 'running',
                        enabled: this.snapshot.settings.enabled,
                        pollIntervalSeconds: this.snapshot.settings.pollIntervalSeconds,
                        lastCheckedAt: result.checkedAt,
                        lastSuccessfulPollAt: result.checkedAt,
                        lastError: undefined,
                        backoffUntil: undefined,
                        lastNotificationAt: result.notifications[0]?.receivedAt ?? this.snapshot.state.lastNotificationAt
                    })
                };
                this.persistAndEmitState();

                for (const notification of result.notifications) {
                    this.emitEvent?.({
                        type: 'inbox_notification_ready',
                        notification,
                        monitor: this.getState()
                    });
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const lowered = message.toLowerCase();
                if (lowered.includes('401')) {
                    this.running = false;
                    this.setState({
                        status: 'failed',
                        enabled: this.snapshot.settings.enabled,
                        pollIntervalSeconds: this.snapshot.settings.pollIntervalSeconds,
                        lastCheckedAt: this.now().toISOString(),
                        lastError: message,
                        backoffUntil: undefined
                    });
                    break;
                }

                const isRateLimited = lowered.includes('429');
                const backoffMs = isRateLimited
                    ? Math.max(15_000, this.snapshot.settings.pollIntervalSeconds * 1000)
                    : Math.max(10_000, Math.round(this.snapshot.settings.pollIntervalSeconds * 500));
                const backoffUntil = new Date(this.now().getTime() + backoffMs).toISOString();

                this.setState({
                    status: isRateLimited ? 'degraded' : 'failed',
                    enabled: this.snapshot.settings.enabled,
                    pollIntervalSeconds: this.snapshot.settings.pollIntervalSeconds,
                    lastCheckedAt: this.now().toISOString(),
                    lastError: message,
                    backoffUntil
                });

                await this.sleepImpl(backoffMs);
                if (!this.running) {
                    break;
                }
                continue;
            }

            const waitMs = this.snapshot.settings.pollIntervalSeconds * 1000
                + Math.round(this.random() * 2_500);
            await this.sleepImpl(waitMs);
        }
    }

    private async poll(token: string): Promise<MonitorPollResult> {
        const headers = {
            Authorization: token,
            'Content-Type': 'application/json'
        };
        const checkedAt = this.now().toISOString();
        const selfUserId = this.snapshot.lastSeen.selfUserId ?? await this.fetchSelfUserId(headers);
        const channels = await this.fetchChannels(headers);
        const notifications: InboxNotificationItem[] = [];
        const nextLastSeen: InboxMonitorLastSeen = {
            initializedAt: this.snapshot.lastSeen.initializedAt ?? checkedAt,
            selfUserId,
            channelMessageIds: { ...this.snapshot.lastSeen.channelMessageIds }
        };

        for (const channel of channels) {
            const kind: InboxNotificationKind = isMessageRequestChannel(channel) ? 'message_request' : 'direct_message';
            if ((kind === 'direct_message' && !this.snapshot.settings.notifyDirectMessages)
                || (kind === 'message_request' && !this.snapshot.settings.notifyMessageRequests)) {
                continue;
            }

            const messages = await this.fetchChannelMessages(headers, channel.id);
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

            if (!this.snapshot.lastSeen.initializedAt) {
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
                    previewText: typeof message.content === 'string' && message.content.trim().length > 0
                        ? message.content.trim().slice(0, 180)
                        : '(No text content)',
                    messageId: message.id,
                    receivedAt: typeof message.timestamp === 'string' ? message.timestamp : checkedAt
                });
            }
        }

        return {
            notifications,
            lastSeen: nextLastSeen,
            checkedAt
        };
    }

    private async fetchSelfUserId(headers: HeadersInit): Promise<string> {
        const response = await this.fetchImpl(`${API_BASE}/users/@me`, { headers });
        if (!response.ok) {
            throw new Error(`Inbox monitor failed to fetch @me (${response.status}).`);
        }

        const payload = await readJson<{ id: string }>(response);
        return payload.id;
    }

    private async fetchChannels(headers: HeadersInit): Promise<InboxChannel[]> {
        const response = await this.fetchImpl(`${API_BASE}/users/@me/channels`, { headers });
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

    private async fetchChannelMessages(headers: HeadersInit, channelId: string): Promise<InboxMessage[]> {
        const response = await this.fetchImpl(`${API_BASE}/channels/${channelId}/messages?limit=${MAX_MESSAGES_PER_CHANNEL}`, { headers });
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

    private setState(nextState: InboxMonitorState) {
        this.snapshot = {
            ...this.snapshot,
            state: nextState
        };
        this.persistAndEmitState();
    }

    private persistAndEmitState() {
        const snapshot = this.getSnapshot();
        this.onSnapshotChange?.(snapshot);
        this.emitEvent?.({
            type: 'inbox_monitor_state_changed',
            monitor: snapshot.state
        });
    }
}

export function createInboxMonitorService(options: InboxMonitorOptions = {}): InboxMonitorController {
    return new InboxMonitorService(options);
}

export {
    MIN_POLL_INTERVAL_SECONDS,
    MAX_POLL_INTERVAL_SECONDS
};
