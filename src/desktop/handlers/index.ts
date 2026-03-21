import { DesktopCommandMap, DesktopCommandName } from '../contracts';
import { DesktopRuntime } from '../runtime';
import { handleLoadConfig, handleSaveConfig } from './config';
import { handleRunDryRun, handleRunPreflight } from './preflight';
import { handleGetSessionState, handlePauseSession, handleResumeSession, handleStartSession, handleStopSession } from './session';
import { handleDiscardResumeSession, handleLoadLogs, handleLoadState } from './state';

type Handler<K extends DesktopCommandName> = (
    runtime: DesktopRuntime,
    payload: DesktopCommandMap[K]['request']
) => Promise<DesktopCommandMap[K]['response']>;

export function createDesktopHandlers() {
    const handlers: { [K in Exclude<DesktopCommandName, 'open_log_file'>]: Handler<K> } = {
        load_config: handleLoadConfig,
        save_config: handleSaveConfig,
        run_preflight: handleRunPreflight,
        run_dry_run: handleRunDryRun,
        start_session: handleStartSession,
        pause_session: handlePauseSession,
        resume_session: handleResumeSession,
        stop_session: handleStopSession,
        get_session_state: handleGetSessionState,
        load_logs: handleLoadLogs,
        load_state: handleLoadState,
        discard_resume_session: handleDiscardResumeSession
    };

    return handlers;
}
