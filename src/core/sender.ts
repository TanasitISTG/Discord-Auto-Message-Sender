import { AppChannel, MessageGroups } from '../types';
import { defaultLogger, emitLog, StructuredLogger } from '../utils/logger';
import { renderMessageTemplate } from '../services/message-template';

const API_BASE = 'https://discord.com/api/v10';
const MAX_SEND_ATTEMPTS = 3;
const DEFAULT_MAX_RATE_LIMIT_WAITS = 10;
const DEFAULT_GLOBAL_REQUEST_INTERVAL_MS = 250;
const ABORT_POLL_INTERVAL_MS = 250;
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

type FetchImpl = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;
type RandomFn = () => number;
type NowFn = () => Date;

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export type SendOutcome =
    | { type: 'success' }
    | { type: 'wait'; waitSeconds: number }
    | { type: 'fatal'; reason: 'aborted' | 'unauthorized' | 'forbidden' | 'not_found' | 'exhausted' };

export interface SenderCoordinator {
    abort(reason: string): void;
    isAborted(): boolean;
    getAbortReason(): string | null;
    scheduleRequest<T>(sleep: SleepFn, task: () => Promise<T>): Promise<T>;
}

export interface SenderDependencies {
    fetchImpl?: FetchImpl;
    sleep?: SleepFn;
    random?: RandomFn;
    now?: NowFn;
    logger?: StructuredLogger;
    coordinator?: SenderCoordinator;
    requestTimeoutMs?: number;
    lifecycle?: SenderLifecycle;
}

export interface RunChannelOptions extends SenderDependencies {
    target: AppChannel;
    numMessages: number;
    baseWaitSeconds: number;
    marginSeconds: number;
    token: string;
    userAgent: string;
    messageGroups: MessageGroups;
    maxRateLimitWaits?: number;
}

export interface SenderLifecycle {
    isPaused(): boolean;
    waitUntilResumed(sleep: SleepFn): Promise<boolean>;
    isStopping(): boolean;
    getStopReason(): string | null;
    onChannelEvent?(target: AppChannel, phase: 'started' | 'completed' | 'failed'): void;
    onMessageSent?(target: AppChannel, message: string): void;
    getRecentMessages?(target: AppChannel): string[];
}

interface ZonedDateParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
}

class SendAbortError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SendAbortError';
    }
}

class RequestTimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`Request timed out after ${timeoutMs}ms`);
        this.name = 'RequestTimeoutError';
    }
}

export function getBackoffDelayMs(attempt: number, random: RandomFn = Math.random): number {
    const baseDelay = 500 * Math.pow(2, attempt - 1);
    const jitter = Math.floor(random() * 250);
    return baseDelay + jitter;
}

function parseClockTime(value: string): { hour: number; minute: number } | null {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) {
        return null;
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) {
        return null;
    }

    return { hour, minute };
}

function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    });
    const parts = formatter.formatToParts(date);
    const values = Object.fromEntries(parts
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]));

    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
        hour: Number(values.hour),
        minute: Number(values.minute)
    };
}

function zonedTimeToUtcMillis(parts: ZonedDateParts, timeZone: string): number {
    const desiredUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    let guess = desiredUtc;

    for (let iteration = 0; iteration < 3; iteration += 1) {
        const actual = getZonedDateParts(new Date(guess), timeZone);
        const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0, 0);
        const delta = desiredUtc - actualUtc;
        guess += delta;

        if (delta === 0) {
            break;
        }
    }

    return guess;
}

function addDays(parts: ZonedDateParts, days: number): ZonedDateParts {
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    date.setUTCDate(date.getUTCDate() + days);

    return {
        ...parts,
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate()
    };
}

