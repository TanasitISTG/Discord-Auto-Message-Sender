import path from 'path';
import {
    AdaptivePacingState,
    AppConfig,
    AppEvent,
    ChannelHealthRecord,
    ChannelProgressRecord,
    RuntimeOptions,
    SenderStateRecord,
    SessionSegmentKind,
    SessionState,
    SessionSummary,
    SessionStatus
} from '../types';
import { createSenderCoordinator, runChannel } from '../core/sender';
import { createBufferedFileWriter, createStructuredLogger, StructuredLogger } from '../utils/logger';
import { validateSessionId } from '../utils/session-id';
import { loadSenderState, saveSenderState } from './state-store';

const SESSION_LOG_DIR = 'logs';
const RESUME_POLL_INTERVAL_MS = 150;
const RECENT_MESSAGE_HISTORY_LIMIT = 20;
const STATE_FLUSH_DEBOUNCE_MS = 250;
type SleepFn = (ms: number) => Promise<void>;
type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ResumeSessionRecord = NonNullable<SenderStateRecord['resumeSession']>;
type SessionUpdateReason = Extract<AppEvent, { type: 'session_state_updated' }>['reason'];

interface SessionSegment {
    id: string;
    kind: SessionSegmentKind;
    startedAt: string;
    resumedFromCheckpointAt?: string;
}

export interface SessionServiceOptions {
    config: AppConfig;
    token: string;
    baseDir: string;
    runtime: RuntimeOptions;
    emitEvent?: (event: AppEvent) => void;
    sleep?: SleepFn;
    fetchImpl?: FetchImpl;
    sessionId?: string;
    logger?: StructuredLogger;
    resumeSession?: ResumeSessionRecord;
}

function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function createEmptyChannelProgress(channel: AppConfig['channels'][number]): ChannelProgressRecord {
    return {
        channelId: channel.id,
        channelName: channel.name,
        status: 'pending',
        sentMessages: 0,
        sentToday: 0,
        consecutiveRateLimits: 0
    };
}

function createEmptyChannelHealth(channel: AppConfig['channels'][number]): ChannelHealthRecord {
    return {
        channelId: channel.id,
        channelName: channel.name,
        status: 'healthy',
        consecutiveRateLimits: 0,
        consecutiveFailures: 0,
        suppressionCount: 0
    };
}

function buildChannelProgress(
    config: AppConfig,
    previous?: Record<string, ChannelProgressRecord>
): Record<string, ChannelProgressRecord> {
    return Object.fromEntries(config.channels.map((channel) => [
        channel.id,
        {
            ...createEmptyChannelProgress(channel),
            ...(previous?.[channel.id] ?? {})
        }
    ]));
}

function buildChannelHealth(
    config: AppConfig,
    previous?: Record<string, ChannelHealthRecord>
): Record<string, ChannelHealthRecord> {
    return Object.fromEntries(config.channels.map((channel) => [
        channel.id,
        {
            ...createEmptyChannelHealth(channel),
            ...(previous?.[channel.id] ?? {})
        }
    ]));
}

function createInitialPacing(): AdaptivePacingState {
    return {
        baseRequestIntervalMs: 250,
        currentRequestIntervalMs: 250,
        maxRequestIntervalMs: 250,
        penaltyLevel: 0,
        recentRateLimitCount: 0
    };
}

