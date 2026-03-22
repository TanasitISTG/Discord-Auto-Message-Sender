export interface AppChannel {
    name: string;
    id: string;
    referrer: string;
    messageGroup: string;
    schedule?: ChannelSchedule;
}

export interface ChannelQuietHours {
    start: string;
    end: string;
}

export interface ChannelSchedule {
    intervalSeconds: number;
    randomMarginSeconds: number;
    quietHours?: ChannelQuietHours | null;
    timezone?: string | null;
    maxSendsPerDay?: number | null;
    cooldownWindowSize?: number;
}

export type MessageGroups = Record<string, string[]>;

export interface AppConfig {
    userAgent: string;
    channels: AppChannel[];
    messageGroups: MessageGroups;
}

export type LogLevel = 'info' | 'success' | 'warning' | 'error' | 'debug';
export type SessionSegmentKind = 'fresh' | 'resumed';

export interface LogEntry {
    id: string;
    timestamp: string;
    level: LogLevel;
    context: string;
    message: string;
    meta?: Record<string, string | number | boolean | null>;
    sessionId?: string;
    segmentId?: string;
    segmentKind?: SessionSegmentKind;
}

export interface AdaptivePacingState {
    baseRequestIntervalMs: number;
    currentRequestIntervalMs: number;
    maxRequestIntervalMs: number;
    penaltyLevel: number;
    recentRateLimitCount: number;
    lastRateLimitAt?: string;
    lastRecoveryAt?: string;
}

export type ChannelHealthStatus = 'healthy' | 'degraded' | 'suppressed' | 'recovering' | 'failed';

export interface ChannelHealthRecord {
    channelId: string;
    channelName: string;
    status: ChannelHealthStatus;
    consecutiveRateLimits: number;
    consecutiveFailures: number;
    suppressionCount: number;
    lastReason?: string;
    lastFailureAt?: string;
    lastSuccessAt?: string;
    suppressedUntil?: string;
}

export type ChannelProgressStatus = 'pending' | 'running' | 'suppressed' | 'completed' | 'failed';

export interface ChannelProgressRecord {
    channelId: string;
    channelName: string;
    status: ChannelProgressStatus;
    sentMessages: number;
    sentToday: number;
    consecutiveRateLimits: number;
    lastMessage?: string;
    lastSentAt?: string;
    lastError?: string;
    suppressedUntil?: string;
}

export type SessionStatus =
    | 'idle'
    | 'running'
    | 'paused'
    | 'stopping'
    | 'completed'
    | 'failed';

export interface SessionChannelOutcome {
    channelId: string;
    channelName: string;
    status: Extract<ChannelProgressStatus, 'completed' | 'failed' | 'suppressed'>;
    sentMessages: number;
    lastError?: string;
    suppressedUntil?: string;
}

export interface SessionSummary {
    totalChannels: number;
    completedChannels: number;
    failedChannels: number;
    sentMessages: number;
    startedAt: string;
    finishedAt?: string;
    stopReason?: string;
    rateLimitEvents?: number;
    suppressedChannels?: number;
    resumedFromCheckpoint?: boolean;
    maxPacingIntervalMs?: number;
    channelOutcomes?: SessionChannelOutcome[];
}

export interface SessionState {
    id: string;
    status: SessionStatus;
    startedAt?: string;
    updatedAt: string;
    currentSegmentId?: string;
    currentSegmentKind?: SessionSegmentKind;
    currentSegmentStartedAt?: string;
    resumedFromCheckpointAt?: string;
    activeChannels: string[];
    completedChannels: string[];
    failedChannels: string[];
    sentMessages: number;
    stopReason?: string;
    summary?: SessionSummary;
    runtime?: RuntimeOptions;
    channelProgress?: Record<string, ChannelProgressRecord>;
    channelHealth?: Record<string, ChannelHealthRecord>;
    pacing?: AdaptivePacingState;
    resumedFromCheckpoint?: boolean;
}

export interface ChannelPreflightResult {
    channelId: string;
    channelName: string;
    ok: boolean;
    reason?: string;
    status?: number;
}

export interface PreflightResult {
    ok: boolean;
    checkedAt: string;
    configValid: boolean;
    tokenPresent: boolean;
    issues: string[];
    channels: ChannelPreflightResult[];
}

export interface DryRunChannelPreview {
    channelId: string;
    channelName: string;
    groupName: string;
    enabled: boolean;
    sampleMessages: string[];
    cadence: {
        numMessages: number;
        baseWaitSeconds: number;
        marginSeconds: number;
    };
    skipReasons: string[];
}

export interface DryRunResult {
    generatedAt: string;
    willSendMessages: boolean;
    channels: DryRunChannelPreview[];
    summary: {
        selectedChannels: number;
        skippedChannels: number;
        totalSampleMessages: number;
    };
}

export type AppEvent =
    | { type: 'session_started'; state: SessionState }
    | { type: 'session_paused'; state: SessionState }
    | { type: 'session_resumed'; state: SessionState }
    | { type: 'session_stopping'; state: SessionState }
    | { type: 'channel_state_changed'; state: SessionState; channelId: string; phase: 'started' | 'completed' | 'failed' }
    | { type: 'session_state_updated'; state: SessionState; reason: 'message_sent' | 'pacing_changed' | 'health_changed' | 'checkpoint_restored' }
    | { type: 'log_event_emitted'; entry: LogEntry }
    | { type: 'summary_ready'; summary: SessionSummary; state: SessionState }
    | { type: 'preflight_result_emitted'; result: PreflightResult }
    | { type: 'dry_run_ready'; result: DryRunResult };

export interface LegacyChannel {
    name: string;
    id: string;
    referrer?: string;
    message_group?: string;
}

export interface LegacyConfig {
    user_agent: string;
    channels: LegacyChannel[];
}

export type LegacyMessages = MessageGroups;

export interface RuntimeOptions {
    numMessages: number;
    baseWaitSeconds: number;
    marginSeconds: number;
}

export interface EnvironmentConfig {
    DISCORD_TOKEN: string;
}

export interface ConfigPaths {
    configFile: string;
    messagesFile: string;
}

export interface SenderStateRecord {
    schemaVersion: number;
    lastSession?: SessionState;
    summaries: SessionSummary[];
    recentFailures: Array<{
        channelId: string;
        channelName: string;
        reason: string;
        timestamp: string;
    }>;
    recentMessageHistory?: Record<string, string[]>;
    channelHealth?: Record<string, ChannelHealthRecord>;
    resumeSession?: {
        sessionId: string;
        updatedAt: string;
        runtime: RuntimeOptions;
        configSignature: string;
        state: SessionState;
        recentMessageHistory: Record<string, string[]>;
    };
    warning?: string;
}
