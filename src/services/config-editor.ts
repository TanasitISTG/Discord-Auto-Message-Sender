import { AppChannel, AppConfig } from '../types';
import { buildDefaultReferrer, parseAppConfig } from '../config/schema';

function cloneConfig(config: AppConfig): AppConfig {
    return {
        userAgent: config.userAgent,
        channels: config.channels.map((channel) => ({ ...channel })),
        messageGroups: Object.fromEntries(
            Object.entries(config.messageGroups).map(([name, messages]) => [name, [...messages]])
        )
    };
}

function ensureGroupExists(config: AppConfig, groupName: string) {
    if (!config.messageGroups[groupName]) {
        throw new Error(`Unknown message group '${groupName}'.`);
    }
}

export function updateUserAgent(config: AppConfig, userAgent: string): AppConfig {
    const next = cloneConfig(config);
    next.userAgent = userAgent;
    return parseAppConfig(next);
}

export function addChannel(config: AppConfig, channel: Omit<AppChannel, 'referrer'> & { referrer?: string }): AppConfig {
    const next = cloneConfig(config);
    next.channels.push({
        ...channel,
        referrer: channel.referrer ?? buildDefaultReferrer(channel.id)
    });
    return parseAppConfig(next);
}

export function updateChannel(config: AppConfig, channelId: string, patch: Partial<AppChannel>): AppConfig {
    const next = cloneConfig(config);
    const index = next.channels.findIndex((channel) => channel.id === channelId);
    if (index === -1) {
        throw new Error(`Channel '${channelId}' not found.`);
    }

    next.channels[index] = {
        ...next.channels[index],
        ...patch
    };

    return parseAppConfig(next);
}

export function removeChannels(config: AppConfig, channelIds: string[]): AppConfig {
    const next = cloneConfig(config);
    next.channels = next.channels.filter((channel) => !channelIds.includes(channel.id));
    return parseAppConfig(next);
}

export function createMessageGroup(config: AppConfig, groupName: string, initialMessages: string[] = ['New Message']): AppConfig {
    const next = cloneConfig(config);
    if (next.messageGroups[groupName]) {
        throw new Error(`Message group '${groupName}' already exists.`);
    }
    next.messageGroups[groupName] = [...initialMessages];
    return parseAppConfig(next);
}

export function renameMessageGroup(config: AppConfig, previousName: string, nextName: string): AppConfig {
    const next = cloneConfig(config);
    ensureGroupExists(next, previousName);
    if (next.messageGroups[nextName]) {
        throw new Error(`Message group '${nextName}' already exists.`);
    }

    next.messageGroups[nextName] = next.messageGroups[previousName];
    delete next.messageGroups[previousName];
    next.channels = next.channels.map((channel) => channel.messageGroup === previousName
        ? { ...channel, messageGroup: nextName }
        : channel);
    return parseAppConfig(next);
}

export function cloneMessageGroup(config: AppConfig, sourceName: string, cloneName: string): AppConfig {
    const next = cloneConfig(config);
    ensureGroupExists(next, sourceName);
    if (next.messageGroups[cloneName]) {
        throw new Error(`Message group '${cloneName}' already exists.`);
    }
    next.messageGroups[cloneName] = [...next.messageGroups[sourceName]];
    return parseAppConfig(next);
}

export function setGroupMessages(config: AppConfig, groupName: string, messages: string[]): AppConfig {
    const next = cloneConfig(config);
    ensureGroupExists(next, groupName);
    next.messageGroups[groupName] = [...messages];
    return parseAppConfig(next);
}

export function reorderGroupMessages(config: AppConfig, groupName: string, fromIndex: number, toIndex: number): AppConfig {
    const next = cloneConfig(config);
    ensureGroupExists(next, groupName);
    const messages = [...next.messageGroups[groupName]];
    const [message] = messages.splice(fromIndex, 1);
    messages.splice(toIndex, 0, message);
    next.messageGroups[groupName] = messages;
    return parseAppConfig(next);
}
