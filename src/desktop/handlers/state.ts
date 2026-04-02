import { DesktopCommandMap } from '../contracts';
import { DesktopRuntime } from '../runtime';

export async function handleLoadLogs(
    runtime: DesktopRuntime,
    payload: DesktopCommandMap['load_logs']['request'],
): Promise<DesktopCommandMap['load_logs']['response']> {
    return runtime.loadLogs(payload);
}

export async function handleLoadState(
    runtime: DesktopRuntime,
    _payload: DesktopCommandMap['load_state']['request'],
): Promise<DesktopCommandMap['load_state']['response']> {
    return runtime.loadState();
}

export async function handleDiscardResumeSession(
    runtime: DesktopRuntime,
    _payload: DesktopCommandMap['discard_resume_session']['request'],
): Promise<DesktopCommandMap['discard_resume_session']['response']> {
    return runtime.discardResumeSession();
}

export async function handleLoadInboxMonitorSettings(
    runtime: DesktopRuntime,
    _payload: DesktopCommandMap['load_inbox_monitor_settings']['request'],
): Promise<DesktopCommandMap['load_inbox_monitor_settings']['response']> {
    return runtime.loadInboxMonitorSettings();
}

export async function handleSaveInboxMonitorSettings(
    runtime: DesktopRuntime,
    payload: DesktopCommandMap['save_inbox_monitor_settings']['request'],
): Promise<DesktopCommandMap['save_inbox_monitor_settings']['response']> {
    return runtime.saveInboxMonitorSettings(payload);
}

export async function handleGetInboxMonitorState(
    runtime: DesktopRuntime,
    _payload: DesktopCommandMap['get_inbox_monitor_state']['request'],
): Promise<DesktopCommandMap['get_inbox_monitor_state']['response']> {
    return runtime.getInboxMonitorState();
}

export async function handleStartInboxMonitor(
    runtime: DesktopRuntime,
    payload: DesktopCommandMap['start_inbox_monitor']['request'],
): Promise<DesktopCommandMap['start_inbox_monitor']['response']> {
    return runtime.startInboxMonitor(payload);
}

export async function handleStopInboxMonitor(
    runtime: DesktopRuntime,
    _payload: DesktopCommandMap['stop_inbox_monitor']['request'],
): Promise<DesktopCommandMap['stop_inbox_monitor']['response']> {
    return runtime.stopInboxMonitor();
}
