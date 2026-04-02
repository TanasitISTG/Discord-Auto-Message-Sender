import type { AppConfig, RuntimeOptions, SessionState } from '../../types';
import {
    buildChannelHealth,
    buildChannelProgress,
    createInitialPacing,
    type ResumeSessionRecord,
    type SessionSegment,
} from './session-state-machine';

export function createSessionConfigSignature(config: AppConfig): string {
    return JSON.stringify(config);
}

export function canResumeSession(
    resumeSession: ResumeSessionRecord | undefined,
    config: AppConfig,
    runtime: RuntimeOptions,
): resumeSession is ResumeSessionRecord {
    if (!resumeSession) {
        return false;
    }

    if (!['running', 'paused', 'stopped'].includes(resumeSession.state.status)) {
        return false;
    }

    if (resumeSession.configSignature !== createSessionConfigSignature(config)) {
        return false;
    }

    return (
        resumeSession.runtime.numMessages === runtime.numMessages &&
        resumeSession.runtime.baseWaitSeconds === runtime.baseWaitSeconds &&
        resumeSession.runtime.marginSeconds === runtime.marginSeconds
    );
}

export function restoreStateFromResume(
    resumeSession: ResumeSessionRecord,
    config: AppConfig,
    segment: SessionSegment,
    persistedHealth?: SessionState['channelHealth'],
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
    restored.activeChannels = restored.activeChannels.filter(
        (channelId) => !(restored.completedChannels.includes(channelId) || restored.failedChannels.includes(channelId)),
    );
    return restored;
}

export type { ResumeSessionRecord } from './session-state-machine';
