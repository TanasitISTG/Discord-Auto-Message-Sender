import {
    clearSecureToken as clearSecureTokenCommand,
    getInboxMonitorState,
    loadReleaseDiagnostics,
    saveConfig,
    saveEnvironment,
    type DesktopSetupState,
    type InboxMonitorState,
    type ReleaseDiagnostics,
    type RuntimeOptions,
    type SessionSnapshot,
    type SidecarStatus
} from '@/lib/desktop';
import type { ConfigDraftController } from '@/features/config/use-config-draft';
import { showSuccessToast, showWarningToast } from '@/shared/toast';
import type { ConfirmDialogRequest } from './types';

interface UseConfigActionsOptions {
    draft: ConfigDraftController;
    runtime: RuntimeOptions;
    environmentDraft: string;
    session: SessionSnapshot | null;
    setSetup(next: DesktopSetupState | null): void;
    setReleaseDiagnostics(next: ReleaseDiagnostics | null): void;
    setSidecarStatus(next: SidecarStatus): void;
    setInboxMonitorState(next: InboxMonitorState): void;
    setEnvironmentDraft(next: string): void;
    setNotice(next: string): void;
    setConfigStatus(next: 'loading' | 'ready' | 'missing' | 'invalid'): void;
    setConfigIssue(next: string | null): void;
    setSurfaceNotice(scope: 'config' | 'session' | 'logs', tone: 'neutral' | 'success' | 'warning' | 'danger', message: string): void;
    refreshState(): Promise<void>;
    requestConfirmation(request: Omit<ConfirmDialogRequest, 'open'>): void;
}

export function useConfigActions({
    draft,
    environmentDraft,
    session,
    setSetup,
    setReleaseDiagnostics,
    setSidecarStatus,
    setInboxMonitorState,
    setEnvironmentDraft,
    setNotice,
    setConfigStatus,
    setConfigIssue,
    setSurfaceNotice,
    refreshState,
    requestConfirmation
}: UseConfigActionsOptions) {
    return {
        async saveConfigDraft() {
            if (draft.validationErrors.length > 0) {
                setNotice(draft.validationErrors[0]);
                setSurfaceNotice('config', 'danger', draft.validationErrors[0]);
                return false;
            }

            try {
                const result = await saveConfig(draft.state.config);
                draft.hydrate(result.config);
                setConfigStatus('ready');
                setConfigIssue(null);
                setNotice('Configuration saved locally.');
                setSurfaceNotice('config', 'success', 'Config saved locally.');
                showSuccessToast('Config saved locally.');
                await refreshState();
                return true;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                setSurfaceNotice('config', 'danger', message);
                return false;
            }
        },
        async saveEnvironmentDraft() {
            if (!environmentDraft.trim()) {
                setNotice('DISCORD_TOKEN is required.');
                setSurfaceNotice('config', 'danger', 'Paste a Discord token before saving it securely.');
                return null;
            }

            try {
                const nextSetup = await saveEnvironment({
                    discordToken: environmentDraft
                });
                setSetup(nextSetup);
                const diagnostics = await loadReleaseDiagnostics().catch(() => null);
                if (diagnostics) {
                    setReleaseDiagnostics(diagnostics);
                    setSidecarStatus(diagnostics.sidecarStatus);
                }
                setEnvironmentDraft('');
                const nextMonitorState = await getInboxMonitorState().catch(() => null);
                if (nextMonitorState) {
                    setInboxMonitorState(nextMonitorState);
                }
                setNotice('Discord token saved securely for this Windows user profile.');
                setSurfaceNotice('config', 'success', 'Discord token saved securely for this Windows user.');
                showSuccessToast('Discord token saved securely.');
                return nextSetup;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                setSurfaceNotice('config', 'danger', message);
                return null;
            }
        },
        async clearSecureToken() {
            if (session && ['running', 'paused', 'stopping'].includes(session.status)) {
                setNotice('Removing the stored token does not stop the active session, but it only affects future starts.');
                setSurfaceNotice('config', 'warning', 'Removing the stored token only affects future starts.');
            }

            requestConfirmation({
                title: 'Remove stored Discord token?',
                description: 'Future preflight and session starts will require a new token. Active sessions are not stopped.',
                confirmLabel: 'Remove Token',
                cancelLabel: 'Cancel',
                pendingLabel: 'Removing...',
                tone: 'danger',
                onConfirm: async () => {
                    const nextSetup = await clearSecureTokenCommand();
                    setSetup(nextSetup);
                    setEnvironmentDraft('');
                    const diagnostics = await loadReleaseDiagnostics().catch(() => null);
                    if (diagnostics) {
                        setReleaseDiagnostics(diagnostics);
                        setSidecarStatus(diagnostics.sidecarStatus);
                    }
                    const nextMonitorState = await getInboxMonitorState().catch(() => null);
                    if (nextMonitorState) {
                        setInboxMonitorState(nextMonitorState);
                    }
                    setNotice('Secure Discord token removed from this Windows profile.');
                    setSurfaceNotice('config', 'warning', 'Secure Discord token removed from this Windows user.');
                    showWarningToast('Secure token removed.');
                }
            });
            return null;
        }
    };
}
