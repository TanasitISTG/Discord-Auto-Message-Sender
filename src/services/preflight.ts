import { AppConfig, ChannelPreflightResult, EnvironmentConfig, PreflightResult } from '../types';
import { parseAppConfig } from '../config/schema';

const API_BASE = 'https://discord.com/api/v10';

export interface PreflightOptions {
    token?: string;
    fetchImpl?: typeof fetch;
    checkAccess?: boolean;
}

function summarizeChannelError(status: number): string {
    switch (status) {
        case 401:
            return 'Unauthorized. Check the Discord token.';
        case 403:
            return 'Forbidden. The token cannot access this channel.';
        case 404:
            return 'Channel not found.';
        default:
            return `HTTP ${status}`;
    }
}

async function verifyChannelAccess(
    config: AppConfig,
    env: Pick<EnvironmentConfig, 'DISCORD_TOKEN'>,
    fetchImpl: typeof fetch
): Promise<ChannelPreflightResult[]> {
    return Promise.all(config.channels.map(async (channel) => {
        try {
            const response = await fetchImpl(`${API_BASE}/channels/${channel.id}`, {
                method: 'GET',
                headers: {
                    Authorization: env.DISCORD_TOKEN,
                    'User-Agent': config.userAgent,
                    Referer: channel.referrer
                }
            });

            if (response.ok) {
                return {
                    channelId: channel.id,
                    channelName: channel.name,
                    ok: true,
                    status: response.status
                };
            }

            return {
                channelId: channel.id,
                channelName: channel.name,
                ok: false,
                reason: summarizeChannelError(response.status),
                status: response.status
            };
        } catch (error) {
            return {
                channelId: channel.id,
                channelName: channel.name,
                ok: false,
                reason: error instanceof Error ? error.message : String(error)
            };
        }
    }));
}

export async function runPreflight(config: AppConfig, options: PreflightOptions = {}): Promise<PreflightResult> {
    const checkedAt = new Date().toISOString();
    const issues: string[] = [];
    let configValid = true;

    try {
        parseAppConfig(config);
    } catch (error) {
        configValid = false;
        issues.push(error instanceof Error ? error.message : 'Configuration validation failed.');
    }

    const tokenPresent = typeof options.token === 'string' && options.token.trim().length > 0;
    if (!tokenPresent) {
        issues.push('DISCORD_TOKEN is missing.');
    }

    const channels = configValid && tokenPresent && options.checkAccess
        ? await verifyChannelAccess(config, { DISCORD_TOKEN: options.token!.trim() }, options.fetchImpl ?? fetch)
        : config.channels.map((channel) => ({
            channelId: channel.id,
            channelName: channel.name,
            ok: false,
            reason: tokenPresent ? 'Access check skipped.' : 'Missing token.'
        }));

    if (channels.some((channel) => !channel.ok && channel.reason !== 'Access check skipped.')) {
        issues.push('One or more channels failed access verification.');
    }

    return {
        ok: configValid && tokenPresent && channels.every((channel) => channel.ok || channel.reason === 'Access check skipped.'),
        checkedAt,
        configValid,
        tokenPresent,
        issues,
        channels
    };
}
