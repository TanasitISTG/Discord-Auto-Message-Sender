import { z } from 'zod';
import { Config, Messages, RuntimeOptions } from '../types';

const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/;

const channelSchema = z.object({
    name: z.string().trim().min(1, 'Channel name is required').max(100, 'Channel name is too long'),
    id: z.string().trim().regex(DISCORD_SNOWFLAKE_REGEX, 'Channel ID must be a valid Discord snowflake'),
    message_group: z.string().trim().min(1, 'Message group name cannot be empty').max(100, 'Message group name is too long').optional()
});

const configSchema = z.object({
    channels: z.array(channelSchema)
});

const messageSchema = z.string().trim().min(1, 'Messages cannot be empty').max(2000, 'Discord messages are limited to 2000 characters');

const messagesSchema = z.record(
    z.string().trim().min(1, 'Group names cannot be empty').max(100, 'Group names are too long'),
    z.array(messageSchema).min(1, 'Each group must contain at least one message')
).superRefine((groups, ctx) => {
    if (Object.keys(groups).length === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'At least one message group is required'
        });
    }
});

const envSchema = z.object({
    DISCORD_BOT_TOKEN: z.string({ error: 'DISCORD_BOT_TOKEN is required' }).trim().min(1, 'DISCORD_BOT_TOKEN is required')
});

const runtimeOptionsSchema = z.object({
    numMessages: z.coerce.number().int().min(0, 'Number of messages must be zero or greater'),
    baseWaitSeconds: z.coerce.number().finite().min(0, 'Base wait time must be zero or greater'),
    marginSeconds: z.coerce.number().finite().min(0, 'Random margin must be zero or greater')
});

export function formatZodError(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.length > 0 ? issue.path.join('.') : 'value';
            return `${path}: ${issue.message}`;
        })
        .join('; ');
}

export function parseConfig(value: unknown): Config {
    return configSchema.parse(value) as Config;
}

export function parseMessages(value: unknown): Messages {
    return messagesSchema.parse(value) as Messages;
}

export function parseEnvironment(env: NodeJS.ProcessEnv): { DISCORD_BOT_TOKEN: string } {
    return envSchema.parse(env);
}

export function parseRuntimeOptions(value: unknown): RuntimeOptions {
    return runtimeOptionsSchema.parse(value) as RuntimeOptions;
}

export function getMissingMessageGroups(config: Config, messages: Messages): string[] {
    const groups = new Set(Object.keys(messages));
    const missing = new Set<string>();

    for (const channel of config.channels) {
        const groupName = channel.message_group ?? 'default';
        if (!groups.has(groupName)) {
            missing.add(groupName);
        }
    }

    return [...missing];
}
