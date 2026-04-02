import {
    AppEvent,
    InboxMonitorSnapshot,
    InboxMonitorState
} from '../../types';
import { getDefaultInboxMonitorSnapshot } from '../../infrastructure/state-store';
import { pollInboxSnapshot } from './poller';
import {
    buildStatePatch,
    FetchImpl,
    hydrateSnapshot,
    InboxMonitorController,
    InboxMonitorOptions,
    normalizeSettings,
    sleep,
    SleepFn,
    StartInboxMonitorOptions,
    MIN_POLL_INTERVAL_SECONDS,
    MAX_POLL_INTERVAL_SECONDS
} from './snapshot';

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
    private runGeneration = 0;
    private activeRunController: AbortController | null = null;

    constructor(options: InboxMonitorOptions = {}) {
        this.emitEvent = options.emitEvent;
        this.onSnapshotChange = options.onSnapshotChange;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.sleepImpl = options.sleep ?? sleep;
        this.now = options.now ?? (() => new Date());
        this.random = options.random ?? Math.random;
        this.snapshot = hydrateSnapshot(options.initialSnapshot);
    }

    loadSettings() {
        return { ...this.snapshot.settings };
    }

    saveSettings(settings: InboxMonitorSnapshot['settings']) {
        const normalized = normalizeSettings(settings);
        if (!normalized.enabled) {
            this.stopCurrentLoop();
        }
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
        if (!this.snapshot.settings.enabled) {
            this.stopCurrentLoop();
            this.setState({
                status: 'stopped',
                enabled: false,
                pollIntervalSeconds: this.snapshot.settings.pollIntervalSeconds,
                lastError: undefined,
                backoffUntil: undefined
            });
            return this.getState();
        }

        const nextToken = typeof options.token === 'string' && options.token.trim().length > 0
            ? options.token.trim()
            : this.currentToken;

        if (!nextToken) {
            this.stopCurrentLoop();
            this.setState({
                status: 'blocked',
                enabled: true,
                pollIntervalSeconds: this.snapshot.settings.pollIntervalSeconds,
                lastError: 'Discord token is missing. Save a token before starting inbox notifications.',
                backoffUntil: undefined
            });
            return this.getState();
        }

        if (this.running && nextToken === this.currentToken) {
            return this.getState();
        }

        if (this.running || this.loopPromise) {
            this.stopCurrentLoop();
            await this.awaitLoopShutdown();
        }

        this.currentToken = nextToken;
        this.running = true;
        const runId = ++this.runGeneration;
        this.setState({
            status: 'starting',
            enabled: true,
            pollIntervalSeconds: this.snapshot.settings.pollIntervalSeconds,
            lastError: undefined,
            backoffUntil: undefined
        });
        const runController = new AbortController();
        this.activeRunController = runController;
        const loopPromise = this.runLoop(runId, nextToken, runController.signal)
            .finally(() => {
                if (this.loopPromise === loopPromise) {
                    this.loopPromise = null;
                }
                if (this.activeRunController === runController) {
                    this.activeRunController = null;
                }
                if (this.runGeneration === runId) {
                    this.running = false;
                }
            });
        this.loopPromise = loopPromise;
        return this.getState();
    }

    stop(reason?: string): InboxMonitorState {
        this.stopCurrentLoop();
        this.setState({
            status: 'stopped',
            enabled: this.snapshot.settings.enabled,
            pollIntervalSeconds: this.snapshot.settings.pollIntervalSeconds,
            lastError: reason,
            backoffUntil: undefined
        });
        return this.getState();
    }

    private async runLoop(runId: number, token: string, abortSignal: AbortSignal) {
        while (this.isCurrentRun(runId)) {
            try {
                const result = await pollInboxSnapshot({
                    snapshot: this.snapshot,
                    token,
                    fetchImpl: this.fetchImpl,
                    now: this.now,
                    abortSignal
                });
                if (!this.isCurrentRun(runId)) {
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
                if (!this.isCurrentRun(runId)) {
                    break;
                }

                const message = error instanceof Error ? error.message : String(error);
                const lowered = message.toLowerCase();
                if (lowered.includes('401')) {
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

                const completedBackoff = await this.sleepWithAbort(backoffMs, abortSignal);
                if (!completedBackoff || !this.isCurrentRun(runId)) {
                    break;
                }
                continue;
            }

            const waitMs = this.snapshot.settings.pollIntervalSeconds * 1000
                + Math.round(this.random() * 2_500);
            const completedWait = await this.sleepWithAbort(waitMs, abortSignal);
            if (!completedWait) {
                break;
            }
        }
    }

    private stopCurrentLoop() {
        this.running = false;
        this.runGeneration += 1;
        this.activeRunController?.abort('Inbox monitor stopped.');
    }

    private isCurrentRun(runId: number): boolean {
        return this.running
            && this.snapshot.settings.enabled
            && this.runGeneration === runId;
    }

    private async awaitLoopShutdown() {
        if (!this.loopPromise) {
            return;
        }

        try {
            await this.loopPromise;
        } catch {
            // The loop already emitted its state transition; callers only need shutdown ordering here.
        }
    }

    private async sleepWithAbort(ms: number, abortSignal: AbortSignal): Promise<boolean> {
        if (abortSignal.aborted) {
            return false;
        }

        return await new Promise<boolean>((resolve) => {
            let settled = false;
            const finish = (completed: boolean) => {
                if (settled) {
                    return;
                }
                settled = true;
                abortSignal.removeEventListener('abort', onAbort);
                resolve(completed);
            };
            const onAbort = () => finish(false);

            abortSignal.addEventListener('abort', onAbort, { once: true });
            void this.sleepImpl(ms).then(
                () => finish(true),
                () => finish(false)
            );
        });
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

export type { InboxMonitorController, InboxMonitorOptions, StartInboxMonitorOptions };
export { MIN_POLL_INTERVAL_SECONDS, MAX_POLL_INTERVAL_SECONDS };
