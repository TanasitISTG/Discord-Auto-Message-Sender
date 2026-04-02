import {
    AdaptivePacingState,
    ChannelHealthRecord,
    ChannelHealthStatus,
    ChannelProgressRecord,
    ChannelProgressStatus,
    RuntimeOptions,
    SenderStateRecord,
    SessionState,
    SessionStatus,
} from '../../types';
import { normalizeInboxMonitorSnapshot } from './inbox-monitor-store';
import { normalizeNotificationDeliverySnapshot } from './notification-delivery-store';
import { STATE_SCHEMA_VERSION } from './schema';

type RawSenderState = Partial<SenderStateRecord> & {
    schemaVersion?: unknown;
};

const CHANNEL_HEALTH_STATUSES = new Set<ChannelHealthStatus>([
    'healthy',
    'degraded',
    'suppressed',
    'recovering',
    'failed',
]);
const CHANNEL_PROGRESS_STATUSES = new Set<ChannelProgressStatus>([
    'pending',
    'running',
    'suppressed',
    'stopped',
    'completed',
    'failed',
]);
const SESSION_STATUSES = new Set<SessionStatus>([
    'idle',
    'running',
    'paused',
    'stopping',
    'stopped',
    'completed',
    'failed',
]);

function normalizeMessageHistory(value: unknown): Record<string, string[]> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value).map(([channelId, messages]) => [
            channelId,
            Array.isArray(messages) ? messages.filter((message): message is string => typeof message === 'string') : [],
        ]),
    );
}

function normalizeRuntimeOptions(value: unknown): RuntimeOptions | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const runtime = value as Partial<RuntimeOptions>;
    if (
        typeof runtime.numMessages !== 'number' ||
        typeof runtime.baseWaitSeconds !== 'number' ||
        typeof runtime.marginSeconds !== 'number'
    ) {
        return undefined;
    }

    return {
        numMessages: runtime.numMessages,
        baseWaitSeconds: runtime.baseWaitSeconds,
        marginSeconds: runtime.marginSeconds,
    };
}

function normalizePacing(value: unknown): AdaptivePacingState | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const pacing = value as Partial<AdaptivePacingState>;
    if (
        typeof pacing.baseRequestIntervalMs !== 'number' ||
        typeof pacing.currentRequestIntervalMs !== 'number' ||
        typeof pacing.maxRequestIntervalMs !== 'number' ||
        typeof pacing.penaltyLevel !== 'number' ||
        typeof pacing.recentRateLimitCount !== 'number'
    ) {
        return undefined;
    }

    return {
        baseRequestIntervalMs: pacing.baseRequestIntervalMs,
        currentRequestIntervalMs: pacing.currentRequestIntervalMs,
        maxRequestIntervalMs: pacing.maxRequestIntervalMs,
        penaltyLevel: pacing.penaltyLevel,
        recentRateLimitCount: pacing.recentRateLimitCount,
        lastRateLimitAt: typeof pacing.lastRateLimitAt === 'string' ? pacing.lastRateLimitAt : undefined,
        lastRecoveryAt: typeof pacing.lastRecoveryAt === 'string' ? pacing.lastRecoveryAt : undefined,
    };
}

function normalizeChannelHealth(value: unknown): ChannelHealthRecord | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const record = value as Partial<ChannelHealthRecord>;
    if (
        typeof record.channelId !== 'string' ||
        typeof record.channelName !== 'string' ||
        typeof record.status !== 'string' ||
        typeof record.consecutiveRateLimits !== 'number' ||
        typeof record.consecutiveFailures !== 'number' ||
        typeof record.suppressionCount !== 'number' ||
        !CHANNEL_HEALTH_STATUSES.has(record.status as ChannelHealthStatus)
    ) {
        return undefined;
    }

    return {
        channelId: record.channelId,
        channelName: record.channelName,
        status: record.status as ChannelHealthStatus,
        consecutiveRateLimits: record.consecutiveRateLimits,
        consecutiveFailures: record.consecutiveFailures,
        suppressionCount: record.suppressionCount,
        lastReason: typeof record.lastReason === 'string' ? record.lastReason : undefined,
        lastFailureAt: typeof record.lastFailureAt === 'string' ? record.lastFailureAt : undefined,
        lastSuccessAt: typeof record.lastSuccessAt === 'string' ? record.lastSuccessAt : undefined,
        suppressedUntil: typeof record.suppressedUntil === 'string' ? record.suppressedUntil : undefined,
    };
}

function normalizeChannelHealthMap(value: unknown): Record<string, ChannelHealthRecord> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value)
            .map(([channelId, record]) => [channelId, normalizeChannelHealth(record)] as const)
            .filter((entry): entry is [string, ChannelHealthRecord] => Boolean(entry[1])),
    );
}

