import { z } from 'zod';
import {
    AppConfig,
    EnvironmentConfig,
    LegacyConfig,
    LegacyMessages,
    MessageGroups,
    RuntimeOptions
} from '../types';

const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/;
export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
export const DEFAULT_MESSAGE_GROUP = 'default';
export const DEFAULT_MESSAGE = 'Hello from your Discord bot!';

const messageSchema = z.string().trim().min(1, 'Messages cannot be empty').max(2000, 'Discord messages are limited to 2000 characters');
const messageGroupNameSchema = z.string().trim().min(1, 'Group names cannot be empty').max(100, 'Group names are too long');
const messageListSchema = z.array(messageSchema).min(1, 'Each group must contain at least one message');
const normalizedMessageGroupsSchema = z.custom<MessageGroups>(
    (value): value is MessageGroups => value !== null && typeof value === 'object' && !Array.isArray(value),
    'messageGroups must be an object'
);

const appChannelSchema = z.object({
    name: z.string().trim().min(1, 'Channel name is required').max(100, 'Channel name is too long'),
    id: z.string().trim().regex(DISCORD_SNOWFLAKE_REGEX, 'Channel ID must be a valid Discord snowflake'),
    referrer: z.string().trim().url('Referrer must be a valid URL'),
    messageGroup: z.string().trim().min(1, 'Message group name cannot be empty').max(100, 'Message group name is too long')
});

const appConfigBaseSchema = z.object({
    userAgent: z.string().trim().min(1, 'userAgent is required'),
    channels: z.array(appChannelSchema),
    messageGroups: normalizedMessageGroupsSchema
});

export const appConfigSchema = appConfigBaseSchema.superRefine((config, ctx) => {
    const groups = new Set(Object.keys(config.messageGroups));
    const channelIds = new Set<string>();

    for (const [index, channel] of config.channels.entries()) {
        if (!groups.has(channel.messageGroup)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['channels', index, 'messageGroup'],
                message: `Unknown message group '${channel.messageGroup}'`
            });
        }

        if (channelIds.has(channel.id)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['channels', index, 'id'],
                message: `Duplicate channel ID '${channel.id}'`
            });
        } else {
            channelIds.add(channel.id);
        }
    }
});

const rawAppChannelSchema = z.object({
    name: z.string().trim().min(1, 'Channel name is required').max(100, 'Channel name is too long'),
    id: z.string().trim().regex(DISCORD_SNOWFLAKE_REGEX, 'Channel ID must be a valid Discord snowflake'),
    referrer: z.string().trim().url('Referrer must be a valid URL').optional(),
    messageGroup: z.string().trim().min(1, 'Message group name cannot be empty').max(100, 'Message group name is too long').optional()
});

const rawAppConfigSchema = z.object({
    userAgent: z.string().trim().min(1, 'userAgent is required'),
    channels: z.array(rawAppChannelSchema),
    messageGroups: z.unknown()
});

const legacyChannelSchema = z.object({
    name: z.string().trim().min(1, 'Channel name is required').max(100, 'Channel name is too long'),
    id: z.string().trim().regex(DISCORD_SNOWFLAKE_REGEX, 'Channel ID must be a valid Discord snowflake'),
    referrer: z.string().trim().url('Referrer must be a valid URL').optional(),
    message_group: z.string().trim().min(1, 'Message group name cannot be empty').max(100, 'Message group name is too long').optional()
});

export const legacyConfigSchema = z.object({
    user_agent: z.string().trim().min(1, 'user_agent is required'),
    channels: z.array(legacyChannelSchema)
});

const envSchema = z.object({
    DISCORD_TOKEN: z.string({ error: 'DISCORD_TOKEN is required' }).trim().min(1, 'DISCORD_TOKEN is required')
});

export const runtimeOptionsSchema = z.object({
    numMessages: z.preprocess(
        (value) => {
            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (trimmed.length === 0) {
                    return undefined;
                }
                return Number(trimmed);
            }

            return value;
        },
        z.number({ error: 'Number of messages is required' })
            .int('Number of messages must be a whole number')
            .finite('Number of messages must be a valid number')
            .min(0, 'Number of messages must be zero or greater')
    ),
    baseWaitSeconds: z.preprocess(
        (value) => {
            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (trimmed.length === 0) {
                    return undefined;
                }
                return Number(trimmed);
            }

            return value;
        },
        z.number({ error: 'Base wait time is required' })
            .finite('Base wait time must be a valid number')
            .min(0, 'Base wait time must be zero or greater')
    ),
    marginSeconds: z.preprocess(
        (value) => {
            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (trimmed.length === 0) {
                    return undefined;
                }
                return Number(trimmed);
            }

            return value;
        },
        z.number({ error: 'Random margin is required' })
            .finite('Random margin must be a valid number')
            .min(0, 'Random margin must be zero or greater')
    )
});

