import { AppChannel, MessageGroups } from '../types';
import { log } from '../utils/logger';

const API_BASE = 'https://discord.com/api/v10';
const MAX_SEND_ATTEMPTS = 3;

type FetchImpl = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;
type RandomFn = () => number;

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export type SendOutcome =
    | { type: 'success' }
    | { type: 'wait'; waitSeconds: number }
    | { type: 'fatal' };

export interface SenderDependencies {
    fetchImpl?: FetchImpl;
    sleep?: SleepFn;
    random?: RandomFn;
}

export interface RunChannelOptions extends SenderDependencies {
    target: AppChannel;
    numMessages: number;
    baseWaitSeconds: number;
    marginSeconds: number;
    token: string;
    userAgent: string;
    messageGroups: MessageGroups;
}

export function getBackoffDelayMs(attempt: number, random: RandomFn = Math.random): number {
    const baseDelay = 500 * Math.pow(2, attempt - 1);
    const jitter = Math.floor(random() * 250);
    return baseDelay + jitter;
}

export function pickNextMessage(messages: string[], sentCache: Set<string>, random: RandomFn = Math.random): string {
    if (messages.length === 0) {
        throw new Error('Cannot pick a message from an empty group.');
    }

    const uniqueMessageCount = new Set(messages).size;

    if (sentCache.size >= uniqueMessageCount) {
        sentCache.clear();
    }

    const availableMessages = messages.filter((message) => !sentCache.has(message));

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

    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
        try {
            const response = await fetchImpl(`${API_BASE}/channels/${target.id}/messages`, {
                method: 'POST',
                headers: {
                    Authorization: token,
                    'User-Agent': userAgent,
                    'Content-Type': 'application/json',
                    Referer: target.referrer
                },
                body: JSON.stringify({ content, tts: false })
            });

            if (response.ok) {
                return { type: 'success' };
            }

            const body = await readResponseBody(response);
            if (response.status === 429) {
                const waitSeconds = getRetryAfterSeconds(body);
                log(target.name, `Rate limited, retry after ${waitSeconds}s`, 'yellow', {
                    attempt,
                    status: response.status,
                    retryAfter: waitSeconds
                });
                return { type: 'wait', waitSeconds };
            }

            const shouldStop = response.status === 401 || response.status === 403 || response.status === 404 || attempt === MAX_SEND_ATTEMPTS;
            log(target.name, `HTTP ${response.status}: ${stringifyBody(body)}`, shouldStop ? 'red' : 'yellow', {
                attempt,
                code: getResponseCode(body),
                status: response.status,
                fatal: shouldStop
            });

            if (shouldStop) {
                return { type: 'fatal' };
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const isFatal = attempt === MAX_SEND_ATTEMPTS;

            log(target.name, `Error: ${message}`, isFatal ? 'red' : 'yellow', {
                attempt,
                fatal: isFatal
            });

            if (isFatal) {
                return { type: 'fatal' };
            }
        }

        await sleep(getBackoffDelayMs(attempt, random));
    }

    return { type: 'fatal' };
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
        random = Math.random
    } = options;

    log(target.name, 'Started.', 'green', { group: target.messageGroup });

    const messages = messageGroups[target.messageGroup];
    if (!messages || messages.length === 0) {
        log(target.name, 'No messages found for configured group. Skipping channel.', 'red', { group: target.messageGroup });
        return;
    }

    let sentCount = 0;
    const sentCache = new Set<string>();

    while (numMessages === 0 || sentCount < numMessages) {
        const message = pickNextMessage(messages, sentCache, random);

        while (true) {
            const result = await sendDiscordMessage(target, message, token, userAgent, {
                fetchImpl,
                sleep,
                random
            });

            if (result.type === 'success') {
                sentCount += 1;
                const counter = numMessages === 0 ? 'Infinite' : `${sentCount}/${numMessages}`;
                log(target.name, 'Message sent', 'cyan', { counter });
                break;
            }

            if (result.type === 'wait') {
                log(target.name, `Rate Limit! Waiting ${result.waitSeconds}s...`, 'yellow');
                await sleep((result.waitSeconds + 0.5) * 1000);
                continue;
            }

            log(target.name, 'Stopping worker after repeated or fatal send failures.', 'red');
            return;
        }

        if (numMessages !== 0 && sentCount >= numMessages) {
            break;
        }

        const waitMs = (baseWaitSeconds + random() * marginSeconds) * 1000;
        await sleep(waitMs);
    }

    log(target.name, 'Finished.', 'green');
}
