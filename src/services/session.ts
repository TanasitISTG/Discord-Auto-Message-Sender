import path from 'path';
import { AppConfig, AppEvent, LogEntry, SessionState, SessionSummary, SessionStatus } from '../types';
import { createSenderCoordinator, runChannel } from '../core/sender';
import { createFileSink, createStructuredLogger, StructuredLogger } from '../utils/logger';
import { loadSenderState, saveSenderState } from './state-store';

const SESSION_LOG_DIR = 'logs';
const RESUME_POLL_INTERVAL_MS = 150;

type SleepFn = (ms: number) => Promise<void>;

export interface SessionServiceOptions {
    config: AppConfig;
    token: string;
    baseDir: string;
    runtime: {
        numMessages: number;
        baseWaitSeconds: number;
        marginSeconds: number;
    };
    emitEvent?: (event: AppEvent) => void;
    sleep?: SleepFn;
    fetchImpl?: typeof fetch;
    sessionId?: string;
    logger?: StructuredLogger;
}

function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function createInitialState(sessionId: string): SessionState {
    const now = new Date().toISOString();
    return {
        id: sessionId,
        status: 'idle',
        updatedAt: now,
        activeChannels: [],
        completedChannels: [],
        failedChannels: [],
        sentMessages: 0
    };
}

export class SessionService {
    private readonly config: AppConfig;
    private readonly token: string;
    private readonly baseDir: string;
    private readonly runtime: SessionServiceOptions['runtime'];
    private readonly emitEvent?: (event: AppEvent) => void;
    private readonly sleepImpl: SleepFn;
    private readonly fetchImpl?: typeof fetch;
    private readonly sessionId: string;
    private readonly coordinator = createSenderCoordinator();
    private readonly state: SessionState;
    private readonly recentMessageHistory: Record<string, string[]>;
    private paused = false;
    private stopping = false;
    private resumeWaiters = new Set<(value: boolean) => void>();
    private readonly logger: StructuredLogger;

    constructor(options: SessionServiceOptions) {
        this.config = options.config;
        this.token = options.token;
        this.baseDir = options.baseDir;
        this.runtime = options.runtime;
        this.emitEvent = options.emitEvent;
        this.sleepImpl = options.sleep ?? sleep;
        this.fetchImpl = options.fetchImpl;
        this.sessionId = options.sessionId ?? `session-${Date.now()}`;
        this.state = createInitialState(this.sessionId);
        this.recentMessageHistory = loadSenderState(this.baseDir).recentMessageHistory ?? {};

        const logFile = path.join(this.baseDir, SESSION_LOG_DIR, `${this.sessionId}.jsonl`);
        this.logger = options.logger ?? createStructuredLogger({
            sinks: [
                createFileSink(logFile),
                (entry) => this.emitEvent?.({ type: 'log_event_emitted', entry })
            ],
            defaults: {
                sessionId: this.sessionId
            }
        });
    }

    getState(): SessionState {
        return { ...this.state };
    }

    pause() {
        if (this.state.status !== 'running') {
            return this.getState();
        }

        this.paused = true;
        this.state.status = 'paused';
        this.bumpState();
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
        for (const waiter of this.resumeWaiters) {
            waiter(true);
        }
        this.resumeWaiters.clear();
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
        for (const waiter of this.resumeWaiters) {
            waiter(false);
        }
        this.resumeWaiters.clear();
        this.emitEvent?.({ type: 'session_stopping', state: this.getState() });
        return this.getState();
    }

    async start() {
        this.state.status = 'running';
        this.state.startedAt = new Date().toISOString();
        this.bumpState();
        this.persistState();
        this.emitEvent?.({ type: 'session_started', state: this.getState() });

        try {
            await Promise.all(this.config.channels.map((target) => runChannel({
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
                        if (phase === 'started' && !this.state.activeChannels.includes(channel.id)) {
                            this.state.activeChannels = [...this.state.activeChannels, channel.id];
                        }

                        if (phase === 'completed') {
                            this.state.activeChannels = this.state.activeChannels.filter((id) => id !== channel.id);
                            if (!this.state.completedChannels.includes(channel.id)) {
                                this.state.completedChannels = [...this.state.completedChannels, channel.id];
                            }
                        }

                        if (phase === 'failed') {
                            this.state.activeChannels = this.state.activeChannels.filter((id) => id !== channel.id);
                            if (!this.state.failedChannels.includes(channel.id)) {
                                this.state.failedChannels = [...this.state.failedChannels, channel.id];
                            }
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
                    onMessageSent: (channel, message) => {
                        this.state.sentMessages += 1;
                        this.recentMessageHistory[channel.id] = [
                            ...(this.recentMessageHistory[channel.id] ?? []),
                            message
                        ].slice(-20);
                        this.bumpState();
                        this.persistState();
                    }
                }
            })));

            const status: SessionStatus = this.stopping || this.coordinator.isAborted()
                ? 'failed'
                : 'completed';
            this.state.status = status;
            this.state.summary = this.buildSummary();
            this.bumpState();
            this.persistState();
            this.emitEvent?.({
                type: 'summary_ready',
                summary: this.state.summary,
                state: this.getState()
            });
            return this.getState();
        } catch (error) {
            this.state.status = 'failed';
            this.state.stopReason = error instanceof Error ? error.message : String(error);
            this.state.summary = this.buildSummary();
            this.bumpState();
            this.persistState();
            this.emitEvent?.({
                type: 'summary_ready',
                summary: this.state.summary,
                state: this.getState()
            });
            throw error;
        }
    }

    private buildSummary(): SessionSummary {
        return {
            totalChannels: this.config.channels.length,
            completedChannels: this.state.completedChannels.length,
            failedChannels: this.state.failedChannels.length,
            sentMessages: this.state.sentMessages,
            startedAt: this.state.startedAt ?? new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            stopReason: this.state.stopReason
        };
    }

    private persistState() {
        const senderState = loadSenderState(this.baseDir);
        senderState.lastSession = this.getState();

        if (this.state.summary) {
            senderState.summaries = [this.state.summary, ...senderState.summaries].slice(0, 10);
        }

        if (this.state.failedChannels.length > 0) {
            senderState.recentFailures = [
                ...this.state.failedChannels.map((channelId) => {
                    const channel = this.config.channels.find((item) => item.id === channelId);
                    return {
                        channelId,
                        channelName: channel?.name ?? channelId,
                        reason: this.state.stopReason ?? 'Channel failed during session.',
                        timestamp: new Date().toISOString()
                    };
                }),
                ...senderState.recentFailures
            ].slice(0, 25);
        }

        senderState.recentMessageHistory = this.recentMessageHistory;
        saveSenderState(this.baseDir, senderState);
    }

    private bumpState() {
        this.state.updatedAt = new Date().toISOString();
    }
}
