import type { AppConfig, RuntimeOptions, SenderStateRecord, SessionState } from '../../types';
import { updateSenderState } from '../../infrastructure/state-store';
import { createSessionConfigSignature } from './resume-session';

interface PersistedSessionContext {
    sessionId: string;
    runtime: RuntimeOptions;
    config: AppConfig;
    state: SessionState;
    senderStateRecord: SenderStateRecord;
    recentMessageHistory: Record<string, string[]>;
    stopping: boolean;
    getState(): SessionState;
}

export function updatePersistedSessionRecord(context: PersistedSessionContext, finalize: boolean) {
    context.senderStateRecord.lastSession = context.getState();
    context.senderStateRecord.recentMessageHistory = structuredClone(context.recentMessageHistory);
    context.senderStateRecord.channelHealth = structuredClone(context.state.channelHealth ?? {});

    if (finalize) {
        context.senderStateRecord.resumeSession = context.stopping
            ? {
                sessionId: context.sessionId,
                updatedAt: context.state.updatedAt,
                runtime: context.runtime,
                configSignature: createSessionConfigSignature(context.config),
                state: {
                    ...context.getState(),
                    status: 'stopped',
                    summary: undefined,
                    stopReason: undefined
                },
                recentMessageHistory: structuredClone(context.recentMessageHistory)
            }
            : undefined;

        if (context.state.summary) {
            context.senderStateRecord.summaries = [context.state.summary, ...context.senderStateRecord.summaries].slice(0, 10);
        }

        const newFailures = context.state.failedChannels.map((channelId) => {
            const channel = context.config.channels.find((item) => item.id === channelId);
            const progress = context.state.channelProgress?.[channelId];
            return {
                channelId,
                channelName: channel?.name ?? channelId,
                reason: progress?.lastError ?? context.state.stopReason ?? 'Channel failed during session.',
                timestamp: new Date().toISOString()
            };
        });
        context.senderStateRecord.recentFailures = [...newFailures, ...context.senderStateRecord.recentFailures].slice(0, 25);
        return;
    }

    if (['running', 'paused', 'stopping'].includes(context.state.status)) {
        context.senderStateRecord.resumeSession = {
            sessionId: context.sessionId,
            updatedAt: context.state.updatedAt,
            runtime: context.runtime,
            configSignature: createSessionConfigSignature(context.config),
            state: context.getState(),
            recentMessageHistory: structuredClone(context.recentMessageHistory)
        };
    }
}

export function flushPersistedSessionState(baseDir: string, senderStateRecord: SenderStateRecord) {
    const nextState = updateSenderState(baseDir, (state) => {
        state.lastSession = senderStateRecord.lastSession;
        state.summaries = senderStateRecord.summaries;
        state.recentFailures = senderStateRecord.recentFailures;
        state.recentMessageHistory = senderStateRecord.recentMessageHistory;
        state.channelHealth = senderStateRecord.channelHealth;
        state.resumeSession = senderStateRecord.resumeSession;
        state.warning = undefined;
    });
    senderStateRecord.lastSession = nextState.lastSession;
    senderStateRecord.summaries = nextState.summaries;
    senderStateRecord.recentFailures = nextState.recentFailures;
    senderStateRecord.recentMessageHistory = nextState.recentMessageHistory ?? {};
    senderStateRecord.channelHealth = nextState.channelHealth ?? {};
    senderStateRecord.resumeSession = nextState.resumeSession;
    senderStateRecord.inboxMonitor = nextState.inboxMonitor;
    senderStateRecord.notificationDelivery = nextState.notificationDelivery;
}
