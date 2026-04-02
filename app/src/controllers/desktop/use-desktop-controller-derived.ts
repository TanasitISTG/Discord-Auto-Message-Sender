import { useMemo } from 'react';
import type { ConfigDraftController } from '@/features/config/use-config-draft';
import type { DesktopSetupState, PreflightResult, SenderStateRecord, SessionSnapshot, SidecarStatus } from '@/lib/desktop';
import {
    deriveAppReadiness,
    deriveSetupChecklist,
    type AppReadiness,
    type ConfigReadinessStatus,
    type SetupChecklist
} from '@/shared/readiness';

interface UseDesktopControllerDerivedOptions {
    draft: ConfigDraftController;
    senderState: SenderStateRecord;
    session: SessionSnapshot | null;
    setup: DesktopSetupState | null;
    configStatus: ConfigReadinessStatus;
    configIssue: string | null;
    sidecarStatus: SidecarStatus;
    preflight: PreflightResult | null;
}

export function useDesktopControllerDerived({
    draft,
    senderState,
    session,
    setup,
    configStatus,
    configIssue,
    sidecarStatus,
    preflight
}: UseDesktopControllerDerivedOptions) {
    const groupedMetrics = useMemo(() => ({
        channelCount: draft.state.config.channels.length,
        groupCount: Object.keys(draft.state.config.messageGroups).length,
        messageCount: Object.values(draft.state.config.messageGroups).reduce((total, messages) => total + messages.length, 0)
    }), [draft.state.config]);

    const latestSummary = senderState.summaries[0] ?? senderState.lastSession?.summary;
    const hasActiveSession = Boolean(session && ['running', 'paused', 'stopping'].includes(session.status));
    const appReadiness = useMemo<AppReadiness>(() => deriveAppReadiness({
        setup,
        configStatus,
        configError: configIssue,
        sidecarStatus
    }), [setup, configStatus, configIssue, sidecarStatus]);
    const setupChecklist = useMemo<SetupChecklist>(() => deriveSetupChecklist({
        setup,
        config: draft.state.config,
        configStatus,
        validationErrors: draft.validationErrors,
        preflight
    }), [setup, draft.state.config, draft.validationErrors, configStatus, preflight]);
    const currentLogSessionId = session?.id ?? senderState.lastSession?.id ?? senderState.resumeSession?.sessionId ?? null;
    const startBlockingIssue = appReadiness.blockingIssues[0];

    return {
        groupedMetrics,
        latestSummary,
        hasActiveSession,
        appReadiness,
        setupChecklist,
        currentLogSessionId,
        startBlockingIssue
    };
}