function isWithinQuietHours(currentMinutes: number, startMinutes: number, endMinutes: number): boolean {
    if (startMinutes === endMinutes) {
        return true;
    }

    if (startMinutes < endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }

    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

export function getQuietHoursDelayMs(target: AppChannel, now: Date = new Date()): number {
    const quietHours = target.schedule?.quietHours;
    if (!quietHours) {
        return 0;
    }

    const start = parseClockTime(quietHours.start);
    const end = parseClockTime(quietHours.end);
    if (!start || !end) {
        return 0;
    }

    const timeZone = target.schedule?.timezone ?? 'UTC';

    try {
        const zonedNow = getZonedDateParts(now, timeZone);
        const currentMinutes = (zonedNow.hour * 60) + zonedNow.minute;
        const startMinutes = (start.hour * 60) + start.minute;
        const endMinutes = (end.hour * 60) + end.minute;

        if (!isWithinQuietHours(currentMinutes, startMinutes, endMinutes)) {
            return 0;
        }

        const resumeDate = startMinutes < endMinutes
            ? zonedNow
            : currentMinutes >= startMinutes
                ? addDays(zonedNow, 1)
                : zonedNow;
        const resumeAt = zonedTimeToUtcMillis({
            ...resumeDate,
            hour: end.hour,
            minute: end.minute
        }, timeZone);

        return Math.max(0, resumeAt - now.getTime());
    } catch {
        return 0;
    }
}

async function sleepWithAbort(
    ms: number,
    sleep: SleepFn,
    coordinator?: SenderCoordinator,
    lifecycle?: SenderLifecycle
): Promise<boolean> {
    if (!coordinator && !lifecycle) {
        await sleep(ms);
        return true;
    }

    let remainingMs = ms;
    while (remainingMs > 0) {
        if (coordinator?.isAborted()) {
            return false;
        }

        if (lifecycle?.isStopping()) {
            return false;
        }

        if (lifecycle?.isPaused()) {
            const resumed = await lifecycle.waitUntilResumed(sleep);
            if (!resumed) {
                return false;
            }
            continue;
        }

        const chunkMs = Math.min(remainingMs, ABORT_POLL_INTERVAL_MS);
        await sleep(chunkMs);
        remainingMs -= chunkMs;
    }

    return !(coordinator?.isAborted() ?? false) && !(lifecycle?.isStopping() ?? false);
}

export function createSenderCoordinator(minRequestIntervalMs: number = DEFAULT_GLOBAL_REQUEST_INTERVAL_MS): SenderCoordinator {
    let abortedReason: string | null = null;
    let nextRequestAt = 0;
    let requestQueue = Promise.resolve();

    const coordinator: SenderCoordinator = {
        abort(reason: string) {
            if (!abortedReason) {
                abortedReason = reason;
            }
        },
        isAborted() {
            return abortedReason !== null;
        },
        getAbortReason() {
            return abortedReason;
        },
        async scheduleRequest<T>(sleep: SleepFn, task: () => Promise<T>): Promise<T> {
            let releaseQueue: (() => void) | undefined;
            const previousRequest = requestQueue;
            requestQueue = new Promise<void>((resolve) => {
                releaseQueue = resolve;
            });
            let startedRequest = false;

            await previousRequest;

            try {
                if (abortedReason) {
                    throw new SendAbortError(abortedReason);
                }

                const waitMs = Math.max(0, nextRequestAt - Date.now());
                if (waitMs > 0) {
                    const completedWait = await sleepWithAbort(waitMs, sleep, coordinator);
                    if (!completedWait) {
                        throw new SendAbortError(abortedReason ?? 'Sending was aborted.');
                    }
                }

                if (abortedReason) {
                    throw new SendAbortError(abortedReason);
                }

                startedRequest = true;
                return await task();
            } finally {
                if (startedRequest) {
                    nextRequestAt = Date.now() + minRequestIntervalMs;
                }
                releaseQueue?.();
            }
        }
    };

    return coordinator;
}

export function pickNextMessage(
    messages: string[],
    sentCache: Set<string>,
    random: RandomFn = Math.random,
    recentHistory: string[] = []
): string {
    if (messages.length === 0) {
        throw new Error('Cannot pick a message from an empty group.');
    }

    const uniqueMessageCount = new Set(messages).size;

    if (sentCache.size >= uniqueMessageCount) {
        sentCache.clear();
    }

    let availableMessages = messages.filter((message) => !sentCache.has(message));
    const recentSet = new Set(recentHistory);
    const nonRecentMessages = availableMessages.filter((message) => !recentSet.has(message));
    if (nonRecentMessages.length > 0) {
        availableMessages = nonRecentMessages;
    }

    if (availableMessages.length === 0) {
        sentCache.clear();
        const resetMessages = [...messages];
        const message = resetMessages[Math.floor(random() * resetMessages.length)];
        sentCache.add(message);
        return message;
    }

    const message = availableMessages[Math.floor(random() * availableMessages.length)];
    sentCache.add(message);
    return message;
}

function getResponseCode(body: unknown): string | number | undefined {
    if (!body || typeof body !== 'object') {
        return undefined;
    }

    if ('code' in body) {
        const code = (body as { code?: unknown }).code;
        if (typeof code === 'string' || typeof code === 'number') {
            return code;
        }
    }

    return undefined;
}

function getRetryAfterSeconds(body: unknown): number {
    if (!body || typeof body !== 'object' || !('retry_after' in body)) {
        return 5;
    }

    const retryAfter = (body as { retry_after?: unknown }).retry_after;
    return typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : 5;
}

function stringifyBody(body: unknown): string {
    if (typeof body === 'string') {
        return body;
    }

    if (body === null || body === undefined) {
        return 'null';
    }

    try {
        return JSON.stringify(body);
    } catch {
        return String(body);
    }
}

async function readResponseBody(response: Response): Promise<unknown> {
    const text = await response.text();

    if (text.length === 0) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

async function fetchWithTimeout(
    fetchImpl: FetchImpl,
    url: string,
    init: RequestInit,
    timeoutMs: number
): Promise<Response> {
    const controller = new AbortController();
    const fetchPromise = fetchImpl(url, {
        ...init,
        signal: controller.signal
    });

    let timeoutId: NodeJS.Timeout | undefined;

    try {
        return await Promise.race([
            fetchPromise,
            new Promise<Response>((_, reject) => {
                timeoutId = setTimeout(() => {
                    controller.abort();
                    reject(new RequestTimeoutError(timeoutMs));
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

export async function sendDiscordMessage(
    target: AppChannel,
    content: string,
    token: string,
    userAgent: string,
    dependencies: SenderDependencies = {}
): Promise<SendOutcome> {
    const fetchImpl = dependencies.fetchImpl ?? fetch;
    const sleep = dependencies.sleep ?? defaultSleep;
    const random = dependencies.random ?? Math.random;
    const coordinator = dependencies.coordinator;
    const requestTimeoutMs = dependencies.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const lifecycle = dependencies.lifecycle;
    const logger = dependencies.logger ?? defaultLogger;

    if (coordinator?.isAborted() || lifecycle?.isStopping()) {
        return { type: 'fatal', reason: 'aborted' };
    }

    if (lifecycle?.isPaused()) {
        const resumed = await lifecycle.waitUntilResumed(sleep);
        if (!resumed) {
            return { type: 'fatal', reason: 'aborted' };
        }
    }

    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
        try {
            const response = coordinator
                ? await coordinator.scheduleRequest(sleep, () => fetchWithTimeout(fetchImpl, `${API_BASE}/channels/${target.id}/messages`, {
                    method: 'POST',
                    headers: {
                        Authorization: token,
                        'User-Agent': userAgent,
                        'Content-Type': 'application/json',
                        Referer: target.referrer
                    },
                    body: JSON.stringify({ content, tts: false })
                }, requestTimeoutMs))
                : await fetchWithTimeout(fetchImpl, `${API_BASE}/channels/${target.id}/messages`, {
                    method: 'POST',
                    headers: {
                        Authorization: token,
                        'User-Agent': userAgent,
                        'Content-Type': 'application/json',
                        Referer: target.referrer
                    },
                    body: JSON.stringify({ content, tts: false })
                }, requestTimeoutMs);

            if (response.ok) {
                return { type: 'success' };
            }

            const body = await readResponseBody(response);
            if (response.status === 429) {
                const waitSeconds = getRetryAfterSeconds(body);
                emitLog(logger, target.name, `Rate limited, retry after ${waitSeconds}s`, 'yellow', {
                    attempt,
                    status: response.status,
                    retryAfter: waitSeconds
                });
                return { type: 'wait', waitSeconds };
            }

            const fatalReason =
                response.status === 401 ? 'unauthorized'
                    : response.status === 403 ? 'forbidden'
                        : response.status === 404 ? 'not_found'
                            : attempt === MAX_SEND_ATTEMPTS ? 'exhausted'
                                : null;
            const shouldStop = fatalReason !== null;
            emitLog(logger, target.name, `HTTP ${response.status}: ${stringifyBody(body)}`, shouldStop ? 'red' : 'yellow', {
                attempt,
                code: getResponseCode(body),
                status: response.status,
                fatal: shouldStop
            });

            if (response.status === 401) {
                coordinator?.abort('HTTP 401 received. Stopping all workers because the token appears invalid or expired.');
            }

            if (shouldStop) {
                return { type: 'fatal', reason: fatalReason };
            }
        } catch (error) {
            if (error instanceof SendAbortError) {
                return { type: 'fatal', reason: 'aborted' };
            }

            const message = error instanceof Error ? error.message : String(error);
            const isFatal = attempt === MAX_SEND_ATTEMPTS;

            emitLog(logger, target.name, `Error: ${message}`, isFatal ? 'red' : 'yellow', {
                attempt,
                fatal: isFatal
            });

            if (isFatal) {
                return { type: 'fatal', reason: 'exhausted' };
            }
        }

        const completedBackoff = await sleepWithAbort(getBackoffDelayMs(attempt, random), sleep, coordinator, lifecycle);
        if (!completedBackoff) {
            return { type: 'fatal', reason: 'aborted' };
        }
    }

    return { type: 'fatal', reason: 'exhausted' };
}

export async function runChannel(options: RunChannelOptions): Promise<void> {
    const {
        target,
        numMessages,
        baseWaitSeconds,
        marginSeconds,
        token,
        userAgent,
        messageGroups,
        fetchImpl,
        sleep = defaultSleep,
        random = Math.random,
        now = () => new Date(),
        logger = defaultLogger,
        coordinator,
        requestTimeoutMs,
        maxRateLimitWaits = DEFAULT_MAX_RATE_LIMIT_WAITS,
        lifecycle
    } = options;

    if (coordinator?.isAborted() || lifecycle?.isStopping()) {
        emitLog(logger, target.name, coordinator?.getAbortReason() ?? lifecycle?.getStopReason() ?? 'Stopping worker because sending was aborted globally.', 'yellow');
        return;
    }

    emitLog(logger, target.name, 'Started.', 'green', { group: target.messageGroup });
    lifecycle?.onChannelEvent?.(target, 'started');

    const messages = messageGroups[target.messageGroup];
    if (!messages || messages.length === 0) {
        emitLog(logger, target.name, 'No messages found for configured group. Skipping channel.', 'red', { group: target.messageGroup });
        lifecycle?.onChannelEvent?.(target, 'failed');
        return;
    }

    let sentCount = 0;
    const sentCache = new Set<string>();
    let consecutiveRateLimitWaits = 0;
    let sentToday = 0;
    const maxSendsPerDay = target.schedule?.maxSendsPerDay ?? null;
    const intervalSeconds = target.schedule?.intervalSeconds ?? baseWaitSeconds;
    const marginForChannel = target.schedule?.randomMarginSeconds ?? marginSeconds;
    const cooldownWindowSize = target.schedule?.cooldownWindowSize ?? 3;

    while (numMessages === 0 || sentCount < numMessages) {
        if (coordinator?.isAborted() || lifecycle?.isStopping()) {
            emitLog(logger, target.name, coordinator?.getAbortReason() ?? lifecycle?.getStopReason() ?? 'Stopping worker because sending was aborted globally.', 'yellow');
            lifecycle?.onChannelEvent?.(target, 'failed');
            return;
        }

        if (maxSendsPerDay !== null && sentToday >= maxSendsPerDay) {
            emitLog(logger, target.name, `Max sends per day reached (${maxSendsPerDay}). Stopping worker.`, 'yellow');
            lifecycle?.onChannelEvent?.(target, 'completed');
            return;
        }

        const quietHoursDelayMs = getQuietHoursDelayMs(target, now());
        if (quietHoursDelayMs > 0) {
            emitLog(logger, target.name, `Inside quiet hours. Waiting ${Math.ceil(quietHoursDelayMs / 60000)} minute(s) before the next send.`, 'yellow');
            const completedQuietWait = await sleepWithAbort(quietHoursDelayMs, sleep, coordinator, lifecycle);
            if (!completedQuietWait) {
                emitLog(logger, target.name, coordinator?.getAbortReason() ?? lifecycle?.getStopReason() ?? 'Stopping worker because sending was aborted globally.', 'yellow');
                lifecycle?.onChannelEvent?.(target, 'failed');
                return;
            }
            continue;
        }

        const rawMessage = pickNextMessage(
            messages,
            sentCache,
            random,
            (lifecycle?.getRecentMessages?.(target) ?? []).slice(-cooldownWindowSize)
        );
        const message = renderMessageTemplate(rawMessage, { channel: target });

        while (true) {
            const result = await sendDiscordMessage(target, message, token, userAgent, {
                fetchImpl,
                sleep,
                random,
                coordinator,
                requestTimeoutMs,
                logger,
                lifecycle
            });

            if (result.type === 'success') {
                consecutiveRateLimitWaits = 0;
                sentCount += 1;
                sentToday += 1;
                const counter = numMessages === 0 ? 'Infinite' : `${sentCount}/${numMessages}`;
                emitLog(logger, target.name, 'Message sent', 'cyan', { counter });
                lifecycle?.onMessageSent?.(target, message);
                break;
            }

            if (result.type === 'wait') {
                consecutiveRateLimitWaits += 1;
                if (consecutiveRateLimitWaits > maxRateLimitWaits) {
                    emitLog(logger, target.name, `Stopping worker after ${consecutiveRateLimitWaits} consecutive rate limits.`, 'red');
                    lifecycle?.onChannelEvent?.(target, 'failed');
                    return;
                }

                emitLog(logger, target.name, `Rate Limit! Waiting ${result.waitSeconds}s...`, 'yellow');
                const completedWait = await sleepWithAbort((result.waitSeconds + 0.5) * 1000, sleep, coordinator, lifecycle);
                if (!completedWait) {
                    emitLog(logger, target.name, coordinator?.getAbortReason() ?? lifecycle?.getStopReason() ?? 'Stopping worker because sending was aborted globally.', 'yellow');
                    lifecycle?.onChannelEvent?.(target, 'failed');
                    return;
                }
                continue;
            }

            if (result.reason === 'aborted') {
                emitLog(logger, target.name, coordinator?.getAbortReason() ?? lifecycle?.getStopReason() ?? 'Stopping worker because sending was aborted globally.', 'yellow');
                lifecycle?.onChannelEvent?.(target, 'failed');
                return;
            }

            if (result.reason === 'unauthorized') {
                emitLog(logger, target.name, 'Stopping all workers after HTTP 401 indicated an invalid or expired token.', 'red');
                lifecycle?.onChannelEvent?.(target, 'failed');
                return;
            }

            emitLog(logger, target.name, 'Stopping worker after repeated or fatal send failures.', 'red');
            lifecycle?.onChannelEvent?.(target, 'failed');
            return;
        }

        if (numMessages !== 0 && sentCount >= numMessages) {
            break;
        }

        const waitMs = (intervalSeconds + random() * marginForChannel) * 1000;
        const completedWait = await sleepWithAbort(waitMs, sleep, coordinator, lifecycle);
        if (!completedWait) {
            emitLog(logger, target.name, coordinator?.getAbortReason() ?? lifecycle?.getStopReason() ?? 'Stopping worker because sending was aborted globally.', 'yellow');
            lifecycle?.onChannelEvent?.(target, 'failed');
            return;
        }
    }

    emitLog(logger, target.name, 'Finished.', 'green');
    lifecycle?.onChannelEvent?.(target, 'completed');
}
