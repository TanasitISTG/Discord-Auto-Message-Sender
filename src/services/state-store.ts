import fs from 'fs';
import path from 'path';
import {
    AdaptivePacingState,
    ChannelHealthRecord,
    ChannelProgressRecord,
    InboxMonitorLastSeen,
    InboxMonitorSettings,
    InboxMonitorSnapshot,
    InboxMonitorState,
    NotificationDeliverySettings,
    NotificationDeliverySnapshot,
    RuntimeOptions,
    SenderStateRecord,
    SessionState
} from '../types';

export const STATE_FILE = '.sender-state.json';
export const STATE_SCHEMA_VERSION = 1;

export function getDefaultInboxMonitorSettings(): InboxMonitorSettings {
    return {
        enabled: false,
        pollIntervalSeconds: 30,
        notifyDirectMessages: true,
        notifyMessageRequests: true
    };
}

export function getDefaultInboxMonitorState(settings: InboxMonitorSettings = getDefaultInboxMonitorSettings()): InboxMonitorState {
    return {
        status: 'stopped',
        enabled: settings.enabled,
        pollIntervalSeconds: settings.pollIntervalSeconds
    };
}

export function getDefaultInboxMonitorSnapshot(): InboxMonitorSnapshot {
    const settings = getDefaultInboxMonitorSettings();
    return {
        settings,
        state: getDefaultInboxMonitorState(settings),
        lastSeen: {
            channelMessageIds: {}
        }
    };
}

export function getDefaultNotificationDeliverySettings(): NotificationDeliverySettings {
    return {
        windowsDesktopEnabled: true,
        telegram: {
            enabled: false,
            botTokenStored: false,
            chatId: '',
            previewMode: 'full'
        }
    };
}

export function getDefaultNotificationDeliverySnapshot(): NotificationDeliverySnapshot {
    return {
        settings: getDefaultNotificationDeliverySettings(),
        telegramState: {
            status: 'disabled'
        }
    };
}

type RawSenderState = Partial<SenderStateRecord> & {
    schemaVersion?: unknown;
};

export function getDefaultSenderState(): SenderStateRecord {
    return {
        schemaVersion: STATE_SCHEMA_VERSION,
        summaries: [],
        recentFailures: [],
        recentMessageHistory: {},
        channelHealth: {},
        inboxMonitor: getDefaultInboxMonitorSnapshot(),
        notificationDelivery: getDefaultNotificationDeliverySnapshot()
    };
}

export function resolveStateFile(baseDir: string): string {
    return path.join(baseDir, STATE_FILE);
}

export function loadSenderState(baseDir: string): SenderStateRecord {
    const filePath = resolveStateFile(baseDir);
    if (!fs.existsSync(filePath)) {
        return getDefaultSenderState();
    }

    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as RawSenderState;
        const { state, shouldWriteBack, warning } = normalizeSenderState(raw);

        if (shouldWriteBack) {
            saveSenderState(baseDir, state);
            return {
                ...state,
                warning
            };
        }

        return warning
            ? { ...state, warning }
            : state;
    } catch {
        return {
            ...getDefaultSenderState(),
            warning: 'Local sender state was corrupted and has been reset.'
        };
    }
}

export function saveSenderState(baseDir: string, state: SenderStateRecord) {
    const filePath = resolveStateFile(baseDir);
    const nextState: SenderStateRecord = {
        ...state,
        schemaVersion: STATE_SCHEMA_VERSION,
        warning: undefined
    };
    fs.writeFileSync(filePath, JSON.stringify(nextState, null, 2), 'utf8');
}

export function clearResumeSession(baseDir: string): SenderStateRecord {
    const state = loadSenderState(baseDir);
    state.resumeSession = undefined;
    saveSenderState(baseDir, state);
    return loadSenderState(baseDir);
}

