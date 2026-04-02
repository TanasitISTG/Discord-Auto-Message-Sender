import { useEffect, useEffectEvent } from 'react';
import { useConfigDraft } from '@/features/config/use-config-draft';
import { emptyConfig, toneFromStatus } from './helpers';
import { useBootstrap } from './use-bootstrap';
import { useConfigActions } from './use-config-actions';
import { useConfirmationFlow } from './use-confirmation-flow';
import { useDesktopControllerDerived } from './use-desktop-controller-derived';
import { useDesktopControllerState } from './use-desktop-controller-state';
import { useDesktopEvents } from './use-desktop-events';
import { useSessionActions } from './use-session-actions';
import { useSupportActions } from './use-support-actions';
import { useSurfaceNotices } from './use-surface-notices';

export function useDesktopController() {
    const draft = useConfigDraft(emptyConfig);
    const state = useDesktopControllerState();
    const { surfaceNotices, setSurfaceNotice } = useSurfaceNotices();
    const confirmation = useConfirmationFlow();
    const bootstrap = useBootstrap({
        draft,
        setSession: state.setSession,
        setSenderState: state.setSenderState,
        setSetup: state.setSetup,
        setInboxMonitorSettings: state.setInboxMonitorSettings,
        setInboxMonitorState: state.setInboxMonitorState,
        setNotificationDelivery: state.setNotificationDelivery,
        setReleaseDiagnostics: state.setReleaseDiagnostics,
        setSupportBundle: state.setSupportBundle,
        setPreflight: state.setPreflight,
        setDryRun: state.setDryRun,
        setLogs: state.setLogs,
        setConfigStatus: state.setConfigStatus,
        setConfigIssue: state.setConfigIssue,
        setSidecarStatus: state.setSidecarStatus,
        setSidecarMessage: state.setSidecarMessage,
        setRecoveryState: state.setRecoveryState,
        setEnvironmentDraft: state.setEnvironmentDraft,
        setPreferredScreen: state.setPreferredScreen,
        setRuntime: state.setRuntime,
        setNotice: state.setNotice,
    });

    const handleDraftError = useEffectEvent((message: string) => {
        state.setNotice(message);
        draft.clearError();
    });

    useEffect(() => {
        if (draft.error) {
            handleDraftError(draft.error);
        }
    }, [draft.error]);

    useDesktopEvents({
        sessionRef: state.sessionRef,
        setSession: state.setSession,
        setLogs: state.setLogs,
        setPreflight: state.setPreflight,
        setDryRun: state.setDryRun,
        setInboxMonitorState: state.setInboxMonitorState,
        setNotificationDelivery: state.setNotificationDelivery,
        setSidecarStatus: state.setSidecarStatus,
        setSidecarMessage: state.setSidecarMessage,
        setRecoveryState: state.setRecoveryState,
        setPreferredScreen: state.setPreferredScreen,
        setNotice: state.setNotice,
        setSurfaceNotice,
        refreshAll: bootstrap.refreshAll,
        refreshState: bootstrap.refreshState,
    });

    const derived = useDesktopControllerDerived({
        draft,
        senderState: state.senderState,
        session: state.session,
        setup: state.setup,
        configStatus: state.configStatus,
        configIssue: state.configIssue,
        sidecarStatus: state.sidecarStatus,
        preflight: state.preflight,
    });

    const configActions = useConfigActions({
        draft,
        runtime: state.runtime,
        environmentDraft: state.environmentDraft,
        session: state.session,
        setSetup: state.setSetup,
        setReleaseDiagnostics: state.setReleaseDiagnostics,
        setSidecarStatus: state.setSidecarStatus,
        setInboxMonitorState: state.setInboxMonitorState,
        setEnvironmentDraft: state.setEnvironmentDraft,
        setNotice: state.setNotice,
        setConfigStatus: state.setConfigStatus,
        setConfigIssue: state.setConfigIssue,
        setSurfaceNotice,
        refreshState: bootstrap.refreshState,
        requestConfirmation: confirmation.requestConfirmation,
    });

    const sessionActions = useSessionActions({
        draft,
        runtime: state.runtime,
        session: state.session,
        sessionRef: state.sessionRef,
        senderState: state.senderState,
        currentLogSessionId: derived.currentLogSessionId,
        startBlockingIssue: derived.startBlockingIssue,
        setSession: state.setSession,
        setSenderState: state.setSenderState,
        setPreflight: state.setPreflight,
        setDryRun: state.setDryRun,
        setLogs: state.setLogs,
        setNotice: state.setNotice,
        setRecoveryState: state.setRecoveryState,
        setSurfaceNotice,
        requestConfirmation: confirmation.requestConfirmation,
    });

    const supportActions = useSupportActions({
        session: state.session,
        releaseDiagnostics: state.releaseDiagnostics,
        setInboxMonitorSettings: state.setInboxMonitorSettings,
        setInboxMonitorState: state.setInboxMonitorState,
        setNotificationDelivery: state.setNotificationDelivery,
        setSupportBundle: state.setSupportBundle,
        setSenderState: state.setSenderState,
        setReleaseDiagnostics: state.setReleaseDiagnostics,
        setSidecarStatus: state.setSidecarStatus,
        setSession: state.setSession,
        setLogs: state.setLogs,
        setPreferredScreen: state.setPreferredScreen,
        setNotice: state.setNotice,
        requestConfirmation: confirmation.requestConfirmation,
    });

    return {
        draft,
        session: state.session,
        senderState: state.senderState,
        preflight: state.preflight,
        dryRun: state.dryRun,
        logs: state.logs,
        setup: state.setup,
        inboxMonitorSettings: state.inboxMonitorSettings,
        inboxMonitorState: state.inboxMonitorState,
        notificationDelivery: state.notificationDelivery,
        releaseDiagnostics: state.releaseDiagnostics,
        supportBundle: state.supportBundle,
        configStatus: state.configStatus,
        sidecarStatus: state.sidecarStatus,
        sidecarMessage: state.sidecarMessage,
        recoveryState: state.recoveryState,
        appReadiness: derived.appReadiness,
        setupChecklist: derived.setupChecklist,
        environmentDraft: state.environmentDraft,
        notice: state.notice,
        runtime: state.runtime,
        groupedMetrics: derived.groupedMetrics,
        latestSummary: derived.latestSummary,
        hasActiveSession: derived.hasActiveSession,
        currentLogSessionId: derived.currentLogSessionId,
        surfaceNotices,
        preferredScreen: state.preferredScreen,
        setNotice: state.setNotice,
        setRuntime: state.setRuntime,
        setEnvironmentDraft: state.setEnvironmentDraft,
        setPreferredScreen: state.setPreferredScreen,
        ...configActions,
        ...sessionActions,
        ...supportActions,
        confirmDialog: {
            open: confirmation.confirmDialog.open,
            title: confirmation.confirmDialog.title,
            description: confirmation.confirmDialog.description,
            confirmLabel: confirmation.confirmDialog.confirmLabel,
            cancelLabel: confirmation.confirmDialog.cancelLabel,
            pendingLabel: confirmation.confirmDialog.pendingLabel,
            tone: confirmation.confirmDialog.tone,
        },
        confirmDialogPending: confirmation.confirmDialogPending,
        closeConfirmation: confirmation.closeConfirmation,
        confirmCurrentDialog: confirmation.confirmCurrentDialog,
    };
}

export type DesktopController = ReturnType<typeof useDesktopController>;
export { toneFromStatus };