export function buildDefaultReferrer(channelId: string): string {
    return `https://discord.com/channels/@me/${channelId}`;
}

export function formatZodError(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.length > 0 ? issue.path.join('.') : 'value';
            return `${path}: ${issue.message}`;
        })
        .join('; ');
}

function parseMessageGroups(value: unknown, pathPrefix: Array<string | number>): MessageGroups {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new z.ZodError([{
            code: z.ZodIssueCode.custom,
            path: pathPrefix,
            message: 'messageGroups must be an object'
        }]);
    }

    const issues: z.ZodIssue[] = [];
    const groups = Object.create(null) as MessageGroups;
    const seenGroupNames = new Set<string>();
    const entries = Object.entries(value);

    if (entries.length === 0) {
        issues.push({
            code: z.ZodIssueCode.custom,
            path: pathPrefix,
            message: 'At least one message group is required'
        });
    }

    for (const [rawName, rawMessages] of entries) {
        const parsedName = messageGroupNameSchema.safeParse(rawName);
        if (!parsedName.success) {
            issues.push(...parsedName.error.issues.map((issue) => ({
                ...issue,
                path: [...pathPrefix, rawName]
            })));
            continue;
        }

        const normalizedName = parsedName.data;
        if (seenGroupNames.has(normalizedName)) {
            issues.push({
                code: z.ZodIssueCode.custom,
                path: [...pathPrefix, rawName],
                message: `Duplicate message group name '${normalizedName}' after trimming whitespace`
            });
            continue;
        }

        const parsedMessages = messageListSchema.safeParse(rawMessages);
        if (!parsedMessages.success) {
            issues.push(...parsedMessages.error.issues.map((issue) => ({
                ...issue,
                path: [...pathPrefix, normalizedName, ...issue.path]
            })));
            continue;
        }

        seenGroupNames.add(normalizedName);
        groups[normalizedName] = parsedMessages.data;
    }

    if (issues.length > 0) {
        throw new z.ZodError(issues);
    }

    return groups;
}

export function parseAppConfig(value: unknown): AppConfig {
    const parsed = rawAppConfigSchema.parse(value);
    return appConfigSchema.parse({
        userAgent: parsed.userAgent,
        channels: parsed.channels.map((channel) => ({
            name: channel.name,
            id: channel.id,
            referrer: channel.referrer ?? buildDefaultReferrer(channel.id),
            messageGroup: channel.messageGroup ?? DEFAULT_MESSAGE_GROUP
        })),
        messageGroups: parseMessageGroups(parsed.messageGroups, ['messageGroups'])
    });
}

export function parseLegacyConfig(value: unknown): LegacyConfig {
    return legacyConfigSchema.parse(value);
}

export function parseLegacyMessages(value: unknown): LegacyMessages {
    return parseMessageGroups(Array.isArray(value) ? { [DEFAULT_MESSAGE_GROUP]: value } : value, []);
}

export function normalizeLegacyConfig(config: LegacyConfig, messages: LegacyMessages): AppConfig {
    return appConfigSchema.parse({
        userAgent: config.user_agent,
        channels: config.channels.map((channel) => ({
            name: channel.name,
            id: channel.id,
            referrer: channel.referrer ?? buildDefaultReferrer(channel.id),
            messageGroup: channel.message_group ?? DEFAULT_MESSAGE_GROUP
        })),
        messageGroups: messages
    });
}

export function parseEnvironment(env: NodeJS.ProcessEnv): EnvironmentConfig {
    return envSchema.parse(env);
}

export function parseRuntimeOptions(value: unknown): RuntimeOptions {
    return runtimeOptionsSchema.parse(value);
}

export function createDefaultAppConfig(): AppConfig {
    return parseAppConfig({
        userAgent: DEFAULT_USER_AGENT,
        channels: [],
        messageGroups: {
            [DEFAULT_MESSAGE_GROUP]: [DEFAULT_MESSAGE]
        }
    });
}

export function isLegacyConfigShape(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    return 'user_agent' in value;
}
