import {
    exportSupportBundle as exportSupportBundleCommand,
    loadReleaseDiagnostics,
    loadState,
    openDataDirectory,
    openLogsDirectory as openLogsDirectoryCommand,
    resetRuntimeState as resetRuntimeStateCommand
} from '@/lib/desktop';
import { showErrorToast, showInfoToast, showSuccessToast, showWarningToast } from '@/shared/toast';
import { copyTextToClipboard } from './helpers';
import type { SupportActionOptions } from './support-action-types';

export function createSupportRuntimeActions({
    session,
    releaseDiagnostics,
    setSupportBundle,
    setSenderState,
    setReleaseDiagnostics,
    setSidecarStatus,
    setSession,
    setLogs,
    setPreferredScreen,
    setNotice,
    requestConfirmation
}: SupportActionOptions) {
    return {
        async copyReleaseDiagnostics() {
            if (!releaseDiagnostics) {
                setNotice('Release diagnostics are still loading.');
                return false;
            }

            try {
                await copyTextToClipboard(JSON.stringify(releaseDiagnostics, null, 2));
                showSuccessToast('Release diagnostics copied.');
                return true;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                showErrorToast('Could not copy release diagnostics.');
                return false;
            }
        },
        async openDesktopDataDirectory() {
            try {
                const result = await openDataDirectory();
                showInfoToast('Opening data folder.');
                return result;
            } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error));
                return null;
            }
        },
        async openLogsDirectory() {
            try {
                const result = await openLogsDirectoryCommand();
                showInfoToast('Opening logs folder.');
                return result;
            } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error));
                return null;
            }
        },
        async exportSupportBundle() {
            try {
                const result = await exportSupportBundleCommand();
                setSupportBundle(result);
                setNotice(`Support bundle exported to ${result.path}`);
                showSuccessToast('Support bundle exported.');
                return result;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                showErrorToast('Support bundle export failed.');
                return null;
            }
        },
        async resetRuntimeState() {
            if (session && ['running', 'paused', 'stopping'].includes(session.status)) {
                setNotice('Stop the active session before resetting runtime state.');
                showWarningToast('Stop the active session before resetting runtime state.');
                return null;
            }

            requestConfirmation({
                title: 'Reset runtime state?',
                description: 'This deletes local session logs and .sender-state.json, but keeps config.json and the secure token store.',
                confirmLabel: 'Reset Runtime State',
                cancelLabel: 'Cancel',
                pendingLabel: 'Resetting...',
                tone: 'danger',
                onConfirm: async () => {
                    const result = await resetRuntimeStateCommand();
                    const [nextState, diagnostics] = await Promise.all([
                        loadState(),
                        loadReleaseDiagnostics().catch(() => null)
                    ]);
                    setSenderState(nextState);
                    setReleaseDiagnostics(diagnostics);
                    if (diagnostics) {
                        setSidecarStatus(diagnostics.sidecarStatus);
                    }
                    setSession(null);
                    setLogs([]);
                    setSupportBundle(null);
                    setPreferredScreen(null);
                    const message = `Runtime state reset. Deleted ${result.deletedLogFiles} log file${result.deletedLogFiles === 1 ? '' : 's'}.`;
                    setNotice(message);
                    showSuccessToast(message);
                }
            });
            return null;
        }
    };
}
