import readline from 'readline';
import { createDesktopHandlers } from './handlers';
import {
    DesktopEvent,
    DesktopEventMessage,
    DesktopRpcErrorResponse,
    DesktopRpcRequest,
    DesktopRpcResponse,
    DesktopRpcSuccessResponse,
    SidecarCommandName
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

    let requestQueue = Promise.resolve();

    const handleLine = async (line: string) => {
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
            if (!Object.prototype.hasOwnProperty.call(handlers, request.command)) {
                throw new Error(`Unsupported desktop command '${request.command}'.`);
            }

            const handler = handlers[request.command as SidecarCommandName];
            if (typeof handler !== 'function') {
                throw new Error(`Unsupported desktop command '${request.command}'.`);
            }

            const result = await (handler as (
                runtime: DesktopRuntime,
                payload: unknown
            ) => Promise<unknown>)(runtime, request.payload);
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
    };

    reader.on('line', (line) => {
        requestQueue = requestQueue
            .then(() => handleLine(line))
            .catch((error) => {
                emitEvent({
                    type: 'sidecar_error',
                    status: 'failed',
                    message: error instanceof Error ? error.message : String(error)
                });
            });
    });
}

main().catch((error) => {
    emitEvent({
        type: 'sidecar_error',
        status: 'failed',
        message: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
});
