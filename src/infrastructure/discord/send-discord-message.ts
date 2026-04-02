import type { AppChannel } from '../../domain/config/types';
import { getBackoffDelayMs } from '../../domain/session/suppression';
import { defaultLogger, emitLog } from '../../utils/logger';
import { sleepWithAbort } from '../../application/session/pacing-coordinator';
import {
    defaultSleep,
    RequestTimeoutError,
    SendAbortError,
    type SendOutcome,
    type SenderDependencies
} from '../../application/session/sender-types';

const API_BASE = 'https://discord.com/api/v10';
const MAX_SEND_ATTEMPTS = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

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
    fetchImpl: SenderDependencies['fetchImpl'],
    url: string,
    init: RequestInit,
    timeoutMs: number,
    abortSignal?: AbortSignal
): Promise<Response> {
    const controller = new AbortController();
    const abortListener = () => {
        controller.abort(abortSignal?.reason);
    };
    abortSignal?.addEventListener('abort', abortListener, { once: true });
    const fetchPromise = (fetchImpl ?? fetch)(url, {
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
        abortSignal?.removeEventListener('abort', abortListener);
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
    const sleep = dependencies.sleep ?? defaultSleep;
    const random = dependencies.random ?? Math.random;
    const coordinator = dependencies.coordinator;
    const requestTimeoutMs = dependencies.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const lifecycle = dependencies.lifecycle;
    const logger = dependencies.logger ?? defaultLogger;
    const abortSignal = coordinator?.getAbortSignal();

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
            const request = () => fetchWithTimeout(dependencies.fetchImpl, `${API_BASE}/channels/${target.id}/messages`, {
                method: 'POST',
                headers: {
                    Authorization: token,
                    'User-Agent': userAgent,
                    'Content-Type': 'application/json',
                    Referer: target.referrer
                },
                body: JSON.stringify({ content, tts: false })
            }, requestTimeoutMs, abortSignal);
            const response = coordinator
                ? await coordinator.scheduleRequest(sleep, request)
                : await request();

            if (response.ok) {
                coordinator?.recordSuccess();
                return { type: 'success' };
            }

            const body = await readResponseBody(response);
            if (response.status === 429) {
                const waitSeconds = getRetryAfterSeconds(body);
                const pacing = coordinator?.recordRateLimit(waitSeconds);
                emitLog(logger, target.name, `Rate limited, retry after ${waitSeconds}s`, 'yellow', {
                    channelId: target.id,
                    event: 'rate_limited',
                    attempt,
                    status: response.status,
                    retryAfter: waitSeconds,
                    pacingMs: pacing?.currentRequestIntervalMs
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
                channelId: target.id,
                event: 'http_error',
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

            if (coordinator?.isAborted() || lifecycle?.isStopping()) {
                return { type: 'fatal', reason: 'aborted' };
            }

            const message = error instanceof Error ? error.message : String(error);
            const isFatal = attempt === MAX_SEND_ATTEMPTS;

            emitLog(logger, target.name, `Error: ${message}`, isFatal ? 'red' : 'yellow', {
                channelId: target.id,
                event: 'request_error',
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
