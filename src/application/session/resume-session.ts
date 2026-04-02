import type { AppConfig, RuntimeOptions, SessionState } from '../../types';
import {
    buildChannelHealth,
    buildChannelProgress,
    createInitialPacing,
    type ResumeSessionRecord,
    type SessionSegment,
} from './session-state-machine';

function canonicalizeConfigValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => (item === undefined ? null : canonicalizeConfigValue(item)));
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .filter(([, entryValue]) => entryValue !== undefined)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, entryValue]) => [key, canonicalizeConfigValue(entryValue)]),
        );
    }

    return value;
}

export function createSessionConfigSignature(config: AppConfig): string {
    return JSON.stringify(canonicalizeConfigValue(config));
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
