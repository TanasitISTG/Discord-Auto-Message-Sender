import {
    discardResumeSession,
    pauseSession,
    resumeSession,
    runDryRun,
    runPreflight,
    startSession,
    stopSession
} from '@/lib/desktop';
import { describeBlockingIssue } from '@/shared/readiness';
import { showInfoToast, showSuccessToast, showWarningToast } from '@/shared/toast';
import type { SessionActionOptions } from './session-action-types';

export function createSessionLifecycleActions({
    draft,
    runtime,
    session,
    sessionRef,
    senderState,
    startBlockingIssue,
    setSession,
    setSenderState,
    setPreflight,
    setDryRun,
    setNotice,
    setRecoveryState,
    setSurfaceNotice,
    requestConfirmation
}: SessionActionOptions) {
    return {
        async runPreflightCommand() {
            try {
                const result = await runPreflight();
                setPreflight(result);
                setNotice(result.ok ? 'Preflight passed.' : 'Preflight reported issues.');
                setSurfaceNotice('session', result.ok ? 'success' : 'warning', result.ok ? 'Preflight passed.' : 'Preflight reported issues.');
                if (result.ok) {
                    showSuccessToast('Preflight passed.');
                } else {
                    showWarningToast('Preflight reported issues.');
                }
                return result;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                setSurfaceNotice('session', 'danger', message);
                return null;
            }
        },
        async runDryRunCommand() {
            try {
                const result = await runDryRun(runtime);
                setDryRun(result);
                setNotice(result.willSendMessages ? 'Dry run generated. No messages were sent.' : 'Dry run found no sendable channels.');
                return result;
            } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error));
                return null;
            }
        },
        async startSessionCommand() {
            if (draft.validationErrors.length > 0) {
                setNotice(draft.validationErrors[0]);
                setSurfaceNotice('session', 'danger', draft.validationErrors[0]);
                return null;
            }

            if (startBlockingIssue) {
                const message = describeBlockingIssue(startBlockingIssue);
                setNotice(message);
                setSurfaceNotice('session', 'warning', message);
                return null;
            }

            try {
                const nextState = await startSession(runtime);
                setSession(nextState);
                setRecoveryState(null);
                const message = nextState.resumedFromCheckpoint ? 'Session resumed from the saved checkpoint.' : 'Session started from the desktop shell.';
                setNotice(message);
                setSurfaceNotice('session', 'success', message);
                showSuccessToast(nextState.resumedFromCheckpoint ? 'Session resumed from checkpoint.' : 'Session started.');
                return nextState;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                setSurfaceNotice('session', 'danger', message);
                return null;
            }
        },
        async togglePauseResume() {
            if (!session) {
                return null;
            }

            try {
                const nextState = session.status === 'paused'
                    ? await resumeSession()
                    : await pauseSession();
                if (nextState) {
                    setSession(nextState);
                    setSurfaceNotice('session', 'neutral', nextState.status === 'paused' ? 'Session paused.' : 'Session resumed.');
                    showInfoToast(nextState.status === 'paused' ? 'Session paused.' : 'Session resumed.');
                }
                return nextState;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                setSurfaceNotice('session', 'danger', message);
                return null;
            }
        },
        async stopCurrentSession() {
            if (!session || ['completed', 'failed', 'stopped'].includes(session.status)) {
                showInfoToast('No active session to stop.');
                return null;
            }

            requestConfirmation({
                title: 'Stop active session?',
                description: 'The session will stop after the current send finishes. Progress and checkpoint state remain available locally.',
                confirmLabel: 'Stop Session',
                cancelLabel: 'Cancel',
                pendingLabel: 'Stopping...',
                tone: 'warning',
                onConfirm: async () => {
                    if (!sessionRef.current || ['completed', 'failed', 'stopped'].includes(sessionRef.current.status)) {
                        setSurfaceNotice('session', 'warning', 'No active session to stop.');
                        showInfoToast('No active session to stop.');
                        return;
                    }

                    const nextState = await stopSession();
                    setSession(nextState);
                    setNotice('Stopping the active session after the current send finishes.');
                    setSurfaceNotice('session', 'warning', 'Stopping after the current send finishes.');
                    showWarningToast('Stopping after the current send finishes.');
                }
            });
            return null;
        },
        async discardResumeCheckpoint() {
            if (session && ['running', 'paused', 'stopping'].includes(session.status)) {
                setNotice('Stop the active session before discarding the saved checkpoint.');
                setSurfaceNotice('session', 'warning', 'Stop the active session before discarding the saved checkpoint.');
                showWarningToast('Stop the active session before discarding the checkpoint.');
                return null;
            }

            if (!senderState.resumeSession) {
                setNotice('No saved checkpoint is available.');
                setSurfaceNotice('session', 'warning', 'No saved checkpoint is available.');
                showInfoToast('No saved checkpoint is available.');
                return null;
            }

            requestConfirmation({
                title: 'Discard saved checkpoint?',
                description: 'This removes the saved resume point and cannot be undone.',
                confirmLabel: 'Discard Checkpoint',
                cancelLabel: 'Cancel',
                pendingLabel: 'Discarding...',
                tone: 'danger',
                onConfirm: async () => {
                    const nextState = await discardResumeSession();
                    setSenderState(nextState);
                    setRecoveryState(null);
                    setNotice('Saved checkpoint discarded.');
                    setSurfaceNotice('session', 'success', 'Checkpoint discarded.');
                    showSuccessToast('Checkpoint discarded.');
                }
            });
            return null;
        }
    };
}
