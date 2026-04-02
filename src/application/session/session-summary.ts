import type { AppConfig, SessionState, SessionSummary } from '../../types';
import { createOutcomeStatus } from './session-state-machine';

export function buildSessionSummary(config: AppConfig, state: SessionState): SessionSummary {
    const progressRecords = Object.values(state.channelProgress ?? {});
    return {
        totalChannels: config.channels.length,
        completedChannels: state.completedChannels.length,
        failedChannels: state.failedChannels.length,
        sentMessages: state.sentMessages,
        startedAt: state.startedAt ?? new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        stopReason: state.stopReason,
        rateLimitEvents: state.pacing?.recentRateLimitCount ?? 0,
        suppressedChannels: progressRecords.filter((record) => record.status === 'suppressed').length,
        resumedFromCheckpoint: state.resumedFromCheckpoint,
        maxPacingIntervalMs: state.pacing?.maxRequestIntervalMs,
        channelOutcomes: progressRecords
            .filter((record) => ['completed', 'failed', 'suppressed'].includes(record.status))
            .map((record) => ({
                channelId: record.channelId,
                channelName: record.channelName,
                status: createOutcomeStatus(record),
                sentMessages: record.sentMessages,
                lastError: record.lastError,
                suppressedUntil: record.suppressedUntil,
            })),
    };
}
