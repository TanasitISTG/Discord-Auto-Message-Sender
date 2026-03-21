import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface AppChannel {
    name: string;
    id: string;
    referrer: string;
    messageGroup: string;
    schedule?: {
        intervalSeconds: number;
        randomMarginSeconds: number;
        quietHours?: {
            start: string;
            end: string;
        } | null;
        timezone?: string;
        maxSendsPerDay?: number | null;
        cooldownWindowSize?: number;
    };
}

export interface AppConfig {
    userAgent: string;
    channels: AppChannel[];
    messageGroups: Record<string, string[]>;
}

export interface SessionState {
    id: string;
    status: 'idle' | 'running' | 'paused' | 'stopping' | 'completed' | 'failed';
    startedAt?: string;
    updatedAt: string;
    activeChannels: string[];
    completedChannels: string[];
    failedChannels: string[];
    sentMessages: number;
    stopReason?: string;
    summary?: {
        totalChannels: number;
        completedChannels: number;
        failedChannels: number;
        sentMessages: number;
        startedAt: string;
        finishedAt?: string;
        stopReason?: string;
    };
}

export interface PreflightResult {
    ok: boolean;
    checkedAt: string;
    configValid: boolean;
    tokenPresent: boolean;
    issues: string[];
    channels: Array<{
        channelId: string;
        channelName: string;
        ok: boolean;
        reason?: string;
        status?: number;
    }>;
}

export interface DryRunResult {
    generatedAt: string;
    willSendMessages: boolean;
    channels: Array<{
        channelId: string;
        channelName: string;
        groupName: string;
        enabled: boolean;
        sampleMessages: string[];
        cadence: {
            numMessages: number;
            baseWaitSeconds: number;
            marginSeconds: number;
        };
        skipReasons: string[];
    }>;
    summary: {
        selectedChannels: number;
        skippedChannels: number;
        totalSampleMessages: number;
    };
}

export interface SenderStateRecord {
    lastSession?: SessionState;
    summaries: Array<NonNullable<SessionState['summary']>>;
    recentFailures: Array<{
        channelId: string;
        channelName: string;
        reason: string;
        timestamp: string;
    }>;
    warning?: string;
}

export interface LogEntry {
    id: string;
    timestamp: string;
    level: 'info' | 'success' | 'warning' | 'error' | 'debug';
    context: string;
    message: string;
    meta?: Record<string, string | number | boolean | null>;
    sessionId?: string;
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function desktopInvoke<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
    if (!isTauri) {
        throw new Error('Tauri desktop APIs are unavailable in the browser dev preview.');
    }

    return invoke<T>(command, payload);
}

export async function loadConfig() {
    return desktopInvoke<{ kind: 'ok'; config: AppConfig } | { kind: 'missing' } | { kind: 'invalid'; error: string }>('load_config');
}

export async function saveConfig(config: AppConfig) {
    return desktopInvoke<{ ok: boolean; config: AppConfig }>('save_config', { config });
}

export async function runPreflight() {
    return desktopInvoke<PreflightResult>('run_preflight');
}

export async function runDryRun(runtime: { numMessages: number; baseWaitSeconds: number; marginSeconds: number }) {
    return desktopInvoke<DryRunResult>('run_dry_run', { runtime });
}

export async function startSession(runtime: { numMessages: number; baseWaitSeconds: number; marginSeconds: number }) {
    return desktopInvoke<SessionState>('start_session', runtime);
}

export async function pauseSession() {
    return desktopInvoke<SessionState>('pause_session');
}

export async function resumeSession() {
    return desktopInvoke<SessionState>('resume_session');
}

export async function stopSession() {
    return desktopInvoke<SessionState>('stop_session');
}

export async function getSessionState() {
    return desktopInvoke<SessionState | null>('get_session_state');
}

export async function loadLogs(sessionId: string) {
    return desktopInvoke<{ ok: boolean; path: string; entries: LogEntry[] }>('load_logs', { sessionId });
}

export async function loadState() {
    return desktopInvoke<SenderStateRecord>('load_state');
}

export async function openLogFile(sessionId: string) {
    return desktopInvoke<string>('open_log_file', { sessionId });
}

export async function subscribeToAppEvents(handler: (event: unknown) => void) {
    if (!isTauri) {
        return () => undefined;
    }

    const unlisten = await listen('app-event', (event) => {
        handler(event.payload);
    });

    return () => {
        unlisten();
    };
}