function normalizeSenderState(raw: RawSenderState): {
    state: SenderStateRecord;
    shouldWriteBack: boolean;
    warning?: string;
} {
    const rawVersion = typeof raw.schemaVersion === 'number' && Number.isFinite(raw.schemaVersion)
        ? raw.schemaVersion
        : 0;
    const shouldWriteBack = rawVersion === 0 || rawVersion < STATE_SCHEMA_VERSION;
    const warning = rawVersion === 0
        ? 'Local sender state was migrated to the latest format.'
        : rawVersion > STATE_SCHEMA_VERSION
            ? `Local sender state was created by a newer app version (${rawVersion}). Continuing with compatible fields.`
            : rawVersion < STATE_SCHEMA_VERSION
                ? `Local sender state was upgraded from schema v${rawVersion} to v${STATE_SCHEMA_VERSION}.`
                : undefined;

    return {
        state: {
            schemaVersion: STATE_SCHEMA_VERSION,
            lastSession: normalizeSessionState(raw.lastSession),
            summaries: Array.isArray(raw.summaries) ? raw.summaries : [],
            recentFailures: Array.isArray(raw.recentFailures) ? raw.recentFailures : [],
            recentMessageHistory: normalizeMessageHistory(raw.recentMessageHistory),
            channelHealth: normalizeChannelHealthMap(raw.channelHealth),
            resumeSession: normalizeResumeSession(raw.resumeSession),
            inboxMonitor: normalizeInboxMonitorSnapshot(raw.inboxMonitor),
            notificationDelivery: normalizeNotificationDeliverySnapshot(raw.notificationDelivery)
        },
        shouldWriteBack,
        warning
    };
}

function normalizeTelegramSettings(value: unknown): NotificationDeliverySettings['telegram'] {
    const defaults = getDefaultNotificationDeliverySettings().telegram;
    if (!value || typeof value !== 'object') {
        return defaults;
    }

    const settings = value as Partial<NotificationDeliverySettings['telegram']>;
    return {
        enabled: typeof settings.enabled === 'boolean' ? settings.enabled : defaults.enabled,
        botTokenStored: typeof settings.botTokenStored === 'boolean' ? settings.botTokenStored : defaults.botTokenStored,
        chatId: typeof settings.chatId === 'string' ? settings.chatId : defaults.chatId,
        previewMode: settings.previewMode === 'full' ? settings.previewMode : defaults.previewMode
    };
}

function normalizeNotificationDeliverySettings(value: unknown): NotificationDeliverySettings {
    const defaults = getDefaultNotificationDeliverySettings();
    if (!value || typeof value !== 'object') {
        return defaults;
    }

    const settings = value as Partial<NotificationDeliverySettings>;
    return {
        windowsDesktopEnabled: typeof settings.windowsDesktopEnabled === 'boolean'
            ? settings.windowsDesktopEnabled
            : defaults.windowsDesktopEnabled,
        telegram: normalizeTelegramSettings(settings.telegram)
    };
}

function normalizeTelegramState(value: unknown, settings: NotificationDeliverySettings): NotificationDeliverySnapshot['telegramState'] {
    const defaultStatus = settings.telegram.enabled
        ? (settings.telegram.botTokenStored && settings.telegram.chatId ? 'ready' : 'unconfigured')
        : 'disabled';
    if (!value || typeof value !== 'object') {
        return {
            status: defaultStatus
        };
    }

    const state = value as Partial<NotificationDeliverySnapshot['telegramState']>;
    const status = state.status === 'disabled'
        || state.status === 'unconfigured'
        || state.status === 'ready'
        || state.status === 'testing'
        || state.status === 'failed'
        ? state.status
        : defaultStatus;

    return {
        status,
        lastCheckedAt: typeof state.lastCheckedAt === 'string' ? state.lastCheckedAt : undefined,
        lastDeliveredAt: typeof state.lastDeliveredAt === 'string' ? state.lastDeliveredAt : undefined,
        lastTestedAt: typeof state.lastTestedAt === 'string' ? state.lastTestedAt : undefined,
        lastError: typeof state.lastError === 'string' ? state.lastError : undefined,
        lastResolvedChatTitle: typeof state.lastResolvedChatTitle === 'string' ? state.lastResolvedChatTitle : undefined
    };
}

