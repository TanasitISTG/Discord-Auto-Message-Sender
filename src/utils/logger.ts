import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { LogEntry, LogLevel } from '../types';

type LogColor = 'green' | 'red' | 'yellow' | 'blue' | 'cyan';
type LogMeta = Record<string, string | number | boolean | undefined>;
type LogSink = (entry: LogEntry) => void;

export interface BufferedFileWriter {
    sink: LogSink;
    flush(): Promise<void>;
    close(): Promise<void>;
}

export interface StructuredLogger {
    emit(entry: Omit<LogEntry, 'id' | 'timestamp'> & { timestamp?: string }): LogEntry;
    child(defaults: Partial<Pick<LogEntry, 'context' | 'sessionId' | 'segmentId' | 'segmentKind'>>): StructuredLogger;
    getEntries(): LogEntry[];
}

export interface StructuredLoggerOptions {
    sinks?: LogSink[];
    defaults?: Partial<Pick<LogEntry, 'context' | 'sessionId' | 'segmentId' | 'segmentKind'>>;
    maxEntries?: number;
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
        console.log(
            chalk.gray(`[${timestamp}]`) +
                ` [${chalk[color](entry.context)}] ${entry.message}${formatMeta(entry.meta)}`,
        );
    };
}

export function createFileSink(filePath: string): LogSink {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    return (entry) => {
        fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    };
}

export function createBufferedFileWriter(filePath: string): BufferedFileWriter {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const stream = fs.createWriteStream(filePath, {
        flags: 'a',
        encoding: 'utf8',
    });

    const queue: string[] = [];
    let writeInFlight = false;
    let writerFailed = false;
    let reportedFailure = false;
    let destroyed = false;
    let waiters: Array<() => void> = [];

    function reportFailure(error: unknown) {
        if (reportedFailure) {
            return;
        }

        reportedFailure = true;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Buffered log writer failed for '${filePath}': ${message}`);
    }

    function releaseWaiters() {
        const next = waiters;
        waiters = [];
        for (const resolve of next) {
            resolve();
        }
    }

    function waitForIdle() {
        if (!writeInFlight && queue.length === 0) {
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            waiters.push(resolve);
        });
    }

    async function drainQueue() {
        if (writeInFlight || writerFailed || destroyed) {
            return;
        }

        writeInFlight = true;

        try {
            while (queue.length > 0 && !writerFailed && !destroyed) {
                const chunk = queue.shift()!;
                const canContinue = stream.write(chunk);
                if (!canContinue) {
                    await new Promise<void>((resolve, reject) => {
                        const onDrain = () => {
                            cleanup();
                            resolve();
                        };
                        const onError = (error: Error) => {
                            cleanup();
                            reject(error);
                        };
                        const cleanup = () => {
                            stream.off('drain', onDrain);
                            stream.off('error', onError);
                        };

                        stream.once('drain', onDrain);
                        stream.once('error', onError);
                    });
                }
            }
        } catch (error) {
            writerFailed = true;
            queue.length = 0;
            reportFailure(error);
        } finally {
            writeInFlight = false;
            releaseWaiters();
        }
    }

    stream.on('error', (error) => {
        writerFailed = true;
        queue.length = 0;
        reportFailure(error);
        releaseWaiters();
    });

    return {
        sink(entry) {
            if (writerFailed || destroyed) {
                return;
            }

            queue.push(`${JSON.stringify(entry)}\n`);
            void drainQueue();
        },
        async flush() {
            await drainQueue();
            await waitForIdle();
        },
        async close() {
            if (destroyed) {
                return;
            }

            await drainQueue();
            await waitForIdle();
            await new Promise<void>((resolve) => {
                stream.end(() => resolve());
            });
            destroyed = true;
        },
    };
}

export function createStructuredLogger(options: StructuredLoggerOptions = {}): StructuredLogger {
    const entries: LogEntry[] = [];
    const sinks = options.sinks ?? [];
    const defaults = options.defaults ?? {};
    const maxEntries = options.maxEntries ?? 1000;

    return {
        emit(entry) {
            const nextEntry: LogEntry = {
                id: createEntryId(),
                timestamp: entry.timestamp ?? new Date().toISOString(),
                level: entry.level,
                context: entry.context ?? defaults.context ?? 'System',
                message: entry.message,
                meta: entry.meta,
                sessionId: entry.sessionId ?? defaults.sessionId,
                segmentId: entry.segmentId ?? defaults.segmentId,
                segmentKind: entry.segmentKind ?? defaults.segmentKind,
            };

            if (maxEntries > 0) {
                entries.push(nextEntry);
                if (entries.length > maxEntries) {
                    entries.splice(0, entries.length - maxEntries);
                }
            }
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
                    ...childDefaults,
                },
                maxEntries,
            });
        },
        getEntries() {
            return [...entries];
        },
    };
}

export const defaultLogger = createStructuredLogger({
    sinks: [createConsoleSink()],
});

export function emitLog(
    logger: StructuredLogger,
    context: string,
    message: string,
    color: LogColor = 'blue',
    meta?: LogMeta,
) {
    return logger.emit({
        context,
        level: levelFromColor(color),
        message,
        meta: meta ? Object.fromEntries(Object.entries(meta).map(([key, value]) => [key, value ?? null])) : undefined,
    });
}
