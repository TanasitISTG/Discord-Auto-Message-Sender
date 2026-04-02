import type { AppConfig } from '@/lib/desktop';

type AppChannel = AppConfig['channels'][number];
type ChannelSchedule = NonNullable<AppChannel['schedule']>;

function buildDefaultReferrer(channelId: string): string {
    return `https://discord.com/channels/@me/${channelId}`;
}

function cloneConfig(config: AppConfig): AppConfig {
    return {
        userAgent: config.userAgent,
        channels: config.channels.map((channel) => ({
            ...channel,
            ...(channel.schedule
                ? {
                      schedule: {
                          ...channel.schedule,
                          ...(channel.schedule.quietHours
                              ? {
                                    quietHours: {
                                        ...channel.schedule.quietHours,
                                    },
                                }
                              : {}),
                      },
                  }
                : {}),
        })),
        messageGroups: Object.fromEntries(
            Object.entries(config.messageGroups).map(([name, messages]) => [name, [...messages]]),
        ),
    };
}

function ensureGroupExists(config: AppConfig, groupName: string) {
    if (!config.messageGroups[groupName]) {
        throw new Error(`Unknown message group '${groupName}'.`);
    }
}

function getScheduleDefaults(existing?: ChannelSchedule | null): ChannelSchedule {
    return {
        intervalSeconds: existing?.intervalSeconds ?? 5,
        randomMarginSeconds: existing?.randomMarginSeconds ?? 2,
        timezone: existing?.timezone ?? 'UTC',
        maxSendsPerDay: existing?.maxSendsPerDay ?? null,
        cooldownWindowSize: existing?.cooldownWindowSize ?? 3,
        quietHours: existing?.quietHours ?? null,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidTimeZone(value: string): boolean {
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

function isValidClockTime(value: string): boolean {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) {
        return false;
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
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

function normalizeImportedConfig(value: unknown): AppConfig {
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
        }),
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
            ? (() => {
                  const maxSendsPerDay = readOptionalNumber(
                      rawSchedule.maxSendsPerDay,
                      `channels[${index}].schedule.maxSendsPerDay`,
                  );
                  const cooldownWindowSize = readOptionalNumber(
                      rawSchedule.cooldownWindowSize,
                      `channels[${index}].schedule.cooldownWindowSize`,
                  );
                  return {
                      intervalSeconds: readRequiredNumber(
                          rawSchedule.intervalSeconds,
                          `channels[${index}].schedule.intervalSeconds`,
                      ),
                      randomMarginSeconds: readRequiredNumber(
                          rawSchedule.randomMarginSeconds,
                          `channels[${index}].schedule.randomMarginSeconds`,
                      ),
                      ...(typeof rawSchedule.timezone === 'string' ? { timezone: rawSchedule.timezone } : {}),
                      ...(maxSendsPerDay !== null ? { maxSendsPerDay } : {}),
                      ...(cooldownWindowSize !== null ? { cooldownWindowSize: cooldownWindowSize ?? undefined } : {}),
                      ...(isRecord(rawSchedule.quietHours)
                          ? {
                                quietHours: {
                                    start: readRequiredString(
                                        rawSchedule.quietHours.start,
                                        `channels[${index}].schedule.quietHours.start`,
                                    ),
                                    end: readRequiredString(
                                        rawSchedule.quietHours.end,
                                        `channels[${index}].schedule.quietHours.end`,
                                    ),
                                },
                            }
                          : {}),
                  };
              })()
            : undefined;

        return {
            name: readRequiredString(channel.name, `channels[${index}].name`),
            id: readRequiredString(channel.id, `channels[${index}].id`),
            referrer:
                typeof channel.referrer === 'string' && channel.referrer.trim().length > 0
                    ? channel.referrer
                    : buildDefaultReferrer(readRequiredString(channel.id, `channels[${index}].id`)),
            messageGroup: readRequiredString(channel.messageGroup, `channels[${index}].messageGroup`),
            ...(schedule ? { schedule } : {}),
        };
    });

    return {
        userAgent: readRequiredString(value.userAgent, 'userAgent'),
        channels,
        messageGroups,
    };
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
                errors.push(
                    `Message group '${groupName}' contains a message longer than Discord's 2000 character limit.`,
                );
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
                errors.push(
                    `Channel '${channel.name || channel.id}' has an invalid timezone '${channel.schedule.timezone}'.`,
                );
            }
            if (channel.schedule.quietHours) {
                if (
                    !isValidClockTime(channel.schedule.quietHours.start) ||
                    !isValidClockTime(channel.schedule.quietHours.end)
                ) {
                    errors.push(`Channel '${channel.name || channel.id}' must use valid 24-hour HH:MM quiet hours.`);
                }
            }
        }
    });

    return [...new Set(errors)];
}

export function updateUserAgent(config: AppConfig, userAgent: string): AppConfig {
    return {
        ...cloneConfig(config),
        userAgent,
    };
}

export function addChannel(
    config: AppConfig,
    channel: Omit<AppChannel, 'referrer'> & { referrer?: string },
): AppConfig {
    const next = cloneConfig(config);
    next.channels.push({
        ...channel,
        referrer: channel.referrer ?? buildDefaultReferrer(channel.id),
        ...(channel.schedule ? { schedule: getScheduleDefaults(channel.schedule) } : {}),
    });
    return next;
}

