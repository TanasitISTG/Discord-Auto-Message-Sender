import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
    AppConfig,
    ConfigLoadResult,
    DesktopSetupState,
    DesktopCommandMap,
    DesktopCommandName,
    DesktopEvent,
    DryRunResult,
    InboxMonitorSettings,
    InboxMonitorSnapshot,
    InboxMonitorState,
    LogLoadResult,
    LogEntry,
    NotificationDeliverySettings,
    NotificationDeliverySnapshot,
    PreflightResult,
    ResetRuntimeStateResult,
    ReleaseDiagnostics,
    RuntimeOptions,
    SaveConfigResult,
    SaveEnvironmentRequest,
    SidecarStatus,
    SenderStateRecord,
    SupportBundleResult,
    SessionSnapshot
} from '../../../src/desktop/contracts';

export type {
    AppConfig,
    ConfigLoadResult,
    DesktopSetupState,
    DesktopEvent,
    DryRunResult,
    InboxMonitorSettings,
    InboxMonitorSnapshot,
    InboxMonitorState,
    LogLoadResult,
    LogEntry,
    NotificationDeliverySettings,
    NotificationDeliverySnapshot,
    PreflightResult,
    ResetRuntimeStateResult,
    ReleaseDiagnostics,
    RuntimeOptions,
    SaveConfigResult,
    SidecarStatus,
    SenderStateRecord,
    SupportBundleResult,
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

export async function loadSetupState(): Promise<DesktopSetupState> {
    return desktopInvoke('load_setup_state', {});
}

export async function saveEnvironment(request: SaveEnvironmentRequest): Promise<DesktopSetupState> {
    return desktopInvoke('save_environment', request);
}

export async function clearSecureToken(): Promise<DesktopSetupState> {
    return desktopInvoke('clear_secure_token', {});
}

export async function loadInboxMonitorSettings(): Promise<InboxMonitorSettings> {
    return desktopInvoke('load_inbox_monitor_settings', {});
}

export async function saveInboxMonitorSettings(settings: InboxMonitorSettings): Promise<InboxMonitorSnapshot> {
    return desktopInvoke('save_inbox_monitor_settings', { settings });
}

export async function getInboxMonitorState(): Promise<InboxMonitorState> {
    return desktopInvoke('get_inbox_monitor_state', {});
}

export async function startInboxMonitor(): Promise<InboxMonitorState> {
    return desktopInvoke('start_inbox_monitor', {});
}

export async function stopInboxMonitor(): Promise<InboxMonitorState> {
    return desktopInvoke('stop_inbox_monitor', {});
}

export async function loadNotificationDeliverySettings(): Promise<NotificationDeliverySettings> {
    return desktopInvoke('load_notification_delivery_settings', {});
}

export async function saveNotificationDeliverySettings(settings: NotificationDeliverySettings): Promise<NotificationDeliverySnapshot> {
    return desktopInvoke('save_notification_delivery_settings', { settings });
}

export async function getNotificationDeliveryState(): Promise<NotificationDeliverySnapshot> {
    return desktopInvoke('get_notification_delivery_state', {});
}

export async function saveTelegramBotToken(botToken: string): Promise<NotificationDeliverySnapshot> {
    return desktopInvoke('save_telegram_bot_token', { botToken });
}

export async function clearTelegramBotToken(): Promise<NotificationDeliverySnapshot> {
    return desktopInvoke('clear_telegram_bot_token', {});
}

export async function detectTelegramChat(): Promise<{ chatId: string; title?: string }> {
    return desktopInvoke('detect_telegram_chat', {});
}

export async function sendTestTelegramNotification(): Promise<{ ok: boolean; message: string; state: NotificationDeliverySnapshot['telegramState'] }> {
    return desktopInvoke('send_test_telegram_notification', {});
}

export async function discardResumeSession(): Promise<SenderStateRecord> {
    return desktopInvoke('discard_resume_session', {});
}

export async function loadReleaseDiagnostics(): Promise<ReleaseDiagnostics> {
    return desktopInvoke('load_release_diagnostics', {});
}

export async function openLogsDirectory(): Promise<string> {
    return desktopInvoke('open_logs_directory', {});
}

export async function exportSupportBundle(): Promise<SupportBundleResult> {
    return desktopInvoke('export_support_bundle', {});
}

export async function resetRuntimeState(): Promise<ResetRuntimeStateResult> {
    return desktopInvoke('reset_runtime_state', {});
}

export async function openLogFile(sessionId: string): Promise<string> {
    return desktopInvoke('open_log_file', { sessionId });
}

export async function openDataDirectory(): Promise<string> {
    return desktopInvoke('open_data_directory', {});
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
