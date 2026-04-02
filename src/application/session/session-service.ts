import {
    AppConfig,
    AppEvent,
    ChannelHealthRecord,
    ChannelProgressRecord,
    RuntimeOptions,
    SenderStateRecord,
    SessionState,
    SessionStatus,
} from '../../types';
import { createSenderCoordinator, runChannel } from '../../core/sender';
import { type BufferedFileWriter, type StructuredLogger } from '../../utils/logger';
import { validateSessionId } from '../../utils/session-id';
import { loadSenderState } from '../../infrastructure/state-store';
import { restoreStateFromResume, type ResumeSessionRecord } from './resume-session';
import { updatePersistedSessionRecord, flushPersistedSessionState } from './session-persistence';
import { buildSessionSummary } from './session-summary';
import { createSessionChannelLifecycle } from './session-channel-lifecycle';
import { SessionStateFlusher } from './session-state-flusher';
import { createSessionLoggerArtifacts } from './session-logger';
import {
    createInitialState,
    createSessionSegment,
    ensureChannelHealth,
    ensureChannelProgress,
    type SessionSegment,
} from './session-state-machine';
import type { FetchImpl, SleepFn } from './sender-types';

const STATE_FLUSH_DEBOUNCE_MS = 250;
type SessionUpdateReason = Extract<AppEvent, { type: 'session_state_updated' }>['reason'];

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
    private readonly logWriter: BufferedFileWriter;
    private readonly stateFlusher: SessionStateFlusher;

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
        this.sessionId = validateSessionId(
            options.sessionId ?? this.resumeSession?.sessionId ?? `session-${Date.now()}`,
        );
        this.segment = createSessionSegment(this.resumeSession ? 'resumed' : 'fresh', this.resumeSession?.updatedAt);
        this.coordinator = createSenderCoordinator(250, this.resumeSession?.state.pacing);
        this.state = this.resumeSession
            ? restoreStateFromResume(this.resumeSession, this.config, this.segment, persistedState.channelHealth)
            : createInitialState(this.sessionId, this.runtime, this.config, this.segment, persistedState.channelHealth);
        this.state.id = this.sessionId;
        this.state.runtime = this.runtime;
        this.state.pacing = this.coordinator.getPacingState();

        this.recentMessageHistory = structuredClone(
            this.resumeSession?.recentMessageHistory ?? persistedState.recentMessageHistory ?? {},
        );

        const loggerArtifacts = createSessionLoggerArtifacts({
            baseDir: this.baseDir,
            sessionId: this.sessionId,
            segment: this.segment,
            emitEvent: this.emitEvent,
            logger: options.logger,
        });
        this.logWriter = loggerArtifacts.logWriter;
        this.logger = loggerArtifacts.logger;
        this.stateFlusher = new SessionStateFlusher(STATE_FLUSH_DEBOUNCE_MS, () => {
            flushPersistedSessionState(this.baseDir, this.senderStateRecord);
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
        if (this.stopping || ['completed', 'failed', 'stopped'].includes(this.state.status)) {
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
            message: this.state.resumedFromCheckpoint
                ? 'Resumed from saved checkpoint.'
                : 'Fresh session segment started.',
            meta: {
                event: 'session_segment_started',
                segmentStartedAt: this.segment.startedAt,
                resumedFromCheckpointAt: this.segment.resumedFromCheckpointAt ?? null,
            },
        });
        this.persistState();
        this.emitEvent?.({ type: 'session_started', state: this.getState() });

        if (this.state.resumedFromCheckpoint) {
            this.emitStateUpdated('checkpoint_restored');
        }

        const lifecycle = createSessionChannelLifecycle({
            config: this.config,
            state: this.state,
            runtime: this.runtime,
            sleepImpl: this.sleepImpl,
            paused: () => this.paused,
            stopping: () => this.stopping,
            getStopReason: () => this.state.stopReason ?? null,
            getState: () => this.getState(),
            emitEvent: this.emitEvent,
            ensureChannelProgress: (channelId) => this.ensureChannelProgress(channelId),
            ensureChannelHealth: (channelId) => this.ensureChannelHealth(channelId),
            syncPacingState: () => this.syncPacingState(),
            bumpState: () => this.bumpState(),
            persistState: () => this.persistState(),
            emitStateUpdated: (reason) => this.emitStateUpdated(reason),
            recentMessageHistory: this.recentMessageHistory,
        });

        try {
            const runnableChannels = this.config.channels.filter((channel) => {
                const progress = this.state.channelProgress?.[channel.id];
                return progress?.status !== 'completed' && progress?.status !== 'failed';
            });

            await Promise.all(
                runnableChannels.map((target) =>
                    runChannel({
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
                        lifecycle,
                    }),
                ),
            );

            const status: SessionStatus = this.stopping
                ? 'stopped'
                : this.coordinator.isAborted() || this.state.failedChannels.length > 0
                  ? 'failed'
                  : 'completed';
            await this.finalize(status);
            return this.getState();
        } catch (error) {
            this.state.status = 'failed';
            this.state.stopReason = error instanceof Error ? error.message : String(error);
            await this.finalize('failed');
            throw error;
        }
    }

    private async finalize(status: SessionStatus) {
        this.state.status = status;
        this.state.summary = this.buildSummary();
        this.bumpState();
        await this.persistStateNow(true);
        this.emitEvent?.({
            type: 'summary_ready',
            summary: this.state.summary,
            state: this.getState(),
        });
        await this.logWriter.close();
    }

    private buildSummary() {
        return buildSessionSummary(this.config, this.state);
    }

    private ensureChannelProgress(channelId: string): ChannelProgressRecord {
        return ensureChannelProgress(this.config, this.state, channelId);
    }

    private ensureChannelHealth(channelId: string): ChannelHealthRecord {
        return ensureChannelHealth(this.config, this.state, channelId);
    }

    private syncPacingState() {
        this.state.pacing = this.coordinator.getPacingState();
    }

    private emitStateUpdated(reason: SessionUpdateReason) {
        this.emitEvent?.({
            type: 'session_state_updated',
            reason,
            state: this.getState(),
        });
    }

    private persistState() {
        this.updatePersistedStateRecord(false);
        this.stateFlusher.schedule();
    }

    private async persistStateNow(finalize: boolean = false) {
        this.updatePersistedStateRecord(finalize);
        this.stateFlusher.clearTimer();
        await this.stateFlusher.flushNow();
    }

    private updatePersistedStateRecord(finalize: boolean) {
        updatePersistedSessionRecord(
            {
                sessionId: this.sessionId,
                runtime: this.runtime,
                config: this.config,
                state: this.state,
                senderStateRecord: this.senderStateRecord,
                recentMessageHistory: this.recentMessageHistory,
                stopping: this.stopping,
                getState: () => this.getState(),
            },
            finalize,
        );
    }

    private bumpState() {
        this.state.updatedAt = new Date().toISOString();
    }
}

export { canResumeSession, createSessionConfigSignature } from './resume-session';
