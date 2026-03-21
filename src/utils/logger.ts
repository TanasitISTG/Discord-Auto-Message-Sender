import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { LogEntry, LogLevel } from '../types';

type LogColor = 'green' | 'red' | 'yellow' | 'blue' | 'cyan';
type LogMeta = Record<string, string | number | boolean | undefined>;
type LogSink = (entry: LogEntry) => void;

export interface StructuredLogger {
    emit(entry: Omit<LogEntry, 'id' | 'timestamp'> & { timestamp?: string }): LogEntry;
    child(defaults: Partial<Pick<LogEntry, 'context' | 'sessionId'>>): StructuredLogger;
    getEntries(): LogEntry[];
}

export interface StructuredLoggerOptions {
    sinks?: LogSink[];
    defaults?: Partial<Pick<LogEntry, 'context' | 'sessionId'>>;
}

function createEntryId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function levelFromColor(color: LogColor): LogLevel {
    switch (color) {
        case 'green':
            return 'success';
        case 'red':
            return 'error';
        case 'yellow':
            return 'warning';
        case 'cyan':
            return 'info';
        default:
            return 'debug';
    }
}

function colorFromLevel(level: LogLevel): LogColor {
    switch (level) {
        case 'success':
            return 'green';
        case 'error':
            return 'red';
        case 'warning':
            return 'yellow';
        case 'info':
            return 'cyan';
        default:
            return 'blue';
    }
}

function formatMeta(meta?: LogEntry['meta']): string {
    if (!meta) {
        return '';
    }

    const pairs = Object.entries(meta)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`);

    return pairs.length > 0 ? ` ${chalk.gray(pairs.join(' '))}` : '';
}

export function createConsoleSink(): LogSink {
    return (entry) => {
        const color = colorFromLevel(entry.level);
        const timestamp = new Date(entry.timestamp).toLocaleTimeString();
        console.log(chalk.gray(`[${timestamp}]`) + ` [${chalk[color](entry.context)}] ${entry.message}${formatMeta(entry.meta)}`);
    };
}

export function createFileSink(filePath: string): LogSink {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    return (entry) => {
        fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    };
}

export function createStructuredLogger(options: StructuredLoggerOptions = {}): StructuredLogger {
    const entries: LogEntry[] = [];
    const sinks = options.sinks ?? [];
    const defaults = options.defaults ?? {};

    return {
        emit(entry) {
            const nextEntry: LogEntry = {
                id: createEntryId(),
                timestamp: entry.timestamp ?? new Date().toISOString(),
                level: entry.level,
                context: entry.context ?? defaults.context ?? 'System',
                message: entry.message,
                meta: entry.meta,
                sessionId: entry.sessionId ?? defaults.sessionId
            };

            entries.push(nextEntry);
            for (const sink of sinks) {
                sink(nextEntry);
            }

            return nextEntry;
        },
        child(childDefaults) {
            return createStructuredLogger({
                sinks,
                defaults: {
                    ...defaults,
                    ...childDefaults
                }
            });
        },
        getEntries() {
            return [...entries];
        }
    };
}

export const defaultLogger = createStructuredLogger({
    sinks: [createConsoleSink()]
});

export function emitLog(
    logger: StructuredLogger,
    context: string,
    message: string,
    color: LogColor = 'blue',
    meta?: LogMeta
) {
    return logger.emit({
        context,
        level: levelFromColor(color),
        message,
        meta: meta
            ? Object.fromEntries(
                Object.entries(meta).map(([key, value]) => [key, value ?? null])
            )
            : undefined
    });
}