function createSessionSegment(kind: SessionSegmentKind, resumedFromCheckpointAt?: string): SessionSegment {
    return {
        id: `segment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        startedAt: new Date().toISOString(),
        resumedFromCheckpointAt
    };
}

function createInitialState(
    sessionId: string,
    runtime: RuntimeOptions,
    config: AppConfig,
    segment: SessionSegment,
    persistedHealth?: Record<string, ChannelHealthRecord>
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
        pacing: createInitialPacing()
    };
}

function restoreStateFromResume(
    resumeSession: ResumeSessionRecord,
    config: AppConfig,
    segment: SessionSegment,
    persistedHealth?: Record<string, ChannelHealthRecord>
): SessionState {
    const restored = structuredClone(resumeSession.state);
    restored.status = 'idle';
    restored.updatedAt = new Date().toISOString();
    restored.currentSegmentId = segment.id;
    restored.currentSegmentKind = segment.kind;
    restored.currentSegmentStartedAt = segment.startedAt;
    restored.resumedFromCheckpointAt = segment.resumedFromCheckpointAt;
    restored.runtime = resumeSession.runtime;
    restored.resumedFromCheckpoint = true;
    restored.channelProgress = buildChannelProgress(config, restored.channelProgress);
    restored.channelHealth = buildChannelHealth(config, restored.channelHealth ?? persistedHealth);
    restored.pacing = restored.pacing ?? createInitialPacing();
    restored.activeChannels = restored.activeChannels.filter((channelId) => !(restored.completedChannels.includes(channelId) || restored.failedChannels.includes(channelId)));
    return restored;
}

function createOutcomeStatus(progress: ChannelProgressRecord): 'completed' | 'failed' | 'suppressed' {
    if (progress.status === 'completed') {
        return 'completed';
    }

    if (progress.status === 'suppressed') {
        return 'suppressed';
    }

    return 'failed';
}

export function createSessionConfigSignature(config: AppConfig): string {
    return JSON.stringify(config);
}

export function canResumeSession(
    resumeSession: ResumeSessionRecord | undefined,
    config: AppConfig,
    runtime: RuntimeOptions
): resumeSession is ResumeSessionRecord {
    if (!resumeSession) {
        return false;
    }

    if (!['running', 'paused'].includes(resumeSession.state.status)) {
        return false;
    }

    if (resumeSession.configSignature !== createSessionConfigSignature(config)) {
        return false;
    }

    return resumeSession.runtime.numMessages === runtime.numMessages
        && resumeSession.runtime.baseWaitSeconds === runtime.baseWaitSeconds
        && resumeSession.runtime.marginSeconds === runtime.marginSeconds;
}

export class SessionService {
    private readonly config: AppConfig;
    private readonly token: string;
    private readonly baseDir: string;
    private readonly runtime: RuntimeOptions;
    private readonly emitEvent?: (event: AppEvent) => void;
    private readonly sleepImpl: SleepFn;
    private readonly fetchImpl?: FetchImpl;
    private readonly sessionId: string;
    private readonly resumeSession?: ResumeSessionRecord;
    private readonly coordinator;
    private readonly state: SessionState;
    private readonly recentMessageHistory: Record<string, string[]>;
    private readonly senderStateRecord: SenderStateRecord;
    private readonly segment: SessionSegment;
    private paused = false;
    private stopping = false;
    private readonly logger: StructuredLogger;
    private readonly logWriter: ReturnType<typeof createBufferedFileWriter>;
    private stateFlushTimer: NodeJS.Timeout | null = null;
    private stateFlushPending = false;
    private stateFlushInFlight: Promise<void> | null = null;

    constructor(options: SessionServiceOptions) {
        this.config = options.config;
        this.token = options.token;
        this.baseDir = options.baseDir;
        this.runtime = options.runtime;
        this.emitEvent = options.emitEvent;
        this.sleepImpl = options.sleep ?? sleep;
        this.fetchImpl = options.fetchImpl;
        this.resumeSession = options.resumeSession;

        const persistedState = loadSenderState(this.baseDir);
        this.senderStateRecord = structuredClone(persistedState);
        this.sessionId = validateSessionId(options.sessionId ?? this.resumeSession?.sessionId ?? `session-${Date.now()}`);
        this.segment = createSessionSegment(
            this.resumeSession ? 'resumed' : 'fresh',
            this.resumeSession?.updatedAt
        );
        this.coordinator = createSenderCoordinator(250, this.resumeSession?.state.pacing);
        this.state = this.resumeSession
            ? restoreStateFromResume(this.resumeSession, this.config, this.segment, persistedState.channelHealth)
            : createInitialState(this.sessionId, this.runtime, this.config, this.segment, persistedState.channelHealth);
        this.state.id = this.sessionId;
        this.state.runtime = this.runtime;
        this.state.pacing = this.coordinator.getPacingState();

        this.recentMessageHistory = structuredClone(
            this.resumeSession?.recentMessageHistory
            ?? persistedState.recentMessageHistory
            ?? {}
        );

        this.logWriter = createBufferedFileWriter(path.join(this.baseDir, SESSION_LOG_DIR, `${this.sessionId}.jsonl`));
        const baseLogger = createStructuredLogger({
            sinks: [
                this.logWriter.sink,
                (entry) => this.emitEvent?.({ type: 'log_event_emitted', entry }),
                ...(options.logger
                    ? [((entry: ReturnType<StructuredLogger['emit']>) => {
                        options.logger?.emit({
                            timestamp: entry.timestamp,
                            context: entry.context,
                            level: entry.level,
                            message: entry.message,
                            meta: entry.meta,
                            sessionId: entry.sessionId,
                            segmentId: entry.segmentId,
                            segmentKind: entry.segmentKind
                        });
                    })]
                    : [])
            ],
            defaults: {
                sessionId: this.sessionId
            }
        });
        this.logger = baseLogger.child({
            sessionId: this.sessionId,
            segmentId: this.segment.id,
            segmentKind: this.segment.kind
        });
    }

    getState(): SessionState {
        return structuredClone(this.state);
    }

    pause() {
        if (this.state.status !== 'running') {
            return this.getState();
        }

        this.paused = true;
        this.state.status = 'paused';
        this.bumpState();
        this.persistState();
        this.emitEvent?.({ type: 'session_paused', state: this.getState() });
        return this.getState();
    }

    resume() {
        if (this.state.status !== 'paused') {
            return this.getState();
        }

        this.paused = false;
        this.state.status = 'running';
        this.bumpState();
        this.persistState();
        this.emitEvent?.({ type: 'session_resumed', state: this.getState() });
        return this.getState();
    }

    stop(reason: string = 'Stop requested from desktop UI.') {
        if (this.stopping || this.state.status === 'completed' || this.state.status === 'failed') {
            return this.getState();
        }

        this.stopping = true;
        this.coordinator.abort(reason);
        this.state.status = 'stopping';
        this.state.stopReason = reason;
        this.bumpState();
        this.persistState();
        this.emitEvent?.({ type: 'session_stopping', state: this.getState() });
        return this.getState();
    }

    async start() {
        this.state.status = 'running';
        this.state.startedAt = this.state.startedAt ?? new Date().toISOString();
        this.state.stopReason = undefined;
        this.syncPacingState();
        this.bumpState();
        this.logger.emit({
            context: 'Session',
            level: 'info',
            message: this.state.resumedFromCheckpoint ? 'Resumed from saved checkpoint.' : 'Fresh session segment started.',
            meta: {
                event: 'session_segment_started',
                segmentStartedAt: this.segment.startedAt,
                resumedFromCheckpointAt: this.segment.resumedFromCheckpointAt ?? null
            }
        });
        this.persistState();
        this.emitEvent?.({ type: 'session_started', state: this.getState() });

        if (this.state.resumedFromCheckpoint) {
            this.emitStateUpdated('checkpoint_restored');
        }

        try {
            const runnableChannels = this.config.channels.filter((channel) => {
                const progress = this.state.channelProgress?.[channel.id];
                return progress?.status !== 'completed' && progress?.status !== 'failed';
            });

            await Promise.all(runnableChannels.map((target) => runChannel({
                target,
                numMessages: this.runtime.numMessages,
                baseWaitSeconds: this.runtime.baseWaitSeconds,
                marginSeconds: this.runtime.marginSeconds,
                token: this.token,
                userAgent: this.config.userAgent,
                messageGroups: this.config.messageGroups,
                coordinator: this.coordinator,
                sleep: this.sleepImpl,
                fetchImpl: this.fetchImpl,
                logger: this.logger,
                resumeProgress: this.state.channelProgress?.[target.id],
                lifecycle: {
                    isPaused: () => this.paused,
                    waitUntilResumed: async (waitSleep) => {
                        while (this.paused && !this.stopping) {
                            await waitSleep(RESUME_POLL_INTERVAL_MS);
                        }
                        return !this.stopping;
                    },
                    isStopping: () => this.stopping,
                    getStopReason: () => this.state.stopReason ?? null,
                    onChannelEvent: (channel, phase) => {
                        const progress = this.ensureChannelProgress(channel.id);
                        if (phase === 'started') {
                            progress.status = progress.status === 'suppressed' ? 'suppressed' : 'running';
                            if (!this.state.activeChannels.includes(channel.id)) {
                                this.state.activeChannels = [...this.state.activeChannels, channel.id];
                            }
                        }

                        if (phase === 'completed') {
                            progress.status = 'completed';
                            progress.suppressedUntil = undefined;
                            this.state.activeChannels = this.state.activeChannels.filter((id) => id !== channel.id);
                            if (!this.state.completedChannels.includes(channel.id)) {
                                this.state.completedChannels = [...this.state.completedChannels, channel.id];
                            }
                        }

                        if (phase === 'failed') {
                            progress.status = 'failed';
                            this.state.activeChannels = this.state.activeChannels.filter((id) => id !== channel.id);
                            if (!this.state.failedChannels.includes(channel.id)) {
                                this.state.failedChannels = [...this.state.failedChannels, channel.id];
                            }
                        }

                        if (phase === 'stopped') {
                            progress.status = progress.suppressedUntil ? 'suppressed' : 'stopped';
                            this.state.activeChannels = this.state.activeChannels.filter((id) => id !== channel.id);
                            this.state.completedChannels = this.state.completedChannels.filter((id) => id !== channel.id);
                            this.state.failedChannels = this.state.failedChannels.filter((id) => id !== channel.id);
                        }

                        this.bumpState();
                        this.persistState();
                        this.emitEvent?.({
                            type: 'channel_state_changed',
                            state: this.getState(),
                            channelId: channel.id,
                            phase
                        });
                    },
                    getRecentMessages: (channel) => {
                        return this.recentMessageHistory[channel.id] ?? [];
                    },
                    onMessageSent: (channel, details) => {
                        const progress = this.ensureChannelProgress(channel.id);
                        progress.sentMessages += 1;
                        progress.sentToday = details.sentToday;
                        progress.sentTodayDayKey = details.sentTodayDayKey;
                        progress.consecutiveRateLimits = 0;
                        progress.lastMessage = details.rendered;
                        progress.lastSentAt = new Date().toISOString();
                        progress.lastError = undefined;
                        progress.suppressedUntil = undefined;
                        if (progress.status !== 'completed') {
                            progress.status = 'running';
                        }

                        const health = this.ensureChannelHealth(channel.id);
                        if (health.status === 'recovering') {
                            health.status = 'healthy';
                        } else if (health.status !== 'healthy') {
                            health.status = 'recovering';
                        }
                        health.consecutiveRateLimits = 0;
                        health.consecutiveFailures = 0;
                        health.lastSuccessAt = new Date().toISOString();
                        health.suppressedUntil = undefined;
                        health.lastReason = undefined;

                        this.state.sentMessages += 1;
                        this.recentMessageHistory[channel.id] = [
                            ...(this.recentMessageHistory[channel.id] ?? []),
                            details.template
                        ].slice(-RECENT_MESSAGE_HISTORY_LIMIT);
                        this.syncPacingState();
                        this.bumpState();
                        this.persistState();
                        this.emitStateUpdated('message_sent');
                    },
                    onRateLimit: (channel, waitSeconds, consecutiveRateLimits) => {
                        const progress = this.ensureChannelProgress(channel.id);
                        progress.consecutiveRateLimits = consecutiveRateLimits;
                        progress.lastError = `Rate limited for ${waitSeconds}s`;

                        const health = this.ensureChannelHealth(channel.id);
                        health.status = 'degraded';
                        health.consecutiveRateLimits = consecutiveRateLimits;
                        health.lastReason = `Rate limited for ${waitSeconds}s`;
                        health.lastFailureAt = new Date().toISOString();

                        this.syncPacingState();
                        this.bumpState();
                        this.persistState();
                        this.emitStateUpdated('pacing_changed');
                    },
                    onChannelSuppressed: (channel, details) => {
                        const progress = this.ensureChannelProgress(channel.id);
                        progress.status = 'suppressed';
                        progress.suppressedUntil = details.suppressedUntil;
                        progress.lastError = details.reason;

                        const health = this.ensureChannelHealth(channel.id);
                        health.status = 'suppressed';
                        health.suppressedUntil = details.suppressedUntil;
                        health.suppressionCount += 1;
                        health.lastReason = details.reason;
                        health.lastFailureAt = new Date().toISOString();

                        this.bumpState();
                        this.persistState();
                        this.emitStateUpdated('health_changed');
                    },
                    onChannelRecovered: (channel) => {
                        const progress = this.ensureChannelProgress(channel.id);
                        progress.status = 'running';
                        progress.suppressedUntil = undefined;

                        const health = this.ensureChannelHealth(channel.id);
                        health.status = health.status === 'recovering' ? 'healthy' : 'recovering';
                        health.suppressedUntil = undefined;
                        health.consecutiveRateLimits = 0;
                        health.consecutiveFailures = 0;
                        health.lastSuccessAt = new Date().toISOString();

                        this.syncPacingState();
                        this.bumpState();
                        this.persistState();
                        this.emitStateUpdated('health_changed');
                    },
                    onChannelFailure: (channel, reason) => {
                        const progress = this.ensureChannelProgress(channel.id);
                        progress.lastError = reason;

                        const health = this.ensureChannelHealth(channel.id);
                        health.status = 'failed';
                        health.consecutiveFailures += 1;
                        health.lastReason = reason;
                        health.lastFailureAt = new Date().toISOString();

                        this.bumpState();
                        this.persistState();
                        this.emitStateUpdated('health_changed');
                    }
                }
            })));

            const status: SessionStatus = !this.stopping && this.coordinator.isAborted()
                ? 'failed'
                : 'completed';
            this.state.status = status;
            this.state.summary = this.buildSummary();
            this.bumpState();
            await this.persistStateNow(true);
            this.emitEvent?.({
                type: 'summary_ready',
                summary: this.state.summary,
                state: this.getState()
            });
            await this.logWriter.close();
            return this.getState();
        } catch (error) {
            this.state.status = 'failed';
            this.state.stopReason = error instanceof Error ? error.message : String(error);
            this.state.summary = this.buildSummary();
            this.bumpState();
            await this.persistStateNow(true);
            this.emitEvent?.({
                type: 'summary_ready',
                summary: this.state.summary,
                state: this.getState()
            });
            await this.logWriter.close();
            throw error;
        }
    }

    private buildSummary(): SessionSummary {
        const progressRecords = Object.values(this.state.channelProgress ?? {});
        return {
            totalChannels: this.config.channels.length,
            completedChannels: this.state.completedChannels.length,
            failedChannels: this.state.failedChannels.length,
            sentMessages: this.state.sentMessages,
            startedAt: this.state.startedAt ?? new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            stopReason: this.state.stopReason,
            rateLimitEvents: this.state.pacing?.recentRateLimitCount ?? 0,
            suppressedChannels: progressRecords.filter((record) => record.status === 'suppressed').length,
            resumedFromCheckpoint: this.state.resumedFromCheckpoint,
            maxPacingIntervalMs: this.state.pacing?.maxRequestIntervalMs,
            channelOutcomes: progressRecords
                .filter((record) => ['completed', 'failed', 'suppressed'].includes(record.status))
                .map((record) => ({
                    channelId: record.channelId,
                    channelName: record.channelName,
                    status: createOutcomeStatus(record),
                    sentMessages: record.sentMessages,
                    lastError: record.lastError,
                    suppressedUntil: record.suppressedUntil
                }))
        };
    }

    private ensureChannelProgress(channelId: string): ChannelProgressRecord {
        const channel = this.config.channels.find((item) => item.id === channelId);
        const progress = this.state.channelProgress?.[channelId];
        if (progress) {
            return progress;
        }

        const nextProgress = channel
            ? createEmptyChannelProgress(channel)
            : {
                channelId,
                channelName: channelId,
                status: 'pending',
                sentMessages: 0,
                sentToday: 0,
                consecutiveRateLimits: 0
            } satisfies ChannelProgressRecord;
        this.state.channelProgress = {
            ...(this.state.channelProgress ?? {}),
            [channelId]: nextProgress
        };
        return nextProgress;
    }

    private ensureChannelHealth(channelId: string): ChannelHealthRecord {
        const channel = this.config.channels.find((item) => item.id === channelId);
        const health = this.state.channelHealth?.[channelId];
        if (health) {
            return health;
        }

        const nextHealth = channel
            ? createEmptyChannelHealth(channel)
            : {
                channelId,
                channelName: channelId,
                status: 'healthy',
                consecutiveRateLimits: 0,
                consecutiveFailures: 0,
                suppressionCount: 0
            } satisfies ChannelHealthRecord;
        this.state.channelHealth = {
            ...(this.state.channelHealth ?? {}),
            [channelId]: nextHealth
        };
        return nextHealth;
    }

    private syncPacingState() {
        this.state.pacing = this.coordinator.getPacingState();
    }

    private emitStateUpdated(reason: SessionUpdateReason) {
        this.emitEvent?.({
            type: 'session_state_updated',
            reason,
            state: this.getState()
        });
    }

    private persistState() {
        this.updatePersistedStateRecord(false);
        this.scheduleStateFlush();
    }

    private async persistStateNow(finalize: boolean = false) {
        this.updatePersistedStateRecord(finalize);
        this.clearStateFlushTimer();
        await this.flushStateNow();
    }

    private updatePersistedStateRecord(finalize: boolean) {
        this.senderStateRecord.lastSession = this.getState();
        this.senderStateRecord.recentMessageHistory = structuredClone(this.recentMessageHistory);
        this.senderStateRecord.channelHealth = structuredClone(this.state.channelHealth ?? {});

        if (finalize) {
            this.senderStateRecord.resumeSession = this.stopping
                ? {
                    sessionId: this.sessionId,
                    updatedAt: this.state.updatedAt,
                    runtime: this.runtime,
                    configSignature: createSessionConfigSignature(this.config),
                    state: {
                        ...this.getState(),
                        status: 'paused',
                        summary: undefined,
                        stopReason: undefined
                    },
                    recentMessageHistory: structuredClone(this.recentMessageHistory)
                }
                : undefined;

            if (this.state.summary) {
                this.senderStateRecord.summaries = [this.state.summary, ...this.senderStateRecord.summaries].slice(0, 10);
            }

            const newFailures = this.state.failedChannels.map((channelId) => {
                const channel = this.config.channels.find((item) => item.id === channelId);
                const progress = this.state.channelProgress?.[channelId];
                return {
                    channelId,
                    channelName: channel?.name ?? channelId,
                    reason: progress?.lastError ?? this.state.stopReason ?? 'Channel failed during session.',
                    timestamp: new Date().toISOString()
                };
            });
            this.senderStateRecord.recentFailures = [...newFailures, ...this.senderStateRecord.recentFailures].slice(0, 25);
            return;
        }

        if (['running', 'paused', 'stopping'].includes(this.state.status)) {
            this.senderStateRecord.resumeSession = {
                sessionId: this.sessionId,
                updatedAt: this.state.updatedAt,
                runtime: this.runtime,
                configSignature: createSessionConfigSignature(this.config),
                state: this.getState(),
                recentMessageHistory: structuredClone(this.recentMessageHistory)
            };
        }
    }

    private scheduleStateFlush() {
        this.stateFlushPending = true;
        if (this.stateFlushTimer) {
            return;
        }

        this.stateFlushTimer = setTimeout(() => {
            this.stateFlushTimer = null;
            void this.flushStateNow();
        }, STATE_FLUSH_DEBOUNCE_MS);
    }

    private clearStateFlushTimer() {
        if (this.stateFlushTimer) {
            clearTimeout(this.stateFlushTimer);
            this.stateFlushTimer = null;
        }
    }

    private async flushStateNow() {
        if (this.stateFlushInFlight) {
            await this.stateFlushInFlight;
            return;
        }

        if (!this.stateFlushPending) {
            return;
        }

        this.stateFlushPending = false;
        this.stateFlushInFlight = (async () => {
            const latestState = loadSenderState(this.baseDir);
            const nextState = {
                ...latestState,
                lastSession: this.senderStateRecord.lastSession,
                summaries: this.senderStateRecord.summaries,
                recentFailures: this.senderStateRecord.recentFailures,
                recentMessageHistory: this.senderStateRecord.recentMessageHistory,
                channelHealth: this.senderStateRecord.channelHealth,
                resumeSession: this.senderStateRecord.resumeSession,
                warning: undefined
            };
            saveSenderState(this.baseDir, nextState);
            this.senderStateRecord.lastSession = nextState.lastSession;
            this.senderStateRecord.summaries = nextState.summaries;
            this.senderStateRecord.recentFailures = nextState.recentFailures;
            this.senderStateRecord.recentMessageHistory = nextState.recentMessageHistory ?? {};
            this.senderStateRecord.channelHealth = nextState.channelHealth ?? {};
            this.senderStateRecord.resumeSession = nextState.resumeSession;
            this.senderStateRecord.inboxMonitor = nextState.inboxMonitor;
            this.senderStateRecord.notificationDelivery = nextState.notificationDelivery;
        })();

        try {
            await this.stateFlushInFlight;
        } finally {
            this.stateFlushInFlight = null;
            if (this.stateFlushPending) {
                await this.flushStateNow();
            }
        }
    }

    private bumpState() {
        this.state.updatedAt = new Date().toISOString();
    }
}