export function updateChannel(config: AppConfig, channelId: string, patch: Partial<AppChannel>): AppConfig {
    const next = cloneConfig(config);
    const index = next.channels.findIndex((channel) => channel.id === channelId);
    if (index === -1) {
        throw new Error(`Channel '${channelId}' not found.`);
    }

    next.channels[index] = {
        ...next.channels[index],
        ...patch,
        ...(patch.schedule ? { schedule: getScheduleDefaults(patch.schedule) } : {}),
    };

    return next;
}

export function updateChannelSchedule(
    config: AppConfig,
    channelId: string,
    patch: Partial<ChannelSchedule>,
): AppConfig {
    const next = cloneConfig(config);
    const index = next.channels.findIndex((channel) => channel.id === channelId);
    if (index === -1) {
        throw new Error(`Channel '${channelId}' not found.`);
    }

    next.channels[index] = {
        ...next.channels[index],
        schedule: {
            ...getScheduleDefaults(next.channels[index].schedule),
            ...patch,
        },
    };

    return next;
}

export function removeChannels(config: AppConfig, channelIds: string[]): AppConfig {
    const next = cloneConfig(config);
    next.channels = next.channels.filter((channel) => !channelIds.includes(channel.id));
    return next;
}

export function createMessageGroup(
    config: AppConfig,
    groupName: string,
    initialMessages: string[] = ['New Message'],
): AppConfig {
    const next = cloneConfig(config);
    if (next.messageGroups[groupName]) {
        throw new Error(`Message group '${groupName}' already exists.`);
    }

    next.messageGroups[groupName] = [...initialMessages];
    return next;
}

export function renameMessageGroup(config: AppConfig, previousName: string, nextName: string): AppConfig {
    const next = cloneConfig(config);
    ensureGroupExists(next, previousName);
    if (next.messageGroups[nextName]) {
        throw new Error(`Message group '${nextName}' already exists.`);
    }

    next.messageGroups[nextName] = next.messageGroups[previousName];
    delete next.messageGroups[previousName];
    next.channels = next.channels.map((channel) =>
        channel.messageGroup === previousName ? { ...channel, messageGroup: nextName } : channel,
    );
    return next;
}

export function cloneMessageGroup(config: AppConfig, sourceName: string, cloneName: string): AppConfig {
    const next = cloneConfig(config);
    ensureGroupExists(next, sourceName);
    if (next.messageGroups[cloneName]) {
        throw new Error(`Message group '${cloneName}' already exists.`);
    }

    next.messageGroups[cloneName] = [...next.messageGroups[sourceName]];
    return next;
}

export function deleteMessageGroup(config: AppConfig, groupName: string): AppConfig {
    const next = cloneConfig(config);
    ensureGroupExists(next, groupName);

    const fallbackGroup = Object.keys(next.messageGroups).find((name) => name !== groupName);
    if (!fallbackGroup) {
        throw new Error('Keep at least one message group.');
    }

    delete next.messageGroups[groupName];
    next.channels = next.channels.map((channel) =>
        channel.messageGroup === groupName ? { ...channel, messageGroup: fallbackGroup } : channel,
    );
    return next;
}

export function addMessageToGroup(config: AppConfig, groupName: string, message: string = 'New message'): AppConfig {
    const next = cloneConfig(config);
    ensureGroupExists(next, groupName);
    next.messageGroups[groupName] = [...next.messageGroups[groupName], message];
    return next;
}

export function updateMessageInGroup(config: AppConfig, groupName: string, index: number, value: string): AppConfig {
    const next = cloneConfig(config);
    ensureGroupExists(next, groupName);
    next.messageGroups[groupName] = next.messageGroups[groupName].map((message, messageIndex) =>
        messageIndex === index ? value : message,
    );
    return next;
}

export function removeMessageFromGroup(config: AppConfig, groupName: string, index: number): AppConfig {
    const next = cloneConfig(config);
    ensureGroupExists(next, groupName);
    if (next.messageGroups[groupName].length <= 1) {
        throw new Error('Each message group must contain at least one message.');
    }

    next.messageGroups[groupName] = next.messageGroups[groupName].filter((_, messageIndex) => messageIndex !== index);
    return next;
}

export function reorderGroupMessages(
    config: AppConfig,
    groupName: string,
    fromIndex: number,
    toIndex: number,
): AppConfig {
    const next = cloneConfig(config);
    ensureGroupExists(next, groupName);
    const messages = [...next.messageGroups[groupName]];
    if (
        !Number.isInteger(fromIndex) ||
        !Number.isInteger(toIndex) ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= messages.length ||
        toIndex >= messages.length
    ) {
        throw new Error(`Message index out of range for group '${groupName}'.`);
    }
    const [message] = messages.splice(fromIndex, 1);
    messages.splice(toIndex, 0, message);
    next.messageGroups[groupName] = messages;
    return next;
}

export function importConfig(config: unknown): AppConfig {
    return normalizeImportedConfig(config);
}
