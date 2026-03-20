import axios from 'axios';
import { Channel } from '../types';
import { log } from '../utils/logger';

const API_BASE = 'https://discord.com/api/v10';
const MAX_SEND_ATTEMPTS = 3;

export interface ChannelTarget {
    id: string;
    name: string;
    referrer: string;
    messageGroup: string;
}

export interface SendResult {
    success: boolean;
    fatal: boolean;
    wait?: number;
}

function getBackoffDelayMs(attempt: number): number {
    const baseDelay = 500 * Math.pow(2, attempt - 1);
    const jitter = Math.floor(Math.random() * 250);
    return baseDelay + jitter;
}

export function buildChannelTargets(channels: Channel[]): ChannelTarget[] {
    return channels.map(ch => ({
        id: ch.id,
        name: ch.name,
        referrer: ch.referrer || `https://discord.com/channels/@me/${ch.id}`,
        messageGroup: ch.message_group ?? 'default'
    }));
}

export async function sendMessage(
    target: ChannelTarget,
    content: string,
    token: string,
    userAgent: string
): Promise<SendResult> {
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
        try {
            await axios.post(
                `${API_BASE}/channels/${target.id}/messages`,
                { content, tts: false },
                {
                    headers: {
                        'Authorization': token,
                        'User-Agent': userAgent,
                        'Content-Type': 'application/json',
                        'Referer': target.referrer
                    }
                }
            );
            return { success: true, fatal: false };
        } catch (error: unknown) {
            if (axios.isAxiosError(error) && error.response) {
                const status = error.response.status;
                const code = error.response.data?.code;

                if (status === 429) {
                    const retryAfter = error.response.data?.retry_after || 5;
                    log(target.name, `Rate limited, retry after ${retryAfter}s`, 'yellow', {
                        attempt,
                        status,
                        retryAfter
                    });
                    return { success: false, fatal: false, wait: retryAfter };
                }

                const isFatal = status === 401 || status === 403 || status === 404;
                const shouldStop = isFatal || attempt === MAX_SEND_ATTEMPTS;

                log(target.name, `HTTP ${status}: ${JSON.stringify(error.response.data)}`, shouldStop ? 'red' : 'yellow', {
                    attempt,
                    code,
                    status,
                    fatal: shouldStop
                });

                if (shouldStop) {
                    return { success: false, fatal: true };
                }
            } else {
                const msg = error instanceof Error ? error.message : String(error);
                log(target.name, `Error: ${msg}`, attempt === MAX_SEND_ATTEMPTS ? 'red' : 'yellow', {
                    attempt,
                    fatal: attempt === MAX_SEND_ATTEMPTS
                });

                if (attempt === MAX_SEND_ATTEMPTS) {
                    return { success: false, fatal: true };
                }
            }

            const delay = getBackoffDelayMs(attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }

    return { success: false, fatal: true };
}
