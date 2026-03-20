import fs from 'fs';
import path from 'path';
import { ZodError } from 'zod';
import { AppConfig, ConfigPaths, LegacyConfig, LegacyMessages } from '../types';
import {
    formatZodError,
    isCanonicalConfigShape,
    isLegacyConfigShape,
    normalizeLegacyConfig,
    parseAppConfig,
    parseLegacyConfig,
    parseLegacyMessages
} from './schema';
import { log } from '../utils/logger';

export const CONFIG_FILE = 'config.json';
export const LEGACY_MESSAGES_FILE = 'messages.json';

export type AppConfigReadResult =
    | { kind: 'ok'; config: AppConfig }
    | { kind: 'missing' }
    | { kind: 'invalid'; error: string };

export type LegacyMessagesReadResult =
    | { kind: 'ok'; messages: LegacyMessages }
    | { kind: 'missing' }
    | { kind: 'invalid'; error: string };

export function resolveConfigPaths(baseDir: string = process.cwd()): ConfigPaths {
    return {
        configFile: path.join(baseDir, CONFIG_FILE),
        messagesFile: path.join(baseDir, LEGACY_MESSAGES_FILE)
    };
}

function readJsonFile(filePath: string): unknown | null {
    if (!fs.existsSync(filePath)) {
        return null;
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function formatError(error: unknown): string {
    if (error instanceof ZodError) {
        return formatZodError(error);
    }

    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

export function readLegacyConfig(paths: ConfigPaths = resolveConfigPaths()): LegacyConfig | null {
    try {
        const raw = readJsonFile(paths.configFile);
        if (raw === null || !isLegacyConfigShape(raw)) {
            return null;
        }

        return parseLegacyConfig(raw);
    } catch (error) {
        log('System', `Error loading legacy config: ${formatError(error)}`, 'red');
        return null;
    }
}

export function readLegacyMessagesResult(paths: ConfigPaths = resolveConfigPaths()): LegacyMessagesReadResult {
    try {
        const raw = readJsonFile(paths.messagesFile);
        if (raw === null) {
            return { kind: 'missing' };
        }

        return { kind: 'ok', messages: parseLegacyMessages(raw) };
    } catch (error) {
        return { kind: 'invalid', error: `Error loading legacy messages: ${formatError(error)}` };
    }
}

export function readAppConfigResult(paths: ConfigPaths = resolveConfigPaths()): AppConfigReadResult {
    let raw: unknown;

    try {
        raw = readJsonFile(paths.configFile);
    } catch (error) {
        return { kind: 'invalid', error: `Error reading config file: ${formatError(error)}` };
    }

    if (raw === null) {
        return { kind: 'missing' };
    }

    if (isCanonicalConfigShape(raw)) {
        try {
            return { kind: 'ok', config: parseAppConfig(raw) };
        } catch (error) {
            return { kind: 'invalid', error: `Error loading config: ${formatError(error)}` };
        }
    }

    if (!isLegacyConfigShape(raw)) {
        return { kind: 'invalid', error: 'Error loading config: unsupported config shape.' };
    }

    try {
        const legacyConfig = parseLegacyConfig(raw);
        const legacyMessagesResult = readLegacyMessagesResult(paths);

        if (legacyMessagesResult.kind === 'missing') {
            return { kind: 'invalid', error: 'Error loading legacy config: messages.json is required for legacy imports.' };
        }

        if (legacyMessagesResult.kind === 'invalid') {
            return { kind: 'invalid', error: legacyMessagesResult.error };
        }

        return { kind: 'ok', config: normalizeLegacyConfig(legacyConfig, legacyMessagesResult.messages) };
    } catch (error) {
        return { kind: 'invalid', error: `Error loading legacy config: ${formatError(error)}` };
    }
}

export function readAppConfig(paths: ConfigPaths = resolveConfigPaths()): AppConfig | null {
    const result = readAppConfigResult(paths);

    if (result.kind === 'invalid') {
        log('System', result.error, 'red');
        return null;
    }

    return result.kind === 'ok' ? result.config : null;
}

export function writeAppConfig(config: AppConfig, paths: ConfigPaths = resolveConfigPaths()): void {
    fs.writeFileSync(paths.configFile, JSON.stringify(parseAppConfig(config), null, 4));
}
