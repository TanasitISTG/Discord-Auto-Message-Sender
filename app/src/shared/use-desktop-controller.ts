import { useEffect, useMemo, useRef, useState } from 'react';
import { writeText as writeClipboardText } from '@tauri-apps/plugin-clipboard-manager';
import {
    clearSecureToken as clearSecureTokenCommand,
    ConfigLoadResult,
    DesktopEvent,
    DesktopSetupState,
    DryRunResult,
    exportSupportBundle as exportSupportBundleCommand,
    LogEntry,
    PreflightResult,
    ReleaseDiagnostics,
    SenderStateRecord,
    SidecarStatus,
    SupportBundleResult,
    SessionSnapshot,
    getSessionState,
    loadConfig,
    loadLogs,
    loadReleaseDiagnostics,
    loadSetupState,
    loadState,
    discardResumeSession,
    openDataDirectory,
    openLogsDirectory as openLogsDirectoryCommand,
    openLogFile,
    pauseSession,
    resetRuntimeState as resetRuntimeStateCommand,
    resumeSession,
    runDryRun,
    runPreflight,
    saveEnvironment,
    saveConfig,
    startSession,
    stopSession,
    subscribeToAppEvents
} from '@/lib/desktop';
import type { AppConfig, RuntimeOptions } from '@/lib/desktop';
import { useConfigDraft } from '@/features/config/use-config-draft';
import {
    AppReadiness,
    ConfigReadinessStatus,
    deriveAppReadiness,
    deriveSetupChecklist,
    describeBlockingIssue,
    SetupChecklist
} from '@/shared/readiness';

export type SurfaceNoticeScope = 'config' | 'session' | 'logs';
export type SurfaceNoticeTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface SurfaceNotice {
    tone: SurfaceNoticeTone;
    message: string;
}

export interface RecoveryState {
    interruptedAt: string;
    message: string;
}

async function copyTextToClipboard(text: string) {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        await writeClipboardText(text);
        return;
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    throw new Error('Clipboard access is unavailable in this environment.');
}

const emptyConfig: AppConfig = {
    userAgent: '',
    channels: [],
    messageGroups: {
        default: ['Hello!']
    }
};

function mergeLogsById(entries: LogEntry[], limit: number = 500): LogEntry[] {
    const seen = new Set<string>();
    const merged: LogEntry[] = [];

    for (const entry of entries) {
        if (seen.has(entry.id)) {
            continue;
        }

        seen.add(entry.id);
        merged.push(entry);

        if (merged.length >= limit) {
            break;
        }
    }

    return merged;
}

export function toneFromStatus(status?: SessionSnapshot['status']) {
    switch (status) {
        case 'running':
            return 'success';
        case 'paused':
            return 'warning';
        case 'failed':
            return 'danger';
        case 'completed':
            return 'success';
        default:
            return 'neutral';
    }
}

