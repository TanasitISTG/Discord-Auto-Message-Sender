import path from 'path';
import readline from 'readline';
import dotenv from 'dotenv';
import { parseEnvironment } from '../config/schema';
import { readAppConfigResult } from '../config/store';
import { SessionService } from '../services/session';

interface ControlMessage {
    action: 'pause' | 'resume' | 'stop' | 'get_state';
    reason?: string;
}

function getArg(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function emit(value: unknown) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main() {
    const baseDir = path.resolve(getArg('--base-dir') ?? path.resolve(__dirname, '..', '..'));
    const sessionId = getArg('--session-id') ?? `session-${Date.now()}`;
    const numMessages = Number(getArg('--num-messages') ?? '0');
    const baseWaitSeconds = Number(getArg('--base-wait-seconds') ?? '5');
    const marginSeconds = Number(getArg('--margin-seconds') ?? '2');

    dotenv.config({ path: path.join(baseDir, '.env') });
    const env = parseEnvironment(process.env);
    const configResult = readAppConfigResult({
        configFile: path.join(baseDir, 'config.json'),
        messagesFile: path.join(baseDir, 'messages.json')
    });

    if (configResult.kind !== 'ok') {
        throw new Error(configResult.kind === 'invalid' ? configResult.error : 'Configuration is missing.');
    }

    const session = new SessionService({
        baseDir,
        config: configResult.config,
        token: env.DISCORD_TOKEN,
        runtime: {
            numMessages,
            baseWaitSeconds,
            marginSeconds
        },
        sessionId,
        emitEvent: emit
    });

    const reader = readline.createInterface({
        input: process.stdin,
        crlfDelay: Infinity
    });

    reader.on('line', (line) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
            return;
        }

        const message = JSON.parse(trimmed) as ControlMessage;
        switch (message.action) {
            case 'pause':
                emit({ type: 'state', state: session.pause() });
                break;
            case 'resume':
                emit({ type: 'state', state: session.resume() });
                break;
            case 'stop':
                emit({ type: 'state', state: session.stop(message.reason) });
                break;
            case 'get_state':
                emit({ type: 'state', state: session.getState() });
                break;
            default:
                emit({ type: 'error', message: `Unknown action '${(message as { action: string }).action}'.` });
        }
    });

    await session.start();
}

main().catch((error) => {
    emit({
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
});
