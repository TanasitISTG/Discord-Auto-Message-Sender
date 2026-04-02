import { DesktopCommandMap, SidecarCommandName } from '../contracts';
import { DesktopRuntime } from '../runtime';
import { handleLoadConfig, handleSaveConfig } from './config';
import { handleRunDryRun, handleRunPreflight } from './preflight';
import {
    handleGetSessionState,
    handlePauseSession,
    handleResumeSession,
    handleStartSession,
    handleStopSession,
} from './session';
import {
    handleDiscardResumeSession,
    handleGetInboxMonitorState,
    handleLoadInboxMonitorSettings,
    handleLoadLogs,
    handleLoadState,
    handleSaveInboxMonitorSettings,
    handleStartInboxMonitor,
    handleStopInboxMonitor,
} from './state';

type Handler<K extends SidecarCommandName> = (
    runtime: DesktopRuntime,
    payload: DesktopCommandMap[K]['request'],
) => Promise<DesktopCommandMap[K]['response']>;

export function createDesktopHandlers() {
    const handlers: {
        [K in SidecarCommandName]: Handler<K>;
    } = {
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
        discard_resume_session: handleDiscardResumeSession,
        load_inbox_monitor_settings: handleLoadInboxMonitorSettings,
        save_inbox_monitor_settings: handleSaveInboxMonitorSettings,
        get_inbox_monitor_state: handleGetInboxMonitorState,
        start_inbox_monitor: handleStartInboxMonitor,
        stop_inbox_monitor: handleStopInboxMonitor,
    };

    return handlers;
}
