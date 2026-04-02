import type {
    AdaptivePacingState,
    AppConfig,
    ChannelHealthRecord,
    ChannelProgressRecord,
    RuntimeOptions,
    SenderStateRecord,
    SessionSegmentKind,
    SessionState,
} from '../../types';

export type ResumeSessionRecord = NonNullable<SenderStateRecord['resumeSession']>;

export interface SessionSegment {
    id: string;
    kind: SessionSegmentKind;
    startedAt: string;
    resumedFromCheckpointAt?: string;
}

export function createEmptyChannelProgress(channel: AppConfig['channels'][number]): ChannelProgressRecord {
    return {
        channelId: channel.id,
        channelName: channel.name,
        status: 'pending',
        sentMessages: 0,
        sentToday: 0,
        consecutiveRateLimits: 0,
    };
}

export function createEmptyChannelHealth(channel: AppConfig['channels'][number]): ChannelHealthRecord {
    return {
        channelId: channel.id,
        channelName: channel.name,
        status: 'healthy',
        consecutiveRateLimits: 0,
        consecutiveFailures: 0,
        suppressionCount: 0,
    };
}

export function buildChannelProgress(
    config: AppConfig,
    previous?: Record<string, ChannelProgressRecord>,
): Record<string, ChannelProgressRecord> {
    return Object.fromEntries(
        config.channels.map((channel) => [
            channel.id,
            {
                ...createEmptyChannelProgress(channel),
                ...(previous?.[channel.id] ?? {}),
            },
        ]),
    );
}

export function buildChannelHealth(
    config: AppConfig,
    previous?: Record<string, ChannelHealthRecord>,
): Record<string, ChannelHealthRecord> {
    return Object.fromEntries(
        config.channels.map((channel) => [
            channel.id,
            {
                ...createEmptyChannelHealth(channel),
                ...(previous?.[channel.id] ?? {}),
            },
        ]),
    );
}

export function createInitialPacing(): AdaptivePacingState {
    return {
        baseRequestIntervalMs: 250,
        currentRequestIntervalMs: 250,
        maxRequestIntervalMs: 250,
        penaltyLevel: 0,
        recentRateLimitCount: 0,
    };
}

export function createSessionSegment(kind: SessionSegmentKind, resumedFromCheckpointAt?: string): SessionSegment {
    return {
        id: `segment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        startedAt: new Date().toISOString(),
        resumedFromCheckpointAt,
    };
}

export function createInitialState(
    sessionId: string,
    runtime: RuntimeOptions,
    config: AppConfig,
    segment: SessionSegment,
    persistedHealth?: Record<string, ChannelHealthRecord>,
): SessionState {
    const now = new Date().toISOString();
    return {
        id: sessionId,
        status: 'idle',
        updatedAt: now,
        currentSegmentId: segment.id,
        currentSegmentKind: segment.kind,
        currentSegmentStartedAt: segment.startedAt,
        resumedFromCheckpointAt: segment.resumedFromCheckpointAt,
        activeChannels: [],
        completedChannels: [],
        failedChannels: [],
        sentMessages: 0,
        runtime,
        channelProgress: buildChannelProgress(config),
        channelHealth: buildChannelHealth(config, persistedHealth),
        pacing: createInitialPacing(),
    };
}

export function createOutcomeStatus(progress: ChannelProgressRecord): 'completed' | 'failed' | 'suppressed' {
    if (progress.status === 'completed') {
        return 'completed';
    }

    if (progress.status === 'suppressed') {
        return 'suppressed';
    }

    return 'failed';
}

export function ensureChannelProgress(
    config: AppConfig,
    state: SessionState,
    channelId: string,
): ChannelProgressRecord {
    const channel = config.channels.find((item) => item.id === channelId);
    const progress = state.channelProgress?.[channelId];
    if (progress) {
        return progress;
    }

    const nextProgress = channel
        ? createEmptyChannelProgress(channel)
        : ({
              channelId,
              channelName: channelId,
              status: 'pending',
              sentMessages: 0,
              sentToday: 0,
              consecutiveRateLimits: 0,
          } satisfies ChannelProgressRecord);
    state.channelProgress = {
        ...(state.channelProgress ?? {}),
        [channelId]: nextProgress,
    };
    return nextProgress;
}

export function ensureChannelHealth(config: AppConfig, state: SessionState, channelId: string): ChannelHealthRecord {
    const channel = config.channels.find((item) => item.id === channelId);
    const health = state.channelHealth?.[channelId];
    if (health) {
        return health;
    }

    const nextHealth = channel
        ? createEmptyChannelHealth(channel)
        : ({
              channelId,
              channelName: channelId,
              status: 'healthy',
              consecutiveRateLimits: 0,
              consecutiveFailures: 0,
              suppressionCount: 0,
          } satisfies ChannelHealthRecord);
    state.channelHealth = {
        ...(state.channelHealth ?? {}),
        [channelId]: nextHealth,
    };
    return nextHealth;
}
