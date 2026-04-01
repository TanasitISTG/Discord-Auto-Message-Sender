import fs from 'fs';
import path from 'path';
import { readAppConfigResult, writeAppConfig } from '../config/store';
import { createInboxMonitorService, InboxMonitorController } from '../services/inbox-monitor';
import { createDryRun } from '../services/dry-run';
import { runPreflight } from '../services/preflight';
import { canResumeSession, SessionService, SessionServiceOptions } from '../services/session';
import { clearResumeSession, getDefaultInboxMonitorSnapshot, loadSenderState, updateSenderState } from '../services/state-store';
import {
    ConfigLoadResult,
    DesktopCommandMap,
    DesktopEvent,
    LogLoadResult,
    SessionSnapshot,
    StateLoadResult
} from './contracts';
import { resolveSessionLogPath, validateSessionId } from '../utils/session-id';

type SessionController = Pick<SessionService, 'start' | 'pause' | 'resume' | 'stop' | 'getState'>;
type SessionFactory = (options: SessionServiceOptions) => SessionController;

interface DesktopRuntimeOptions {
    baseDir: string;
    emitEvent?: (event: DesktopEvent) => void;
    sessionFactory?: SessionFactory;
    inboxMonitorFactory?: (options: {
        initialSnapshot: NonNullable<StateLoadResult['inboxMonitor']>;
        emitEvent?: (event: DesktopEvent) => void;
        onSnapshotChange: (snapshot: NonNullable<StateLoadResult['inboxMonitor']>) => void;
    }) => InboxMonitorController;
}

const DEFAULT_RUNTIME = {
    numMessages: 0,
    baseWaitSeconds: 5,
    marginSeconds: 2
};

function isSessionStateEvent(event: DesktopEvent): event is Extract<DesktopEvent, {
    type:
        | 'session_started'
        | 'session_paused'
        | 'session_resumed'
        | 'session_stopping'
        | 'channel_state_changed'
        | 'session_state_updated'
        | 'summary_ready'
}> {
    return event.type === 'session_started'
        || event.type === 'session_paused'
        || event.type === 'session_resumed'
        || event.type === 'session_stopping'
        || event.type === 'channel_state_changed'
        || event.type === 'session_state_updated'
        || event.type === 'summary_ready';
}

export class DesktopRuntime {
    private readonly baseDir: string;
    private readonly emitEvent?: (event: DesktopEvent) => void;
    private readonly sessionFactory: SessionFactory;
    private readonly inboxMonitor: InboxMonitorController;
    private session: SessionController | null = null;
    private sessionPromise: Promise<unknown> | null = null;
    private sessionState: SessionSnapshot | null = null;

    constructor(options: DesktopRuntimeOptions) {
        this.baseDir = path.resolve(options.baseDir);
        this.emitEvent = options.emitEvent;
        this.sessionFactory = options.sessionFactory ?? ((sessionOptions) => new SessionService(sessionOptions));
        const persistedState = loadSenderState(this.baseDir);
        const monitorSnapshot = persistedState.inboxMonitor ?? getDefaultInboxMonitorSnapshot();
        this.inboxMonitor = (options.inboxMonitorFactory ?? ((monitorOptions) => createInboxMonitorService(monitorOptions)))({
            initialSnapshot: monitorSnapshot,
            emitEvent: this.emitEvent,
            onSnapshotChange: (snapshot) => {
                updateSenderState(this.baseDir, (state) => {
                    state.inboxMonitor = snapshot;
                    clearMonitorWarning(state);
                });
            }
        });
    }

    async loadConfig(): Promise<ConfigLoadResult> {
        return readAppConfigResult(this.resolveConfigPaths());
    }

    async saveConfig(payload: DesktopCommandMap['save_config']['request']): Promise<DesktopCommandMap['save_config']['response']> {
        const config = writeAppConfig(payload.config, this.resolveConfigPaths());
        return {
            ok: true,
            config
        };
    }

    async runPreflight(payload: DesktopCommandMap['run_preflight']['request']): Promise<DesktopCommandMap['run_preflight']['response']> {
        const configResult = readAppConfigResult(this.resolveConfigPaths());
        if (configResult.kind !== 'ok') {
            const token = this.readToken(payload.token);
            const result = {
                ok: false,
                checkedAt: new Date().toISOString(),
                configValid: false,
                tokenPresent: Boolean(token),
                issues: [configResult.kind === 'invalid' ? configResult.error : 'Config is missing.'],
                channels: []
            };
            this.publish({
                type: 'preflight_result_emitted',
                result
            });
            return result;
        }

        const token = this.readToken(payload.token);
        const result = await runPreflight(configResult.config, {
            token,
            checkAccess: true
        });
        this.publish({
            type: 'preflight_result_emitted',
            result
        });
        return result;
    }

    async runDryRun(payload: DesktopCommandMap['run_dry_run']['request']): Promise<DesktopCommandMap['run_dry_run']['response']> {
        const configResult = readAppConfigResult(this.resolveConfigPaths());
        if (configResult.kind !== 'ok') {
            throw new Error(configResult.kind === 'invalid' ? configResult.error : 'Config is missing.');
        }

        const result = createDryRun(configResult.config, payload.runtime ?? DEFAULT_RUNTIME);
        this.publish({
            type: 'dry_run_ready',
            result
        });
        return result;
    }

