import { useEffect, useMemo, useState } from 'react';
import {
    ConfigLoadResult,
    DesktopEvent,
    DryRunResult,
    LogEntry,
    PreflightResult,
    SenderStateRecord,
    SessionSnapshot,
    getSessionState,
    loadConfig,
    loadLogs,
    loadState,
    openLogFile,
    pauseSession,
    resumeSession,
    runDryRun,
    runPreflight,
    saveConfig,
    startSession,
    stopSession,
    subscribeToAppEvents
} from '@/lib/desktop';
import type { AppConfig, RuntimeOptions } from '@/lib/desktop';
import { useConfigDraft } from '@/features/config/use-config-draft';

const emptyConfig: AppConfig = {
    userAgent: '',
    channels: [],
    messageGroups: {
        default: ['Hello!']
    }
};

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
    const [senderState, setSenderState] = useState<SenderStateRecord>({ summaries: [], recentFailures: [], recentMessageHistory: {} });
    const [preflight, setPreflight] = useState<PreflightResult | null>(null);
    const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [notice, setNotice] = useState('Loading desktop state...');
    const [preferredScreen, setPreferredScreen] = useState<'session' | 'preview' | null>(null);
    const [runtime, setRuntime] = useState<RuntimeOptions>({
        numMessages: 0,
        baseWaitSeconds: 5,
        marginSeconds: 2
    });

    useEffect(() => {
        if (draft.error) {
            setNotice(draft.error);
            draft.clearError();
        }
    }, [draft.error]);

    useEffect(() => {
        void refreshAll();

        let cleanup = () => {};
        void (async () => {
            const unsubscribe = await subscribeToAppEvents((event) => {
                handleDesktopEvent(event);
            });
            cleanup = unsubscribe;
        })();

        return () => {
            cleanup();
        };
    }, []);

    const groupedMetrics = useMemo(() => ({
        channelCount: draft.state.config.channels.length,
        groupCount: Object.keys(draft.state.config.messageGroups).length,
        messageCount: Object.values(draft.state.config.messageGroups).reduce((total, messages) => total + messages.length, 0)
    }), [draft.state.config]);

    const latestSummary = senderState.summaries[0] ?? senderState.lastSession?.summary;

    async function refreshAll() {
        try {
            const [configResult, activeSession, persistedState] = await Promise.all([
                loadConfig(),
                getSessionState(),
                loadState()
            ]);

            applyConfigResult(configResult);
            setSession(activeSession);
            setSenderState(persistedState);
            if (persistedState.warning) {
                setNotice(persistedState.warning);
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
            draft.hydrate(configResult.config);
            setNotice('Desktop shell connected.');
        } else if (configResult.kind === 'missing') {
            setNotice('No config.json found yet. Start building the config in the editor.');
        } else {
            setNotice(configResult.error);
        }
    }

    function handleDesktopEvent(event: DesktopEvent) {
        switch (event.type) {
            case 'session_started':
            case 'session_paused':
            case 'session_resumed':
            case 'session_stopping':
            case 'channel_state_changed':
            case 'summary_ready':
                setSession(event.state);
                void refreshState();
                return;
            case 'log_event_emitted':
                setLogs((previous) => [event.entry, ...previous].slice(0, 500));
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
                setNotice(event.message);
                return;
            case 'sidecar_ready':
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
        notice,
        runtime,
        groupedMetrics,
        latestSummary,
        preferredScreen,
        setNotice,
        setRuntime,
        async saveConfigDraft() {
            if (draft.validationErrors.length > 0) {
                setNotice(draft.validationErrors[0]);
                return false;
            }

            try {
                const result = await saveConfig(draft.state.config);
                draft.hydrate(result.config);
                setNotice('Configuration saved locally.');
                await refreshState();
                return true;
            } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error));
                return false;
            }
        },
        async runPreflightCommand() {
            try {
                const result = await runPreflight();
                setPreflight(result);
                setNotice(result.ok ? 'Preflight passed.' : 'Preflight reported issues.');
                return result;
            } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error));
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
                return null;
            }

            try {
                const nextState = await startSession(runtime);
                setSession(nextState);
                setNotice('Session started from the desktop shell.');
                return nextState;
            } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error));
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
                }
                return nextState;
            } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error));
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
                return nextState;
            } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error));
                return null;
            }
        },
        async loadCurrentLogs() {
            const sessionId = session?.id ?? senderState.lastSession?.id;
            if (!sessionId) {
                setNotice('Start a session before loading log output.');
                return null;
            }

            try {
                const result = await loadLogs(sessionId);
                setLogs(result.entries.reverse());
                return result;
            } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error));
                return null;
            }
        },
        async openCurrentLogFile() {
            const sessionId = session?.id ?? senderState.lastSession?.id;
            if (!sessionId) {
                setNotice('No session log is available yet.');
                return null;
            }

            try {
                const result = await openLogFile(sessionId);
                setNotice(`Opening ${result}`);
                return result;
            } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error));
                return null;
            }
        }
    };
}
