import {
    InboxMonitorLastSeen,
    InboxMonitorSettings,
    InboxMonitorSnapshot,
    InboxMonitorState,
    InboxMonitorStatus
} from '../../types';
import {
    getDefaultInboxMonitorSettings,
    getDefaultInboxMonitorSnapshot,
    getDefaultInboxMonitorState
} from './schema';

const INBOX_MONITOR_STATUSES = new Set<InboxMonitorStatus>(['stopped', 'starting', 'running', 'blocked', 'degraded', 'failed']);

function normalizeInboxMonitorSettings(value: unknown): InboxMonitorSettings {
    const defaults = getDefaultInboxMonitorSettings();
    if (!value || typeof value !== 'object') {
        return defaults;
    }

    const settings = value as Partial<InboxMonitorSettings>;
    const pollIntervalSeconds = typeof settings.pollIntervalSeconds === 'number' && Number.isFinite(settings.pollIntervalSeconds)
        ? Math.max(15, Math.min(300, Math.round(settings.pollIntervalSeconds)))
        : defaults.pollIntervalSeconds;

    return {
        enabled: typeof settings.enabled === 'boolean' ? settings.enabled : defaults.enabled,
        pollIntervalSeconds,
        notifyDirectMessages: typeof settings.notifyDirectMessages === 'boolean'
            ? settings.notifyDirectMessages
            : defaults.notifyDirectMessages,
        notifyMessageRequests: typeof settings.notifyMessageRequests === 'boolean'
            ? settings.notifyMessageRequests
            : defaults.notifyMessageRequests
    };
}

function normalizeInboxMonitorState(value: unknown, settings: InboxMonitorSettings): InboxMonitorState {
    const defaults = getDefaultInboxMonitorState(settings);
    if (!value || typeof value !== 'object') {
        return defaults;
    }

    const state = value as Partial<InboxMonitorState>;
    const status = typeof state.status === 'string' && INBOX_MONITOR_STATUSES.has(state.status as InboxMonitorStatus)
        ? state.status as InboxMonitorStatus
        : defaults.status;

    return {
        status,
        enabled: typeof state.enabled === 'boolean' ? state.enabled : settings.enabled,
        pollIntervalSeconds: typeof state.pollIntervalSeconds === 'number' && Number.isFinite(state.pollIntervalSeconds)
            ? Math.max(15, Math.min(300, Math.round(state.pollIntervalSeconds)))
            : settings.pollIntervalSeconds,
        lastCheckedAt: typeof state.lastCheckedAt === 'string' ? state.lastCheckedAt : undefined,
        lastSuccessfulPollAt: typeof state.lastSuccessfulPollAt === 'string' ? state.lastSuccessfulPollAt : undefined,
        lastNotificationAt: typeof state.lastNotificationAt === 'string' ? state.lastNotificationAt : undefined,
        lastError: typeof state.lastError === 'string' ? state.lastError : undefined,
        backoffUntil: typeof state.backoffUntil === 'string' ? state.backoffUntil : undefined
    };
}

function normalizeInboxMonitorLastSeen(value: unknown): InboxMonitorLastSeen {
    if (!value || typeof value !== 'object') {
        return { channelMessageIds: {} };
    }

    const lastSeen = value as Partial<InboxMonitorLastSeen>;
    const channelMessageIds = lastSeen.channelMessageIds && typeof lastSeen.channelMessageIds === 'object' && !Array.isArray(lastSeen.channelMessageIds)
        ? Object.fromEntries(
            Object.entries(lastSeen.channelMessageIds)
                .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string')
        )
        : {};

    return {
        initializedAt: typeof lastSeen.initializedAt === 'string' ? lastSeen.initializedAt : undefined,
        selfUserId: typeof lastSeen.selfUserId === 'string' ? lastSeen.selfUserId : undefined,
        channelMessageIds
    };
}

export function normalizeInboxMonitorSnapshot(value: unknown): InboxMonitorSnapshot {
    const defaults = getDefaultInboxMonitorSnapshot();
    if (!value || typeof value !== 'object') {
        return defaults;
    }

    const snapshot = value as Partial<InboxMonitorSnapshot>;
    const settings = normalizeInboxMonitorSettings(snapshot.settings);

    return {
        settings,
        state: normalizeInboxMonitorState(snapshot.state, settings),
        lastSeen: normalizeInboxMonitorLastSeen(snapshot.lastSeen)
    };
}

export {
    getDefaultInboxMonitorSettings,
    getDefaultInboxMonitorSnapshot,
    getDefaultInboxMonitorState
};
