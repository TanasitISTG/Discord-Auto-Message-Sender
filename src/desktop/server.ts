import readline from 'readline';
import { createDesktopHandlers } from './handlers';
import {
    DesktopCommandName,
    DesktopEvent,
    DesktopEventMessage,
    DesktopRpcErrorResponse,
    DesktopRpcRequest,
    DesktopRpcResponse,
    DesktopRpcSuccessResponse
} from './contracts';
import { DesktopRuntime } from './runtime';

function getArg(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function writeMessage(message: DesktopRpcResponse | DesktopEventMessage) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

function emitEvent(event: DesktopEvent) {
    writeMessage({
        type: 'event',
        event
    });
}

async function main() {
    const runtime = new DesktopRuntime({
        baseDir: getArg('--base-dir') ?? process.cwd(),
        emitEvent
    });
    const handlers = createDesktopHandlers();

    emitEvent({ type: 'sidecar_ready' });

    const reader = readline.createInterface({
        input: process.stdin,
        crlfDelay: Infinity
    });

    reader.on('line', async (line) => {
        const trimmed = line.trim();
        if (!trimmed) {
            return;
        }

        let request: DesktopRpcRequest;
        try {
            request = JSON.parse(trimmed) as DesktopRpcRequest;
        } catch (error) {
            const response: DesktopRpcErrorResponse = {
                type: 'response',
                id: 'invalid',
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            };
            writeMessage(response);
            return;
        }

        try {
            if (!(request.command in handlers)) {
                throw new Error(`Unsupported desktop command '${request.command}'.`);
            }

            const handler = handlers[request.command as Exclude<DesktopCommandName, 'open_log_file'>] as (
                runtime: DesktopRuntime,
                payload: unknown
            ) => Promise<unknown>;
            const result = await handler(runtime, request.payload);
            writeMessage({
                type: 'response',
                id: request.id,
                ok: true,
                result
            } as DesktopRpcSuccessResponse);
        } catch (error) {
            writeMessage({
                type: 'response',
                id: request.id,
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });
}

main().catch((error) => {
    emitEvent({
        type: 'sidecar_error',
        message: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
});
