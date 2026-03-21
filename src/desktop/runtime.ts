import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { readAppConfigResult, writeAppConfig } from '../config/store';
import { parseEnvironment } from '../config/schema';
import { createDryRun } from '../services/dry-run';
import { runPreflight } from '../services/preflight';
import { canResumeSession, SessionService, SessionServiceOptions } from '../services/session';
import { clearResumeSession, loadSenderState } from '../services/state-store';
import { createFileSink, createStructuredLogger, StructuredLogger } from '../utils/logger';
import {
    ConfigLoadResult,
    DesktopCommandMap,
    DesktopCommandName,
    DesktopEvent,
    DesktopSetupState,
    LogLoadResult,
    SessionSnapshot,
    StateLoadResult
} from './contracts';

type SessionController = Pick<SessionService, 'start' | 'pause' | 'resume' | 'stop' | 'getState'>;
type SessionFactory = (options: SessionServiceOptions) => SessionController;

interface DesktopRuntimeOptions {
    baseDir: string;
    emitEvent?: (event: DesktopEvent) => void;
    sessionFactory?: SessionFactory;
}

const DEFAULT_RUNTIME = {
    numMessages: 0,
    baseWaitSeconds: 5,
    marginSeconds: 2
};

export class DesktopRuntime {
    private readonly baseDir: string;
    private readonly emitEvent?: (event: DesktopEvent) => void;
    private readonly sessionFactory: SessionFactory;
    private session: SessionController | null = null;
    private sessionPromise: Promise<unknown> | null = null;
    private sessionState: SessionSnapshot | null = null;

    constructor(options: DesktopRuntimeOptions) {
        this.baseDir = path.resolve(options.baseDir);
        this.emitEvent = options.emitEvent;
        this.sessionFactory = options.sessionFactory ?? ((sessionOptions) => new SessionService(sessionOptions));
    }

