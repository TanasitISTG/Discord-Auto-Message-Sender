import type { Dispatch, SetStateAction } from 'react';
import {
    type ConfigLoadResult,
    type DesktopSetupState,
    type DryRunResult,
    type InboxMonitorSettings,
    type InboxMonitorState,
    type LogEntry,
    type NotificationDeliverySnapshot,
    type PreflightResult,
    type ReleaseDiagnostics,
    type RuntimeOptions,
    type SenderStateRecord,
    type SessionSnapshot,
    type SidecarStatus,
    type SupportBundleResult,
    getInboxMonitorState,
    getNotificationDeliveryState,
    getSessionState,
    loadConfig,
    loadInboxMonitorSettings,
    loadNotificationDeliverySettings,
    loadReleaseDiagnostics,
    loadSetupState,
    loadState,
} from '@/lib/desktop';
import type { ConfigDraftController } from '@/features/config/use-config-draft';
import type { ConfigReadinessStatus } from '@/shared/readiness';
import { defaultInboxMonitorSettings, defaultInboxMonitorState, defaultNotificationDeliverySnapshot } from './helpers';
import type { PreferredScreen, RecoveryState } from './types';

interface UseBootstrapOptions {
    draft: ConfigDraftController;
    setSession: Dispatch<SetStateAction<SessionSnapshot | null>>;
    setSenderState: Dispatch<SetStateAction<SenderStateRecord>>;
    setSetup: Dispatch<SetStateAction<DesktopSetupState | null>>;
    setInboxMonitorSettings: Dispatch<SetStateAction<InboxMonitorSettings>>;
    setInboxMonitorState: Dispatch<SetStateAction<InboxMonitorState>>;
    setNotificationDelivery: Dispatch<SetStateAction<NotificationDeliverySnapshot>>;
    setReleaseDiagnostics: Dispatch<SetStateAction<ReleaseDiagnostics | null>>;
    setSupportBundle: Dispatch<SetStateAction<SupportBundleResult | null>>;
    setPreflight: Dispatch<SetStateAction<PreflightResult | null>>;
    setDryRun: Dispatch<SetStateAction<DryRunResult | null>>;
    setLogs: Dispatch<SetStateAction<LogEntry[]>>;
    setConfigStatus: Dispatch<SetStateAction<ConfigReadinessStatus>>;
    setConfigIssue: Dispatch<SetStateAction<string | null>>;
    setSidecarStatus: Dispatch<SetStateAction<SidecarStatus>>;
    setSidecarMessage: Dispatch<SetStateAction<string | null>>;
    setRecoveryState: Dispatch<SetStateAction<RecoveryState | null>>;
    setEnvironmentDraft: Dispatch<SetStateAction<string>>;
    setPreferredScreen: Dispatch<SetStateAction<PreferredScreen>>;
    setRuntime: Dispatch<SetStateAction<RuntimeOptions>>;
    setNotice: Dispatch<SetStateAction<string>>;
}

export function useBootstrap({
    draft,
    setSession,
    setSenderState,
    setSetup,
    setInboxMonitorSettings,
    setInboxMonitorState,
    setNotificationDelivery,
    setReleaseDiagnostics,
    setSupportBundle,
    setPreflight,
    setDryRun,
    setLogs,
    setConfigStatus,
    setConfigIssue,
    setSidecarStatus,
    setSidecarMessage,
    setRecoveryState,
    setEnvironmentDraft,
    setPreferredScreen,
    setRuntime,
    setNotice,
}: UseBootstrapOptions) {
    function applyConfigResult(configResult: ConfigLoadResult) {
        if (configResult.kind === 'ok') {
            setConfigStatus('ready');
            setConfigIssue(null);
            draft.hydrate(configResult.config);
        } else if (configResult.kind === 'missing') {
            setConfigStatus('missing');
            setConfigIssue('No config.json found yet. Start building the config in the editor.');
        } else {
            setConfigStatus('invalid');
            setConfigIssue(configResult.error);
        }
    }

    async function refreshState() {
        try {
            setSenderState(await loadState());
        } catch {
            // Keep the UI responsive even if state refresh is transiently unavailable.
        }
    }

    async function refreshAll() {
        try {
            const [
                configResult,
                activeSession,
                persistedState,
                setupState,
                monitorSettings,
                monitorState,
                deliveryState,
                diagnostics,
            ] = await Promise.all([
                loadConfig(),
                getSessionState(),
                loadState(),
                loadSetupState(),
                loadInboxMonitorSettings().catch(() => defaultInboxMonitorSettings),
                getInboxMonitorState().catch(() => defaultInboxMonitorState),
                Promise.all([
                    loadNotificationDeliverySettings().catch(() => defaultNotificationDeliverySnapshot.settings),
                    getNotificationDeliveryState().catch(() => defaultNotificationDeliverySnapshot),
                ]).then(([settings, snapshot]) => ({
                    ...snapshot,
                    settings,
                })),
                loadReleaseDiagnostics().catch(() => null),
            ]);

            applyConfigResult(configResult);
            setSession(activeSession);
            setSenderState(persistedState);
            setSetup(setupState);
            setInboxMonitorSettings(monitorSettings);
            setInboxMonitorState(monitorState);
            setNotificationDelivery(deliveryState);
            if (diagnostics) {
                setReleaseDiagnostics(diagnostics);
                setSidecarStatus(diagnostics.sidecarStatus);
                if (diagnostics.sidecarStatus === 'ready') {
                    setSidecarMessage(null);
                }
            }
            setSupportBundle(null);
            setPreflight(null);
            setDryRun(null);
            setLogs([]);
            setEnvironmentDraft('');
            setPreferredScreen(null);
            if (!activeSession && persistedState.resumeSession) {
                setRuntime(persistedState.resumeSession.runtime);
            }
            if (!activeSession && !persistedState.resumeSession) {
                setRecoveryState(null);
            }
            if (setupState.warning) {
                setNotice(setupState.warning);
            } else if (persistedState.warning) {
                setNotice(persistedState.warning);
            } else if (diagnostics?.sidecarStatus === 'ready') {
                setNotice('Desktop shell connected.');
            }
        } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error));
        }
    }

    return {
        applyConfigResult,
        refreshAll,
        refreshState,
    };
}