function normalizeNotificationDeliverySnapshot(value: unknown): NotificationDeliverySnapshot {
    const defaults = getDefaultNotificationDeliverySnapshot();
    if (!value || typeof value !== 'object') {
        return defaults;
    }

    const snapshot = value as Partial<NotificationDeliverySnapshot>;
    const settings = normalizeNotificationDeliverySettings(snapshot.settings);
    return {
        settings,
        telegramState: normalizeTelegramState(snapshot.telegramState, settings)
    };
}

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
    const status = state.status === 'stopped'
        || state.status === 'starting'
        || state.status === 'running'
        || state.status === 'blocked'
        || state.status === 'degraded'
        || state.status === 'failed'
        ? state.status
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

function normalizeInboxMonitorSnapshot(value: unknown): InboxMonitorSnapshot {
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

function normalizeMessageHistory(value: unknown): Record<string, string[]> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value).map(([channelId, messages]) => [
            channelId,
            Array.isArray(messages) ? messages.filter((message): message is string => typeof message === 'string') : []
        ])
    );
}

function normalizeRuntimeOptions(value: unknown): RuntimeOptions | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const runtime = value as Partial<RuntimeOptions>;
    if (typeof runtime.numMessages !== 'number' || typeof runtime.baseWaitSeconds !== 'number' || typeof runtime.marginSeconds !== 'number') {
        return undefined;
    }

    return {
        numMessages: runtime.numMessages,
        baseWaitSeconds: runtime.baseWaitSeconds,
        marginSeconds: runtime.marginSeconds
    };
}

function normalizePacing(value: unknown): AdaptivePacingState | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const pacing = value as Partial<AdaptivePacingState>;
    if (typeof pacing.baseRequestIntervalMs !== 'number'
        || typeof pacing.currentRequestIntervalMs !== 'number'
        || typeof pacing.maxRequestIntervalMs !== 'number'
        || typeof pacing.penaltyLevel !== 'number'
        || typeof pacing.recentRateLimitCount !== 'number') {
        return undefined;
    }

    return {
        baseRequestIntervalMs: pacing.baseRequestIntervalMs,
        currentRequestIntervalMs: pacing.currentRequestIntervalMs,
        maxRequestIntervalMs: pacing.maxRequestIntervalMs,
        penaltyLevel: pacing.penaltyLevel,
        recentRateLimitCount: pacing.recentRateLimitCount,
        lastRateLimitAt: typeof pacing.lastRateLimitAt === 'string' ? pacing.lastRateLimitAt : undefined,
        lastRecoveryAt: typeof pacing.lastRecoveryAt === 'string' ? pacing.lastRecoveryAt : undefined
    };
}

function normalizeChannelHealth(value: unknown): ChannelHealthRecord | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const record = value as Partial<ChannelHealthRecord>;
    if (typeof record.channelId !== 'string'
        || typeof record.channelName !== 'string'
        || typeof record.status !== 'string'
        || typeof record.consecutiveRateLimits !== 'number'
        || typeof record.consecutiveFailures !== 'number'
        || typeof record.suppressionCount !== 'number') {
        return undefined;
    }

    return {
        channelId: record.channelId,
        channelName: record.channelName,
        status: record.status,
        consecutiveRateLimits: record.consecutiveRateLimits,
        consecutiveFailures: record.consecutiveFailures,
        suppressionCount: record.suppressionCount,
        lastReason: typeof record.lastReason === 'string' ? record.lastReason : undefined,
        lastFailureAt: typeof record.lastFailureAt === 'string' ? record.lastFailureAt : undefined,
        lastSuccessAt: typeof record.lastSuccessAt === 'string' ? record.lastSuccessAt : undefined,
        suppressedUntil: typeof record.suppressedUntil === 'string' ? record.suppressedUntil : undefined
    };
}

function normalizeChannelHealthMap(value: unknown): Record<string, ChannelHealthRecord> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value)
            .map(([channelId, record]) => [channelId, normalizeChannelHealth(record)] as const)
            .filter((entry): entry is [string, ChannelHealthRecord] => Boolean(entry[1]))
    );
}

