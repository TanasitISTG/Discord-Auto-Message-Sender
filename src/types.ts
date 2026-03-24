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
    skipped?: boolean;
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

export type InboxNotificationKind = 'direct_message' | 'message_request';
export type InboxMonitorStatus = 'stopped' | 'starting' | 'running' | 'blocked' | 'degraded' | 'failed';
export type NotificationChannel = 'windows_desktop' | 'telegram';
export type TelegramDeliveryStatus = 'disabled' | 'unconfigured' | 'ready' | 'testing' | 'failed';
export type TelegramPreviewMode = 'full';

export interface InboxNotificationItem {
    id: string;
    kind: InboxNotificationKind;
    channelId: string;
    channelName: string;
    authorId: string;
    authorName: string;
    previewText: string;
    messageId: string;
    receivedAt: string;
}

export interface InboxMonitorSettings {
    enabled: boolean;
    pollIntervalSeconds: number;
    notifyDirectMessages: boolean;
    notifyMessageRequests: boolean;
}

export interface InboxMonitorState {
    status: InboxMonitorStatus;
    enabled: boolean;
    pollIntervalSeconds: number;
    lastCheckedAt?: string;
    lastSuccessfulPollAt?: string;
    lastNotificationAt?: string;
    lastError?: string;
    backoffUntil?: string;
}

export interface InboxMonitorLastSeen {
    initializedAt?: string;
    selfUserId?: string;
    channelMessageIds: Record<string, string>;
}

export interface InboxMonitorSnapshot {
    settings: InboxMonitorSettings;
    state: InboxMonitorState;
    lastSeen: InboxMonitorLastSeen;
}

export interface TelegramSettings {
    enabled: boolean;
    botTokenStored: boolean;
    chatId: string;
    previewMode: TelegramPreviewMode;
}

export interface TelegramState {
    status: TelegramDeliveryStatus;
    lastCheckedAt?: string;
    lastDeliveredAt?: string;
    lastTestedAt?: string;
    lastError?: string;
    lastResolvedChatTitle?: string;
}

export interface NotificationDeliverySettings {
    windowsDesktopEnabled: boolean;
    telegram: TelegramSettings;
}

export interface NotificationDeliverySnapshot {
    settings: NotificationDeliverySettings;
    telegramState: TelegramState;
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
    | { type: 'dry_run_ready'; result: DryRunResult }
    | { type: 'inbox_monitor_state_changed'; monitor: InboxMonitorState }
    | { type: 'inbox_notification_ready'; notification: InboxNotificationItem; monitor: InboxMonitorState }
    | { type: 'notification_delivery_state_changed'; delivery: NotificationDeliverySnapshot }
    | { type: 'telegram_test_result'; ok: boolean; message: string; state: TelegramState }
    | { type: 'telegram_chat_detected'; chatId: string; title?: string };

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
    inboxMonitor?: InboxMonitorSnapshot;
    notificationDelivery?: NotificationDeliverySnapshot;
    warning?: string;
}