    async execute<K extends DesktopCommandName>(
        command: K,
        payload: DesktopCommandMap[K]['request']
    ): Promise<DesktopCommandMap[K]['response']> {
        switch (command) {
            case 'load_config':
                return await this.loadConfig() as DesktopCommandMap[K]['response'];
            case 'save_config':
                return await this.saveConfig(payload as DesktopCommandMap['save_config']['request']) as DesktopCommandMap[K]['response'];
            case 'run_preflight':
                return await this.runPreflight() as DesktopCommandMap[K]['response'];
            case 'run_dry_run':
                return await this.runDryRun(payload as DesktopCommandMap['run_dry_run']['request']) as DesktopCommandMap[K]['response'];
            case 'start_session':
                return await this.startSession(payload as DesktopCommandMap['start_session']['request']) as DesktopCommandMap[K]['response'];
            case 'pause_session':
                return this.pauseSession() as DesktopCommandMap[K]['response'];
            case 'resume_session':
                return this.resumeSession() as DesktopCommandMap[K]['response'];
            case 'stop_session':
                return this.stopSession() as DesktopCommandMap[K]['response'];
            case 'get_session_state':
                return this.getSessionState() as DesktopCommandMap[K]['response'];
            case 'load_logs':
                return await this.loadLogs(payload as DesktopCommandMap['load_logs']['request']) as DesktopCommandMap[K]['response'];
            case 'load_state':
                return this.loadState() as DesktopCommandMap[K]['response'];
            case 'load_setup_state':
                return this.loadSetupState() as DesktopCommandMap[K]['response'];
            case 'save_environment':
                return this.saveEnvironment(payload as DesktopCommandMap['save_environment']['request']) as DesktopCommandMap[K]['response'];
            case 'discard_resume_session':
                return this.discardResumeSession() as DesktopCommandMap[K]['response'];
            default:
                throw new Error(`Unsupported desktop command '${command}'.`);
        }
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

    async runPreflight(): Promise<DesktopCommandMap['run_preflight']['response']> {
        const configResult = readAppConfigResult(this.resolveConfigPaths());
        if (configResult.kind !== 'ok') {
            const result = {
                ok: false,
                checkedAt: new Date().toISOString(),
                configValid: false,
                tokenPresent: configResult.kind !== 'missing',
                issues: [configResult.kind === 'invalid' ? configResult.error : 'Config is missing.'],
                channels: []
            };
            this.publish({
                type: 'preflight_result_emitted',
                result
            });
            return result;
        }

        const token = this.readToken();
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

    async startSession(runtime: DesktopCommandMap['start_session']['request']): Promise<DesktopCommandMap['start_session']['response']> {
        const current = this.getSessionState();
        if (current && ['running', 'paused', 'stopping'].includes(current.status)) {
            throw new Error('A desktop session is already running.');
        }

        const token = this.readRequiredToken();
        const configResult = readAppConfigResult(this.resolveConfigPaths());
        if (configResult.kind !== 'ok') {
            throw new Error(configResult.kind === 'invalid' ? configResult.error : 'Configuration is missing.');
        }

        const persistedState = loadSenderState(this.baseDir);
        const resumeSession = canResumeSession(persistedState.resumeSession, configResult.config, runtime)
            ? persistedState.resumeSession
            : undefined;
        const sessionId = resumeSession?.sessionId ?? `session-${Date.now()}`;
        const logger = this.createSessionLogger(sessionId);
        const session = this.sessionFactory({
            baseDir: this.baseDir,
            config: configResult.config,
            token,
            runtime,
            sessionId,
            logger,
            resumeSession,
            emitEvent: (event) => {
                if ('state' in event) {
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
        const logPath = path.join(this.baseDir, 'logs', `${payload.sessionId}.jsonl`);
        if (!fs.existsSync(logPath)) {
            return {
                ok: true,
                path: logPath,
                entries: []
            };
        }

        return {
            ok: true,
            path: logPath,
            entries: fs.readFileSync(logPath, 'utf8')
                .split(/\r?\n/)
                .filter((line) => line.trim().length > 0)
                .map((line) => JSON.parse(line))
        };
    }

    loadState(): StateLoadResult {
        return loadSenderState(this.baseDir);
    }

    loadSetupState(): DesktopSetupState {
        const token = this.readStoredToken();
        return {
            token,
            tokenPresent: token.trim().length > 0,
            dataDir: this.baseDir,
            envPath: this.getEnvironmentPath(),
            configPath: path.join(this.baseDir, 'config.json'),
            statePath: path.join(this.baseDir, '.sender-state.json'),
            logsDir: path.join(this.baseDir, 'logs')
        };
    }

    saveEnvironment(payload: DesktopCommandMap['save_environment']['request']): DesktopSetupState {
        const normalizedToken = payload.discordToken.trim();
        if (!normalizedToken) {
            throw new Error('DISCORD_TOKEN cannot be empty.');
        }

        const envPath = this.getEnvironmentPath();
        const existing = fs.existsSync(envPath)
            ? fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
            : [];
        const nextLine = `DISCORD_TOKEN=${JSON.stringify(normalizedToken)}`;
        let replaced = false;
        const nextLines = existing
            .filter((line, index, lines) => !(index === lines.length - 1 && line.trim() === ''))
            .map((line) => {
                if (/^\s*DISCORD_TOKEN\s*=/.test(line)) {
                    replaced = true;
                    return nextLine;
                }
                return line;
            });

        if (!replaced) {
            nextLines.push(nextLine);
        }

        fs.writeFileSync(envPath, `${nextLines.join('\n')}\n`, 'utf8');
        return this.loadSetupState();
    }

    discardResumeSession(): StateLoadResult {
        const current = this.getSessionState();
        if (current && ['running', 'paused', 'stopping'].includes(current.status)) {
            throw new Error('Stop the active session before discarding the saved checkpoint.');
        }

        return clearResumeSession(this.baseDir);
    }

    private createSessionLogger(sessionId: string): StructuredLogger {
        return createStructuredLogger({
            sinks: [
                createFileSink(path.join(this.baseDir, 'logs', `${sessionId}.jsonl`)),
                (entry) => this.publish({
                    type: 'log_event_emitted',
                    entry
                })
            ],
            defaults: {
                sessionId
            }
        });
    }

    private resolveConfigPaths() {
        return {
            configFile: path.join(this.baseDir, 'config.json'),
            messagesFile: path.join(this.baseDir, 'messages.json')
        };
    }

    private getEnvironmentPath() {
        return path.join(this.baseDir, '.env');
    }

    private readFileEnvironment(): Record<string, string> {
        const envPath = this.getEnvironmentPath();
        return fs.existsSync(envPath)
            ? dotenv.parse(fs.readFileSync(envPath, 'utf8'))
            : {};
    }

    private readEnvironmentSource(): NodeJS.ProcessEnv {
        const fileEnvironment = this.readFileEnvironment();
        return {
            ...process.env,
            ...fileEnvironment
        };
    }

    private readStoredToken(): string {
        return this.readFileEnvironment().DISCORD_TOKEN?.trim() ?? '';
    }

    private readToken(): string | undefined {
        try {
            return parseEnvironment(this.readEnvironmentSource()).DISCORD_TOKEN;
        } catch {
            return undefined;
        }
    }

    private readRequiredToken(): string {
        const token = this.readToken();
        if (!token) {
            throw new Error('DISCORD_TOKEN is missing.');
        }

        return token;
    }

    private publish(event: DesktopEvent) {
        if (event.type === 'session_started'
            || event.type === 'session_paused'
            || event.type === 'session_resumed'
            || event.type === 'session_stopping'
            || event.type === 'summary_ready'
            || event.type === 'channel_state_changed'
            || event.type === 'session_state_updated') {
            this.sessionState = event.state;
        }

        this.emitEvent?.(event);
    }
}