function normalizeChannelProgress(value: unknown): ChannelProgressRecord | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const record = value as Partial<ChannelProgressRecord>;
    if (typeof record.channelId !== 'string'
        || typeof record.channelName !== 'string'
        || typeof record.status !== 'string'
        || typeof record.sentMessages !== 'number'
        || typeof record.sentToday !== 'number'
        || typeof record.consecutiveRateLimits !== 'number') {
        return undefined;
    }

    return {
        channelId: record.channelId,
        channelName: record.channelName,
        status: record.status,
        sentMessages: record.sentMessages,
        sentToday: record.sentToday,
        consecutiveRateLimits: record.consecutiveRateLimits,
        lastMessage: typeof record.lastMessage === 'string' ? record.lastMessage : undefined,
        lastSentAt: typeof record.lastSentAt === 'string' ? record.lastSentAt : undefined,
        lastError: typeof record.lastError === 'string' ? record.lastError : undefined,
        suppressedUntil: typeof record.suppressedUntil === 'string' ? record.suppressedUntil : undefined
    };
}

function normalizeChannelProgressMap(value: unknown): Record<string, ChannelProgressRecord> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }

    return Object.fromEntries(
        Object.entries(value)
            .map(([channelId, record]) => [channelId, normalizeChannelProgress(record)] as const)
            .filter((entry): entry is [string, ChannelProgressRecord] => Boolean(entry[1]))
    );
}

function normalizeSessionState(value: unknown): SessionState | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const state = value as Partial<SessionState>;
    if (typeof state.id !== 'string'
        || typeof state.status !== 'string'
        || typeof state.updatedAt !== 'string'
        || !Array.isArray(state.activeChannels)
        || !Array.isArray(state.completedChannels)
        || !Array.isArray(state.failedChannels)
        || typeof state.sentMessages !== 'number') {
        return undefined;
    }

    return {
        id: state.id,
        status: state.status,
        startedAt: typeof state.startedAt === 'string' ? state.startedAt : undefined,
        updatedAt: state.updatedAt,
        currentSegmentId: typeof state.currentSegmentId === 'string' ? state.currentSegmentId : undefined,
        currentSegmentKind: state.currentSegmentKind === 'fresh' || state.currentSegmentKind === 'resumed'
            ? state.currentSegmentKind
            : undefined,
        currentSegmentStartedAt: typeof state.currentSegmentStartedAt === 'string' ? state.currentSegmentStartedAt : undefined,
        resumedFromCheckpointAt: typeof state.resumedFromCheckpointAt === 'string' ? state.resumedFromCheckpointAt : undefined,
        activeChannels: state.activeChannels.filter((channelId): channelId is string => typeof channelId === 'string'),
        completedChannels: state.completedChannels.filter((channelId): channelId is string => typeof channelId === 'string'),
        failedChannels: state.failedChannels.filter((channelId): channelId is string => typeof channelId === 'string'),
        sentMessages: state.sentMessages,
        stopReason: typeof state.stopReason === 'string' ? state.stopReason : undefined,
        summary: state.summary,
        runtime: normalizeRuntimeOptions(state.runtime),
        pacing: normalizePacing(state.pacing),
        channelHealth: normalizeChannelHealthMap(state.channelHealth),
        channelProgress: normalizeChannelProgressMap(state.channelProgress),
        resumedFromCheckpoint: typeof state.resumedFromCheckpoint === 'boolean' ? state.resumedFromCheckpoint : undefined
    };
}

function normalizeResumeSession(value: unknown): SenderStateRecord['resumeSession'] {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const record = value as NonNullable<SenderStateRecord['resumeSession']>;
    const runtime = normalizeRuntimeOptions(record.runtime);
    const state = normalizeSessionState(record.state);
    const recentMessageHistory = normalizeMessageHistory(record.recentMessageHistory);

    if (typeof record.sessionId !== 'string'
        || typeof record.updatedAt !== 'string'
        || typeof record.configSignature !== 'string'
        || !runtime
        || !state) {
        return undefined;
    }

    return {
        sessionId: record.sessionId,
        updatedAt: record.updatedAt,
        runtime,
        configSignature: record.configSignature,
        state,
        recentMessageHistory
    };
}
