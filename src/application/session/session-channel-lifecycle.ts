import {
    AppChannel,
    AppConfig,
    AppEvent,
    ChannelHealthRecord,
    ChannelProgressRecord,
    RuntimeOptions,
    SessionState
} from '../../types';
import type { SenderLifecycle, SleepFn } from './sender-types';

type SessionUpdateReason = Extract<AppEvent, { type: 'session_state_updated' }>['reason'];

interface SessionChannelLifecycleContext {
    config: AppConfig;
    state: SessionState;
    runtime: RuntimeOptions;
    sleepImpl: SleepFn;
    paused(): boolean;
    stopping(): boolean;
    getStopReason(): string | null;
    getState(): SessionState;
    emitEvent?: (event: AppEvent) => void;
    ensureChannelProgress(channelId: string): ChannelProgressRecord;
    ensureChannelHealth(channelId: string): ChannelHealthRecord;
    syncPacingState(): void;
    bumpState(): void;
    persistState(): void;
    emitStateUpdated(reason: SessionUpdateReason): void;
    recentMessageHistory: Record<string, string[]>;
}

export function createSessionChannelLifecycle(context: SessionChannelLifecycleContext): SenderLifecycle {
    return {
        isPaused: () => context.paused(),
        waitUntilResumed: async (waitSleep) => {
            while (context.paused() && !context.stopping()) {
                await waitSleep(150);
            }
            return !context.stopping();
        },
        isStopping: () => context.stopping(),
        getStopReason: () => context.getStopReason(),
        onChannelEvent: (channel, phase) => {
            const progress = context.ensureChannelProgress(channel.id);
            if (phase === 'started') {
                progress.status = progress.status === 'suppressed' ? 'suppressed' : 'running';
                if (!context.state.activeChannels.includes(channel.id)) {
                    context.state.activeChannels = [...context.state.activeChannels, channel.id];
                }
            }

            if (phase === 'completed') {
                progress.status = 'completed';
                progress.suppressedUntil = undefined;
                context.state.activeChannels = context.state.activeChannels.filter((id) => id !== channel.id);
                if (!context.state.completedChannels.includes(channel.id)) {
                    context.state.completedChannels = [...context.state.completedChannels, channel.id];
                }
            }

            if (phase === 'failed') {
                progress.status = 'failed';
                context.state.activeChannels = context.state.activeChannels.filter((id) => id !== channel.id);
                if (!context.state.failedChannels.includes(channel.id)) {
                    context.state.failedChannels = [...context.state.failedChannels, channel.id];
                }
            }

            if (phase === 'stopped') {
                progress.status = progress.suppressedUntil ? 'suppressed' : 'stopped';
                context.state.activeChannels = context.state.activeChannels.filter((id) => id !== channel.id);
                context.state.completedChannels = context.state.completedChannels.filter((id) => id !== channel.id);
                context.state.failedChannels = context.state.failedChannels.filter((id) => id !== channel.id);
            }

            context.bumpState();
            context.persistState();
            context.emitEvent?.({
                type: 'channel_state_changed',
                state: context.getState(),
                channelId: channel.id,
                phase
            });
        },
        getRecentMessages: (channel) => {
            return context.recentMessageHistory[channel.id] ?? [];
        },
        onMessageSent: (channel, details) => {
            const progress = context.ensureChannelProgress(channel.id);
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

            const health = context.ensureChannelHealth(channel.id);
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

            context.state.sentMessages += 1;
            context.recentMessageHistory[channel.id] = [
                ...(context.recentMessageHistory[channel.id] ?? []),
                details.template
            ].slice(-20);
            context.syncPacingState();
            context.bumpState();
            context.persistState();
            context.emitStateUpdated('message_sent');
        },
        onRateLimit: (channel, waitSeconds, consecutiveRateLimits) => {
            const progress = context.ensureChannelProgress(channel.id);
            progress.consecutiveRateLimits = consecutiveRateLimits;
            progress.lastError = `Rate limited for ${waitSeconds}s`;

            const health = context.ensureChannelHealth(channel.id);
            health.status = 'degraded';
            health.consecutiveRateLimits = consecutiveRateLimits;
            health.lastReason = `Rate limited for ${waitSeconds}s`;
            health.lastFailureAt = new Date().toISOString();

            context.syncPacingState();
            context.bumpState();
            context.persistState();
            context.emitStateUpdated('pacing_changed');
        },
        onChannelSuppressed: (channel, details) => {
            const progress = context.ensureChannelProgress(channel.id);
            progress.status = 'suppressed';
            progress.suppressedUntil = details.suppressedUntil;
            progress.lastError = details.reason;

            const health = context.ensureChannelHealth(channel.id);
            health.status = 'suppressed';
            health.suppressedUntil = details.suppressedUntil;
            health.suppressionCount += 1;
            health.lastReason = details.reason;
            health.lastFailureAt = new Date().toISOString();

            context.bumpState();
            context.persistState();
            context.emitStateUpdated('health_changed');
        },
        onChannelRecovered: (channel) => {
            const progress = context.ensureChannelProgress(channel.id);
            progress.status = 'running';
            progress.suppressedUntil = undefined;

            const health = context.ensureChannelHealth(channel.id);
            health.status = health.status === 'recovering' ? 'healthy' : 'recovering';
            health.suppressedUntil = undefined;
            health.consecutiveRateLimits = 0;
            health.consecutiveFailures = 0;
            health.lastSuccessAt = new Date().toISOString();

            context.syncPacingState();
            context.bumpState();
            context.persistState();
            context.emitStateUpdated('health_changed');
        },
        onChannelFailure: (channel, reason) => {
            const progress = context.ensureChannelProgress(channel.id);
            progress.lastError = reason;

            const health = context.ensureChannelHealth(channel.id);
            health.status = 'failed';
            health.consecutiveFailures += 1;
            health.lastReason = reason;
            health.lastFailureAt = new Date().toISOString();

            context.bumpState();
            context.persistState();
            context.emitStateUpdated('health_changed');
        }
    };
}
