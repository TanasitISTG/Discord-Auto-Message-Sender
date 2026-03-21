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
export interface DesktopSetupState {
    token: string;
    tokenPresent: boolean;
    dataDir: string;
    envPath: string;
    configPath: string;
    statePath: string;
    logsDir: string;
}

export interface EmptyRequest {}

export interface SaveConfigRequest {
    config: AppConfig;
}

export interface RunDryRunRequest {
    runtime: RuntimeOptions;
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
        request: EmptyRequest;
        response: PreflightResult;
    };
    run_dry_run: {
        request: RunDryRunRequest;
        response: DryRunResult;
    };
    start_session: {
        request: RuntimeOptions;
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
    discard_resume_session: {
        request: EmptyRequest;
        response: StateLoadResult;
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
    | { type: 'sidecar_error'; message: string }
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