function normalizeChannelProgress(value: unknown): ChannelProgressRecord | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const record = value as Partial<ChannelProgressRecord>;
    if (
        typeof record.channelId !== 'string' ||
        typeof record.channelName !== 'string' ||
        typeof record.status !== 'string' ||
        typeof record.sentMessages !== 'number' ||
        typeof record.sentToday !== 'number' ||
        typeof record.consecutiveRateLimits !== 'number' ||
        !CHANNEL_PROGRESS_STATUSES.has(record.status as ChannelProgressStatus)
    ) {
        return undefined;
    }

    return {
        channelId: record.channelId,
        channelName: record.channelName,
        status: record.status as ChannelProgressStatus,
        sentMessages: record.sentMessages,
        sentToday: record.sentToday,
        sentTodayDayKey: typeof record.sentTodayDayKey === 'string' ? record.sentTodayDayKey : undefined,
        consecutiveRateLimits: record.consecutiveRateLimits,
        lastMessage: typeof record.lastMessage === 'string' ? record.lastMessage : undefined,
        lastSentAt: typeof record.lastSentAt === 'string' ? record.lastSentAt : undefined,
        lastError: typeof record.lastError === 'string' ? record.lastError : undefined,
        suppressedUntil: typeof record.suppressedUntil === 'string' ? record.suppressedUntil : undefined,
    };
}

function normalizeChannelProgressMap(value: unknown): Record<string, ChannelProgressRecord> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }

    return Object.fromEntries(
        Object.entries(value)
            .map(([channelId, record]) => [channelId, normalizeChannelProgress(record)] as const)
            .filter((entry): entry is [string, ChannelProgressRecord] => Boolean(entry[1])),
    );
}

function normalizeSessionState(value: unknown): SessionState | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const state = value as Partial<SessionState>;
    if (
        typeof state.id !== 'string' ||
        typeof state.status !== 'string' ||
        typeof state.updatedAt !== 'string' ||
        !Array.isArray(state.activeChannels) ||
        !Array.isArray(state.completedChannels) ||
        !Array.isArray(state.failedChannels) ||
        typeof state.sentMessages !== 'number' ||
        !SESSION_STATUSES.has(state.status as SessionStatus)
    ) {
        return undefined;
    }

    return {
        id: state.id,
        status: state.status as SessionStatus,
        startedAt: typeof state.startedAt === 'string' ? state.startedAt : undefined,
        updatedAt: state.updatedAt,
        currentSegmentId: typeof state.currentSegmentId === 'string' ? state.currentSegmentId : undefined,
        currentSegmentKind:
            state.currentSegmentKind === 'fresh' || state.currentSegmentKind === 'resumed'
                ? state.currentSegmentKind
                : undefined,
        currentSegmentStartedAt:
            typeof state.currentSegmentStartedAt === 'string' ? state.currentSegmentStartedAt : undefined,
        resumedFromCheckpointAt:
            typeof state.resumedFromCheckpointAt === 'string' ? state.resumedFromCheckpointAt : undefined,
        activeChannels: state.activeChannels.filter((channelId): channelId is string => typeof channelId === 'string'),
        completedChannels: state.completedChannels.filter(
            (channelId): channelId is string => typeof channelId === 'string',
        ),
        failedChannels: state.failedChannels.filter((channelId): channelId is string => typeof channelId === 'string'),
        sentMessages: state.sentMessages,
        stopReason: typeof state.stopReason === 'string' ? state.stopReason : undefined,
        summary: state.summary,
        runtime: normalizeRuntimeOptions(state.runtime),
        pacing: normalizePacing(state.pacing),
        channelHealth: normalizeChannelHealthMap(state.channelHealth),
        channelProgress: normalizeChannelProgressMap(state.channelProgress),
        resumedFromCheckpoint:
            typeof state.resumedFromCheckpoint === 'boolean' ? state.resumedFromCheckpoint : undefined,
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

    if (
        typeof record.sessionId !== 'string' ||
        typeof record.updatedAt !== 'string' ||
        typeof record.configSignature !== 'string' ||
        !runtime ||
        !state
    ) {
        return undefined;
    }

    return {
        sessionId: record.sessionId,
        updatedAt: record.updatedAt,
        runtime,
        configSignature: record.configSignature,
        state,
        recentMessageHistory,
    };
}

export function normalizeSenderState(raw: RawSenderState): {
    state: SenderStateRecord;
    shouldWriteBack: boolean;
    warning?: string;
} {
    const rawVersion =
        typeof raw.schemaVersion === 'number' && Number.isFinite(raw.schemaVersion) ? raw.schemaVersion : 0;
    const shouldWriteBack = rawVersion === 0 || rawVersion < STATE_SCHEMA_VERSION;
    const warning =
        rawVersion === 0
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
            notificationDelivery: normalizeNotificationDeliverySnapshot(raw.notificationDelivery),
        },
        shouldWriteBack,
        warning,
    };
}
