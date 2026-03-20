import { once } from 'events';
import {
    Channel,
    Client,
    DiscordAPIError,
    Events,
    GatewayIntentBits,
    TextBasedChannel
} from 'discord.js';
import { Config } from '../types';
import { log } from '../utils/logger';

const MAX_SEND_ATTEMPTS = 3;
const FATAL_DISCORD_ERROR_CODES = new Set([10003, 50001, 50013, 50035]);

type SendableChannel = TextBasedChannel & {
    send: (options: { content: string }) => Promise<unknown>;
};

export interface ResolvedChannelTarget {
    id: string;
    name: string;
    messageGroup: string;
    channel: SendableChannel;
}

interface SendFailure {
    code?: number;
    fatal: boolean;
    status?: number;
    summary: string;
}

function resolveSendableChannel(channel: Channel | null): SendableChannel | null {
    if (!channel?.isTextBased() || !('send' in channel) || typeof channel.send !== 'function') {
        return null;
    }

    return channel as SendableChannel;
}

function classifySendFailure(error: unknown): SendFailure {
    if (error instanceof DiscordAPIError) {
        const code = typeof error.code === 'number' ? error.code : undefined;

        if (code === 10003) {
            return { code, fatal: true, status: error.status, summary: 'unknown channel' };
        }
        if (code === 50001) {
            return { code, fatal: true, status: error.status, summary: 'missing access' };
        }
        if (code === 50013) {
            return { code, fatal: true, status: error.status, summary: 'missing permissions' };
        }
        if (code === 50035) {
            return { code, fatal: true, status: error.status, summary: 'invalid request' };
        }
        if (error.status === 429) {
            return { code, fatal: false, status: error.status, summary: 'rate limited' };
        }
        if (error.status >= 500) {
            return { code, fatal: false, status: error.status, summary: 'discord service error' };
        }

        return {
            code,
            fatal: code !== undefined && FATAL_DISCORD_ERROR_CODES.has(code),
            status: error.status,
            summary: 'discord api error'
        };
    }

    if (error instanceof Error) {
        return { fatal: false, summary: error.name || 'runtime error' };
    }

    return { fatal: false, summary: 'unexpected runtime error' };
}

function getBackoffDelayMs(attempt: number): number {
    const baseDelay = 500 * Math.pow(2, attempt - 1);
    const jitter = Math.floor(Math.random() * 250);
    return baseDelay + jitter;
}

export async function createDiscordClient(token: string): Promise<Client<true>> {
    const client = new Client({
        intents: [GatewayIntentBits.Guilds]
    });

    const ready = once(client, Events.ClientReady);

    try {
        await client.login(token);
        await ready;
        return client as Client<true>;
    } catch (error) {
        client.destroy();
        throw new Error('Failed to authenticate with Discord. Check DISCORD_BOT_TOKEN and bot access.');
    }
}

export async function resolveConfiguredChannels(client: Client<true>, config: Config): Promise<ResolvedChannelTarget[]> {
    const resolved: ResolvedChannelTarget[] = [];

    for (const channelConfig of config.channels) {
        const fetchedChannel = await client.channels.fetch(channelConfig.id);
        const channel = resolveSendableChannel(fetchedChannel);

        if (!channel) {
            throw new Error(`Configured channel '${channelConfig.name}' is missing or does not support text messages.`);
        }

        resolved.push({
            id: channelConfig.id,
            name: channelConfig.name,
            messageGroup: channelConfig.message_group ?? 'default',
            channel
        });
    }

    return resolved;
}

export async function sendMessage(target: ResolvedChannelTarget, content: string): Promise<{ fatal: boolean; success: boolean }> {
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
        try {
            await target.channel.send({ content });
            return { success: true, fatal: false };
        } catch (error) {
            const failure = classifySendFailure(error);
            const shouldStop = failure.fatal || attempt === MAX_SEND_ATTEMPTS;

            log(target.name, 'Send attempt failed', shouldStop ? 'red' : 'yellow', {
                attempt,
                code: failure.code,
                fatal: shouldStop,
                status: failure.status,
                summary: failure.summary
            });

            if (shouldStop) {
                return { success: false, fatal: true };
            }

            const delay = getBackoffDelayMs(attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }

    return { success: false, fatal: true };
}
