import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { readAppConfigResult, writeAppConfig } from '../config/store';
import { parseEnvironment } from '../config/schema';
import { createDryRun } from '../services/dry-run';
import { runPreflight } from '../services/preflight';
import { loadSenderState } from '../services/state-store';
import { RuntimeOptions } from '../types';

interface BridgePayload {
    baseDir?: string;
    config?: unknown;
    sessionId?: string;
    runtime?: RuntimeOptions;
}

async function readJsonStdin<T>(): Promise<T> {
    const chunks: Buffer[] = [];

    for await (const chunk of process.stdin) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }

    if (chunks.length === 0) {
        return {} as T;
    }

    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

function resolveBaseDir(baseDir?: string) {
    return baseDir ? path.resolve(baseDir) : path.resolve(__dirname, '..', '..');
}

function printJson(value: unknown) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function loadConfig(payload: BridgePayload) {
    const result = readAppConfigResult({
        configFile: path.join(resolveBaseDir(payload.baseDir), 'config.json'),
        messagesFile: path.join(resolveBaseDir(payload.baseDir), 'messages.json')
    });
    printJson(result);
}

async function saveConfig(payload: BridgePayload) {
    if (!payload.config) {
        throw new Error('config payload is required for save-config.');
    }

    const baseDir = resolveBaseDir(payload.baseDir);
    const config = writeAppConfig(payload.config as never, {
        configFile: path.join(baseDir, 'config.json'),
        messagesFile: path.join(baseDir, 'messages.json')
    });
    printJson({ ok: true, config });
}

async function preflight(payload: BridgePayload) {
    const baseDir = resolveBaseDir(payload.baseDir);
    dotenv.config({ path: path.join(baseDir, '.env') });
    const token = (() => {
        try {
            return parseEnvironment(process.env).DISCORD_TOKEN;
        } catch {
            return undefined;
        }
    })();

    const configResult = payload.config
        ? { kind: 'ok' as const, config: payload.config }
        : readAppConfigResult({
            configFile: path.join(baseDir, 'config.json'),
            messagesFile: path.join(baseDir, 'messages.json')
        });

    if (configResult.kind !== 'ok') {
        printJson({
            ok: false,
            checkedAt: new Date().toISOString(),
            configValid: false,
            tokenPresent: true,
            issues: [configResult.kind === 'invalid' ? configResult.error : 'Config is missing.'],
            channels: []
        });
        return;
    }

    const result = await runPreflight(configResult.config as never, {
        token,
        checkAccess: true
    });
    printJson(result);
}

async function loadLogs(payload: BridgePayload) {
    const baseDir = resolveBaseDir(payload.baseDir);
    const sessionId = payload.sessionId;
    if (!sessionId) {
        throw new Error('sessionId is required for load-logs.');
    }

    const logPath = path.join(baseDir, 'logs', `${sessionId}.jsonl`);
    if (!fs.existsSync(logPath)) {
        printJson({ ok: true, entries: [], path: logPath });
        return;
    }

    const entries = fs.readFileSync(logPath, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line));

    printJson({ ok: true, entries, path: logPath });
}

async function loadState(payload: BridgePayload) {
    const baseDir = resolveBaseDir(payload.baseDir);
    printJson(loadSenderState(baseDir));
}

async function dryRun(payload: BridgePayload) {
    const baseDir = resolveBaseDir(payload.baseDir);
    const runtime = payload.runtime ?? {
        numMessages: 0,
        baseWaitSeconds: 5,
        marginSeconds: 2
    };

    const configResult = payload.config
        ? { kind: 'ok' as const, config: payload.config }
        : readAppConfigResult({
            configFile: path.join(baseDir, 'config.json'),
            messagesFile: path.join(baseDir, 'messages.json')
        });

    if (configResult.kind !== 'ok') {
        throw new Error(configResult.kind === 'invalid' ? configResult.error : 'Config is missing.');
    }

    printJson(createDryRun(configResult.config as never, runtime));
}

async function main() {
    const command = process.argv[2];
    const payload = await readJsonStdin<BridgePayload>();

    switch (command) {
        case 'load-config':
            await loadConfig(payload);
            return;
        case 'save-config':
            await saveConfig(payload);
            return;
        case 'run-preflight':
            await preflight(payload);
            return;
        case 'load-logs':
            await loadLogs(payload);
            return;
        case 'load-state':
            await loadState(payload);
            return;
        case 'dry-run':
            await dryRun(payload);
            return;
        default:
            throw new Error(`Unknown bridge command '${command}'.`);
    }
}

main().catch((error) => {
    printJson({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
});