    async startSession(request: DesktopCommandMap['start_session']['request']): Promise<DesktopCommandMap['start_session']['response']> {
        const current = this.getSessionState();
        if (current && ['running', 'paused', 'stopping'].includes(current.status)) {
            throw new Error('A desktop session is already running.');
        }

        const runtime = {
            numMessages: request.numMessages,
            baseWaitSeconds: request.baseWaitSeconds,
            marginSeconds: request.marginSeconds
        };
        const token = this.readRequiredToken(request.token);
        const configResult = readAppConfigResult(this.resolveConfigPaths());
        if (configResult.kind !== 'ok') {
            throw new Error(configResult.kind === 'invalid' ? configResult.error : 'Configuration is missing.');
        }

        const persistedState = loadSenderState(this.baseDir);
        const resumeSession = canResumeSession(persistedState.resumeSession, configResult.config, runtime)
            ? persistedState.resumeSession
            : undefined;
        const sessionId = validateSessionId(resumeSession?.sessionId ?? `session-${Date.now()}`);
        const session = this.sessionFactory({
            baseDir: this.baseDir,
            config: configResult.config,
            token,
            runtime,
            sessionId,
            resumeSession,
            emitEvent: (event) => {
                if (isSessionStateEvent(event)) {
                    this.sessionState = event.state;
                }
                this.publish(event);
            }
        });

        this.session = session;
        this.sessionState = session.getState();
        this.sessionPromise = session.start()
            .catch((error) => {
                this.publish({
                    type: 'sidecar_error',
                    status: 'failed',
                    message: error instanceof Error ? error.message : String(error)
                });
                throw error;
            })
            .finally(() => {
                this.session = null;
                this.sessionPromise = null;
            });

        return session.getState();
    }

    pauseSession(): DesktopCommandMap['pause_session']['response'] {
        return this.session?.pause() ?? null;
    }

    resumeSession(): DesktopCommandMap['resume_session']['response'] {
        return this.session?.resume() ?? null;
    }

    stopSession(): DesktopCommandMap['stop_session']['response'] {
        return this.session?.stop('Stop requested from desktop UI.') ?? null;
    }

    getSessionState(): DesktopCommandMap['get_session_state']['response'] {
        if (this.session) {
            this.sessionState = this.session.getState();
            return this.sessionState;
        }

        return this.sessionState;
    }

    async loadLogs(payload: DesktopCommandMap['load_logs']['request']): Promise<LogLoadResult> {
        const logPath = resolveSessionLogPath(this.baseDir, payload.sessionId);
        if (!fs.existsSync(logPath)) {
            return {
                ok: true,
                path: logPath,
                entries: [],
                warnings: []
            };
        }

        const warnings: string[] = [];
        const entries = fs.readFileSync(logPath, 'utf8')
            .split(/\r?\n/)
            .flatMap((line, index) => {
                if (line.trim().length === 0) {
                    return [];
                }

                try {
                    return [JSON.parse(line)];
                } catch {
                    warnings.push(`Skipped invalid log line ${index + 1}.`);
                    return [];
                }
            });

        return {
            ok: true,
            path: logPath,
            entries,
            ...(warnings.length > 0 ? { warnings } : {})
        };
    }

    loadState(): StateLoadResult {
        return loadSenderState(this.baseDir);
    }

    discardResumeSession(): StateLoadResult {
        const current = this.getSessionState();
        if (current && ['running', 'paused', 'stopping'].includes(current.status)) {
            throw new Error('Stop the active session before discarding the saved checkpoint.');
        }

        return clearResumeSession(this.baseDir);
    }

    loadInboxMonitorSettings(): DesktopCommandMap['load_inbox_monitor_settings']['response'] {
        return this.inboxMonitor.loadSettings();
    }

    saveInboxMonitorSettings(
        payload: DesktopCommandMap['save_inbox_monitor_settings']['request']
    ): DesktopCommandMap['save_inbox_monitor_settings']['response'] {
        return this.inboxMonitor.saveSettings(payload.settings);
    }

    getInboxMonitorState(): DesktopCommandMap['get_inbox_monitor_state']['response'] {
        return this.inboxMonitor.getState();
    }

    async startInboxMonitor(
        payload: DesktopCommandMap['start_inbox_monitor']['request']
    ): Promise<DesktopCommandMap['start_inbox_monitor']['response']> {
        return await this.inboxMonitor.start(payload);
    }

    stopInboxMonitor(): DesktopCommandMap['stop_inbox_monitor']['response'] {
        return this.inboxMonitor.stop('Inbox monitor stopped from desktop shell.');
    }

    private resolveConfigPaths() {
        return {
            configFile: path.join(this.baseDir, 'config.json'),
            messagesFile: path.join(this.baseDir, 'messages.json')
        };
    }

    private readToken(explicitToken?: string): string | undefined {
        return typeof explicitToken === 'string' && explicitToken.trim().length > 0
            ? explicitToken.trim()
            : undefined;
    }

    private readRequiredToken(explicitToken?: string): string {
        const token = this.readToken(explicitToken);
        if (!token) {
            throw new Error('DISCORD_TOKEN is missing. Save it securely from Desktop Setup.');
        }

        return token;
    }

    private publish(event: DesktopEvent) {
        if (isSessionStateEvent(event)) {
            this.sessionState = event.state;
        }

        this.emitEvent?.(event);
    }
}

function clearMonitorWarning(state: StateLoadResult) {
    if (state.warning?.includes('sender state')) {
        state.warning = undefined;
    }
}

export { resolveSessionLogPath, validateSessionId } from '../utils/session-id';