export function useDesktopController() {
    const draft = useConfigDraft(emptyConfig);
    const [session, setSession] = useState<SessionSnapshot | null>(null);
    const [senderState, setSenderState] = useState<SenderStateRecord>({ schemaVersion: 1, summaries: [], recentFailures: [], recentMessageHistory: {}, channelHealth: {} });
    const [preflight, setPreflight] = useState<PreflightResult | null>(null);
    const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [setup, setSetup] = useState<DesktopSetupState | null>(null);
    const [releaseDiagnostics, setReleaseDiagnostics] = useState<ReleaseDiagnostics | null>(null);
    const [supportBundle, setSupportBundle] = useState<SupportBundleResult | null>(null);
    const [configStatus, setConfigStatus] = useState<ConfigReadinessStatus>('loading');
    const [configIssue, setConfigIssue] = useState<string | null>(null);
    const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus>('connecting');
    const [sidecarMessage, setSidecarMessage] = useState<string | null>(null);
    const [recoveryState, setRecoveryState] = useState<RecoveryState | null>(null);
    const [surfaceNotices, setSurfaceNotices] = useState<Partial<Record<SurfaceNoticeScope, SurfaceNotice>>>({});
    const [environmentDraft, setEnvironmentDraft] = useState('');
    const [notice, setNotice] = useState('Loading desktop state...');
    const [preferredScreen, setPreferredScreen] = useState<'session' | 'preview' | null>(null);
    const [runtime, setRuntime] = useState<RuntimeOptions>({
        numMessages: 0,
        baseWaitSeconds: 5,
        marginSeconds: 2
    });
    const sessionRef = useRef<SessionSnapshot | null>(null);

    useEffect(() => {
        sessionRef.current = session;
    }, [session]);

    useEffect(() => {
        if (draft.error) {
            setNotice(draft.error);
            draft.clearError();
        }
    }, [draft.error]);

    useEffect(() => {
        void refreshAll();

        let active = true;
        let cleanup = () => {};
        void (async () => {
            const unsubscribe = await subscribeToAppEvents((event) => {
                handleDesktopEvent(event);
            });
            if (!active) {
                unsubscribe();
                return;
            }
            cleanup = unsubscribe;
        })();

        return () => {
            active = false;
            cleanup();
        };
    }, []);

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

    function setSurfaceNotice(scope: SurfaceNoticeScope, tone: SurfaceNoticeTone, message: string) {
        setSurfaceNotices((previous) => ({
            ...previous,
            [scope]: {
                tone,
                message
            }
        }));
    }

    async function refreshAll() {
        try {
            const [configResult, activeSession, persistedState, setupState, diagnostics] = await Promise.all([
                loadConfig(),
                getSessionState(),
                loadState(),
                loadSetupState(),
                loadReleaseDiagnostics().catch(() => null)
            ]);

            applyConfigResult(configResult);
            setSession(activeSession);
            setSenderState(persistedState);
            setSetup(setupState);
            if (diagnostics) {
                setReleaseDiagnostics(diagnostics);
                setSidecarStatus(diagnostics.sidecarStatus);
                if (diagnostics.sidecarStatus === 'ready') {
                    setSidecarMessage(null);
                }
            }
            setEnvironmentDraft('');
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

    async function refreshState() {
        try {
            setSenderState(await loadState());
        } catch {
            // Keep the UI responsive even if state refresh is transiently unavailable.
        }
    }

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

    function handleDesktopEvent(event: DesktopEvent) {
        switch (event.type) {
            case 'session_started':
            case 'session_paused':
            case 'session_resumed':
            case 'session_stopping':
            case 'channel_state_changed':
            case 'session_state_updated':
            case 'summary_ready':
                setSession(event.state);
                if (event.type === 'session_started' || event.type === 'summary_ready') {
                    setRecoveryState(null);
                }
                void refreshState();
                return;
            case 'log_event_emitted':
                setLogs((previous) => mergeLogsById([event.entry, ...previous]));
                return;
            case 'preflight_result_emitted':
                setPreflight(event.result);
                setPreferredScreen('session');
                return;
            case 'dry_run_ready':
                setDryRun(event.result);
                setPreferredScreen('preview');
                return;
            case 'close_blocked':
                setSession(event.state);
                setNotice(event.message);
                setPreferredScreen('session');
                return;
            case 'sidecar_error':
                setSidecarStatus(event.status);
                setSidecarMessage(event.message);
                if (sessionRef.current && ['running', 'paused', 'stopping'].includes(sessionRef.current.status)) {
                    setRecoveryState({
                        interruptedAt: new Date().toISOString(),
                        message: event.message
                    });
                    setSession(null);
                    setPreferredScreen('session');
                    setNotice('The desktop runtime was interrupted while a session was active. Review the saved checkpoint before resuming.');
                    setSurfaceNotice('session', 'warning', 'Runtime interrupted while a session was active. Review the saved checkpoint before resuming.');
                    void refreshState();
                } else {
                    setNotice(event.message);
                }
                return;
            case 'sidecar_ready':
                setSidecarStatus('ready');
                setSidecarMessage(null);
                void refreshAll();
                setNotice('Desktop runtime connected.');
                return;
            default:
                return;
        }
    }

    return {
        draft,
        session,
        senderState,
        preflight,
        dryRun,
        logs,
        setup,
        releaseDiagnostics,
        supportBundle,
        configStatus,
        sidecarStatus,
        sidecarMessage,
        recoveryState,
        appReadiness,
        setupChecklist,
        environmentDraft,
        notice,
        runtime,
        groupedMetrics,
        latestSummary,
        hasActiveSession,
        currentLogSessionId,
        surfaceNotices,
        preferredScreen,
        setNotice,
        setRuntime,
        setEnvironmentDraft,
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
                await refreshState();
                return true;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                setSurfaceNotice('config', 'danger', message);
                return false;
            }
        },
        async runPreflightCommand() {
            try {
                const result = await runPreflight();
                setPreflight(result);
                setNotice(result.ok ? 'Preflight passed.' : 'Preflight reported issues.');
                setSurfaceNotice('session', result.ok ? 'success' : 'warning', result.ok ? 'Preflight passed.' : 'Preflight reported issues.');
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
            if (!session || ['completed', 'failed'].includes(session.status)) {
                return null;
            }

            if (!window.confirm('Stop the active session after the current send finishes?')) {
                return null;
            }

            try {
                const nextState = await stopSession();
                setSession(nextState);
                setNotice('Stopping the active session after the current send finishes.');
                setSurfaceNotice('session', 'warning', 'Stopping after the current send finishes.');
                return nextState;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                setSurfaceNotice('session', 'danger', message);
                return null;
            }
        },
        async discardResumeCheckpoint() {
            if (session && ['running', 'paused', 'stopping'].includes(session.status)) {
                setNotice('Stop the active session before discarding the saved checkpoint.');
                setSurfaceNotice('session', 'warning', 'Stop the active session before discarding the saved checkpoint.');
                return null;
            }

            if (!senderState.resumeSession) {
                setNotice('No saved checkpoint is available.');
                setSurfaceNotice('session', 'warning', 'No saved checkpoint is available.');
                return null;
            }

            if (!window.confirm('Discard the saved resume checkpoint? This cannot be undone.')) {
                return null;
            }

            try {
                const nextState = await discardResumeSession();
                setSenderState(nextState);
                setRecoveryState(null);
                setNotice('Saved checkpoint discarded.');
                setSurfaceNotice('session', 'success', 'Checkpoint discarded.');
                return nextState;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                setSurfaceNotice('session', 'danger', message);
                return null;
            }
        },
        async loadCurrentLogs() {
            const sessionId = currentLogSessionId;
            if (!sessionId) {
                setNotice('Start a session before loading log output.');
                setSurfaceNotice('logs', 'warning', 'Start or resume a session before loading log output.');
                return null;
            }

            try {
                const result = await loadLogs(sessionId);
                setLogs(mergeLogsById(result.entries.slice().reverse()));
                if (result.warnings && result.warnings.length > 0) {
                    setSurfaceNotice('logs', 'warning', 'Some log lines were skipped because they were invalid or incomplete.');
                } else {
                    setSurfaceNotice('logs', 'success', `Loaded ${result.entries.length} log entr${result.entries.length === 1 ? 'y' : 'ies'} from disk.`);
                }
                return result;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                setSurfaceNotice('logs', 'danger', message);
                return null;
            }
        },
        async openCurrentLogFile() {
            const sessionId = currentLogSessionId;
            if (!sessionId) {
                setNotice('No session log is available yet.');
                setSurfaceNotice('logs', 'warning', 'No session log is available yet.');
                return null;
            }

            try {
                const result = await openLogFile(sessionId);
                setNotice(`Opening ${result}`);
                setSurfaceNotice('logs', 'neutral', `Opening ${result}`);
                return result;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                setSurfaceNotice('logs', 'danger', message);
                return null;
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
                setNotice('Discord token saved securely for this Windows user profile.');
                setSurfaceNotice('config', 'success', 'Discord token saved securely for this Windows user.');
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

            if (!window.confirm('Remove the securely stored Discord token? Future preflight and session starts will require a new token.')) {
                return null;
            }

            try {
                const nextSetup = await clearSecureTokenCommand();
                setSetup(nextSetup);
                setEnvironmentDraft('');
                const diagnostics = await loadReleaseDiagnostics().catch(() => null);
                if (diagnostics) {
                    setReleaseDiagnostics(diagnostics);
                    setSidecarStatus(diagnostics.sidecarStatus);
                }
                setNotice('Secure Discord token removed from this Windows profile.');
                setSurfaceNotice('config', 'warning', 'Secure Discord token removed from this Windows user.');
                return nextSetup;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                setSurfaceNotice('config', 'danger', message);
                return null;
            }
        },
        async copyReleaseDiagnostics() {
            if (!releaseDiagnostics) {
                setNotice('Release diagnostics are still loading.');
                return false;
            }

            try {
                await copyTextToClipboard(JSON.stringify(releaseDiagnostics, null, 2));
                setNotice('Release diagnostics copied to the clipboard.');
                return true;
            } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error));
                return false;
            }
        },
        async openDesktopDataDirectory() {
            try {
                const result = await openDataDirectory();
                setNotice(`Opening ${result}`);
                return result;
            } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error));
                return null;
            }
        },
        async openLogsDirectory() {
            try {
                const result = await openLogsDirectoryCommand();
                setNotice(`Opening ${result}`);
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
                return result;
            } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error));
                return null;
            }
        },
        async resetRuntimeState() {
            if (session && ['running', 'paused', 'stopping'].includes(session.status)) {
                setNotice('Stop the active session before resetting runtime state.');
                return null;
            }

            if (!window.confirm('Reset local runtime state and delete session logs? This keeps config.json and the secure token store.')) {
                return null;
            }

            try {
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
                setNotice(`Runtime state reset. Deleted ${result.deletedLogFiles} log file${result.deletedLogFiles === 1 ? '' : 's'}.`);
                return result;
            } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error));
                return null;
            }
        }
    };
}
