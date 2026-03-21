import { parseAppConfig } from '../config/schema';
import { AppConfig } from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isValidTimeZone(value: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
    } catch {
        return false;
    }
}

function readRequiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${field} must be a non-empty string.`);
    }

    return value;
}

function readOptionalNumber(value: unknown, field: string): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${field} must be a valid number.`);
    }

    return value;
}

function readRequiredNumber(value: unknown, field: string): number {
    const parsed = readOptionalNumber(value, field);
    if (parsed === null) {
        throw new Error(`${field} must be provided.`);
    }

    return parsed;
}

export function validateAppConfig(config: AppConfig): string[] {
    const errors: string[] = [];
    const groupNames = new Set(Object.keys(config.messageGroups));
    const channelIds = new Set<string>();

    if (!config.userAgent.trim()) {
        errors.push('User-Agent is required.');
    }

    if (config.channels.length === 0) {
        errors.push('Add at least one channel before saving.');
    }

    if (groupNames.size === 0) {
        errors.push('At least one message group is required.');
    }

    for (const [groupName, messages] of Object.entries(config.messageGroups)) {
        if (!groupName.trim()) {
            errors.push('Message group names cannot be blank.');
        }

        if (messages.length === 0) {
            errors.push(`Message group '${groupName}' must contain at least one message.`);
        }

        for (const message of messages) {
            if (!message.trim()) {
                errors.push(`Message group '${groupName}' contains an empty message.`);
            }

            if (message.length > 2000) {
                errors.push(`Message group '${groupName}' contains a message longer than Discord's 2000 character limit.`);
            }
        }
    }

    config.channels.forEach((channel, index) => {
        if (!channel.name.trim()) {
            errors.push(`Channel ${index + 1} is missing a name.`);
        }

        if (!/^\d{17,20}$/.test(channel.id.trim())) {
            errors.push(`Channel '${channel.name || `#${index + 1}`}' must use a valid Discord snowflake ID.`);
        }

        if (channelIds.has(channel.id)) {
            errors.push(`Channel ID '${channel.id}' is duplicated.`);
        }

        channelIds.add(channel.id);

        if (!channel.referrer.trim()) {
            errors.push(`Channel '${channel.name || channel.id}' is missing a referrer URL.`);
        }

        if (!groupNames.has(channel.messageGroup)) {
            errors.push(`Channel '${channel.name || channel.id}' references missing group '${channel.messageGroup}'.`);
        }

        if (channel.schedule) {
            if (channel.schedule.intervalSeconds < 0) {
                errors.push(`Channel '${channel.name || channel.id}' has a negative interval.`);
            }
            if (channel.schedule.randomMarginSeconds < 0) {
                errors.push(`Channel '${channel.name || channel.id}' has a negative random margin.`);
            }
            if (channel.schedule.timezone && !isValidTimeZone(channel.schedule.timezone)) {
                errors.push(`Channel '${channel.name || channel.id}' has an invalid timezone '${channel.schedule.timezone}'.`);
            }
            if (channel.schedule.quietHours) {
                if (!/^\d{2}:\d{2}$/.test(channel.schedule.quietHours.start) || !/^\d{2}:\d{2}$/.test(channel.schedule.quietHours.end)) {
                    errors.push(`Channel '${channel.name || channel.id}' must use HH:MM quiet hours.`);
                }
            }
        }
    });

    return [...new Set(errors)];
}

export function normalizeImportedConfig(value: unknown): AppConfig {
    if (!isRecord(value)) {
        throw new Error('Imported config must be a JSON object.');
    }

    const rawGroups = value.messageGroups;
    if (!isRecord(rawGroups)) {
        throw new Error('messageGroups must be an object keyed by group name.');
    }

    const messageGroups = Object.fromEntries(
        Object.entries(rawGroups).map(([groupName, messages]) => {
            if (!Array.isArray(messages) || messages.some((message) => typeof message !== 'string')) {
                throw new Error(`Message group '${groupName}' must contain only strings.`);
            }

            return [groupName, messages];
        })
    );

    const rawChannels = value.channels;
    if (!Array.isArray(rawChannels)) {
        throw new Error('channels must be an array.');
    }

    const channels = rawChannels.map((channel, index) => {
        if (!isRecord(channel)) {
            throw new Error(`Channel ${index + 1} must be an object.`);
        }

        const rawSchedule = channel.schedule;
        const schedule = isRecord(rawSchedule)
            ? {
                intervalSeconds: readRequiredNumber(rawSchedule.intervalSeconds, `channels[${index}].schedule.intervalSeconds`),
                randomMarginSeconds: readRequiredNumber(rawSchedule.randomMarginSeconds, `channels[${index}].schedule.randomMarginSeconds`),
                ...(typeof rawSchedule.timezone === 'string' ? { timezone: rawSchedule.timezone } : {}),
                ...(readOptionalNumber(rawSchedule.maxSendsPerDay, `channels[${index}].schedule.maxSendsPerDay`) !== null
                    ? { maxSendsPerDay: readOptionalNumber(rawSchedule.maxSendsPerDay, `channels[${index}].schedule.maxSendsPerDay`) }
                    : {}),
                ...(readOptionalNumber(rawSchedule.cooldownWindowSize, `channels[${index}].schedule.cooldownWindowSize`) !== null
                    ? { cooldownWindowSize: readOptionalNumber(rawSchedule.cooldownWindowSize, `channels[${index}].schedule.cooldownWindowSize`) ?? undefined }
                    : {}),
                ...(isRecord(rawSchedule.quietHours)
                    ? {
                        quietHours: {
                            start: readRequiredString(rawSchedule.quietHours.start, `channels[${index}].schedule.quietHours.start`),
                            end: readRequiredString(rawSchedule.quietHours.end, `channels[${index}].schedule.quietHours.end`)
                        }
                    }
                    : {})
            }
            : undefined;

        return {
            name: readRequiredString(channel.name, `channels[${index}].name`),
            id: readRequiredString(channel.id, `channels[${index}].id`),
            referrer: readRequiredString(channel.referrer, `channels[${index}].referrer`),
            messageGroup: readRequiredString(channel.messageGroup, `channels[${index}].messageGroup`),
            ...(schedule ? { schedule } : {})
        };
    });

    return parseAppConfig({
        userAgent: readRequiredString(value.userAgent, 'userAgent'),
        channels,
        messageGroups
    });
}

export function tryNormalizeImportedConfig(value: unknown): { ok: true; config: AppConfig } | { ok: false; error: string } {
    try {
        return {
            ok: true,
            config: normalizeImportedConfig(value)
        };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
