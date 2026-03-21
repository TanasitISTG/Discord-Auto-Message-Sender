import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
    AppConfig,
    ConfigLoadResult,
    DesktopCommandMap,
    DesktopCommandName,
    DesktopEvent,
    DryRunResult,
    LogLoadResult,
    LogEntry,
    PreflightResult,
    RuntimeOptions,
    SaveConfigResult,
    SenderStateRecord,
    SessionSnapshot
} from '../../../src/desktop/contracts';

export type {
    AppConfig,
    ConfigLoadResult,
    DesktopEvent,
    DryRunResult,
    LogLoadResult,
    LogEntry,
    PreflightResult,
    RuntimeOptions,
    SaveConfigResult,
    SenderStateRecord,
    SessionSnapshot
} from '../../../src/desktop/contracts';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function desktopInvoke<K extends DesktopCommandName>(
    command: K,
    request: DesktopCommandMap[K]['request']
): Promise<DesktopCommandMap[K]['response']> {
    if (!isTauri) {
        throw new Error('Tauri desktop APIs are unavailable in the browser dev preview.');
    }

    return invoke<DesktopCommandMap[K]['response']>(command, { request });
}

export async function loadConfig(): Promise<ConfigLoadResult> {
    return desktopInvoke('load_config', {});
}

export async function saveConfig(config: AppConfig): Promise<SaveConfigResult> {
    return desktopInvoke('save_config', { config });
}

export async function runPreflight(): Promise<PreflightResult> {
    return desktopInvoke('run_preflight', {});
}

export async function runDryRun(runtime: RuntimeOptions): Promise<DryRunResult> {
    return desktopInvoke('run_dry_run', { runtime });
}

export async function startSession(runtime: RuntimeOptions): Promise<SessionSnapshot> {
    return desktopInvoke('start_session', runtime);
}

export async function pauseSession(): Promise<SessionSnapshot | null> {
    return desktopInvoke('pause_session', {});
}

export async function resumeSession(): Promise<SessionSnapshot | null> {
    return desktopInvoke('resume_session', {});
}

export async function stopSession(): Promise<SessionSnapshot | null> {
    return desktopInvoke('stop_session', {});
}

export async function getSessionState(): Promise<SessionSnapshot | null> {
    return desktopInvoke('get_session_state', {});
}

export async function loadLogs(sessionId: string): Promise<LogLoadResult> {
    return desktopInvoke('load_logs', { sessionId });
}

export async function loadState(): Promise<SenderStateRecord> {
    return desktopInvoke('load_state', {});
}

export async function discardResumeSession(): Promise<SenderStateRecord> {
    return desktopInvoke('discard_resume_session', {});
}

export async function openLogFile(sessionId: string): Promise<string> {
    return desktopInvoke('open_log_file', { sessionId });
}

export async function subscribeToAppEvents(handler: (event: DesktopEvent) => void) {
    if (!isTauri) {
        return () => undefined;
    }

    const unlisten = await listen<DesktopEvent>('app-event', (event) => {
        handler(event.payload);
    });

    return () => {
        unlisten();
    };
}
