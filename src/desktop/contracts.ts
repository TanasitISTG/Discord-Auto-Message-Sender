import {
    AppConfig,
    AppEvent,
    DryRunResult,
    LogEntry,
    PreflightResult,
    RuntimeOptions,
    SenderStateRecord,
    SessionState
} from '../types';

export type {
    AppConfig,
    DryRunResult,
    LogEntry,
    PreflightResult,
    RuntimeOptions,
    SenderStateRecord,
    SessionState
} from '../types';

export type SessionSnapshot = SessionState;
export type ConfigLoadResult =
    | { kind: 'ok'; config: AppConfig }
    | { kind: 'missing' }
    | { kind: 'invalid'; error: string };
export type SaveConfigResult = { ok: true; config: AppConfig };
export type LogLoadResult = {
    ok: true;
    path: string;
    entries: LogEntry[];
};
export type StateLoadResult = SenderStateRecord;
export type TokenStorageMode = 'secure' | 'environment' | 'missing';
export type SidecarStatus = 'connecting' | 'ready' | 'restarting' | 'failed';
export interface DesktopSetupState {
    tokenPresent: boolean;
    tokenStorage: TokenStorageMode;
    dataDir: string;
    secureStorePath: string;
    envPath: string;
    configPath: string;
    statePath: string;
    logsDir: string;
    warning?: string;
}
export interface ReleaseDiagnostics {
    appVersion: string;
    dataDir: string;
    logsDir: string;
    configPath: string;
    statePath: string;
    secureStorePath: string;
    tokenStorage: TokenStorageMode;
    sidecarStatus: SidecarStatus;
}
export interface SupportBundleResult {
    path: string;
    includedFiles: string[];
    missingFiles: string[];
}
export interface ResetRuntimeStateResult {
    ok: true;
    clearedStateFile: boolean;
    deletedLogFiles: number;
}

export interface EmptyRequest {}

export interface RunPreflightRequest {
    token?: string;
}

export interface SaveConfigRequest {
    config: AppConfig;
}

export interface RunDryRunRequest {
    runtime: RuntimeOptions;
}

export interface StartSessionRequest extends RuntimeOptions {
    token?: string;
}

export interface SessionControlRequest {
    action: 'pause' | 'resume' | 'stop';
    reason?: string;
}

export interface LoadLogsRequest {
    sessionId: string;
}

export interface OpenLogFileRequest {
    sessionId: string;
}

export interface SaveEnvironmentRequest {
    discordToken: string;
}

export interface DesktopCommandMap {
    load_config: {
        request: EmptyRequest;
        response: ConfigLoadResult;
    };
    save_config: {
        request: SaveConfigRequest;
        response: SaveConfigResult;
    };
    run_preflight: {
        request: RunPreflightRequest;
        response: PreflightResult;
    };
    run_dry_run: {
        request: RunDryRunRequest;
        response: DryRunResult;
    };
    start_session: {
        request: StartSessionRequest;
        response: SessionSnapshot;
    };
    pause_session: {
        request: EmptyRequest;
        response: SessionSnapshot | null;
    };
    resume_session: {
        request: EmptyRequest;
        response: SessionSnapshot | null;
    };
    stop_session: {
        request: EmptyRequest;
        response: SessionSnapshot | null;
    };
    get_session_state: {
        request: EmptyRequest;
        response: SessionSnapshot | null;
    };
    load_logs: {
        request: LoadLogsRequest;
        response: LogLoadResult;
    };
    load_state: {
        request: EmptyRequest;
        response: StateLoadResult;
    };
    load_setup_state: {
        request: EmptyRequest;
        response: DesktopSetupState;
    };
    save_environment: {
        request: SaveEnvironmentRequest;
        response: DesktopSetupState;
    };
    clear_secure_token: {
        request: EmptyRequest;
        response: DesktopSetupState;
    };
    discard_resume_session: {
        request: EmptyRequest;
        response: StateLoadResult;
    };
    load_release_diagnostics: {
        request: EmptyRequest;
        response: ReleaseDiagnostics;
    };
    open_logs_directory: {
        request: EmptyRequest;
        response: string;
    };
    export_support_bundle: {
        request: EmptyRequest;
        response: SupportBundleResult;
    };
    reset_runtime_state: {
        request: EmptyRequest;
        response: ResetRuntimeStateResult;
    };
    open_log_file: {
        request: OpenLogFileRequest;
        response: string;
    };
    open_data_directory: {
        request: EmptyRequest;
        response: string;
    };
}

export type DesktopCommandName = keyof DesktopCommandMap;

export type DesktopEvent =
    | AppEvent
    | { type: 'close_blocked'; message: string; state: SessionSnapshot | null }
    | { type: 'sidecar_error'; message: string; status: Extract<SidecarStatus, 'restarting' | 'failed'> }
    | { type: 'sidecar_ready' };

export interface DesktopRpcRequest<K extends DesktopCommandName = DesktopCommandName> {
    id: string;
    command: K;
    payload: DesktopCommandMap[K]['request'];
}

export type DesktopRpcSuccessResponse<K extends DesktopCommandName = DesktopCommandName> = {
    type: 'response';
    id: string;
    ok: true;
    result: DesktopCommandMap[K]['response'];
};

export interface DesktopRpcErrorResponse {
    type: 'response';
    id: string;
    ok: false;
    error: string;
}

export type DesktopRpcResponse<K extends DesktopCommandName = DesktopCommandName> =
    | DesktopRpcSuccessResponse<K>
    | DesktopRpcErrorResponse;

export interface DesktopEventMessage {
    type: 'event';
    event: DesktopEvent;
}

export type DesktopSidecarMessage = DesktopRpcResponse | DesktopEventMessage;
