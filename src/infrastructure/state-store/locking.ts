import fs from 'fs';
import path from 'path';
import { STATE_FILE, STATE_LOCK_FILE } from './schema';

const STATE_LOCK_RETRY_MS = 25;
const STATE_LOCK_TIMEOUT_MS = 10_000;
const STATE_LOCK_STALE_MS = 30_000;
const LOCK_WAIT_BUFFER = typeof SharedArrayBuffer === 'function' ? new SharedArrayBuffer(4) : null;
const LOCK_WAIT_VIEW = LOCK_WAIT_BUFFER ? new Int32Array(LOCK_WAIT_BUFFER) : null;

export function resolveStateFile(baseDir: string): string {
    return path.join(baseDir, STATE_FILE);
}

export function resolveStateLockFile(baseDir: string): string {
    return path.join(baseDir, STATE_LOCK_FILE);
}

export function withStateLock<T>(baseDir: string, action: () => T): T {
    const lockPath = resolveStateLockFile(baseDir);
    fs.mkdirSync(baseDir, { recursive: true });
    const startedAt = Date.now();

    while (true) {
        try {
            const lockHandle = fs.openSync(lockPath, 'wx');
            try {
                fs.writeFileSync(
                    lockHandle,
                    JSON.stringify({
                        pid: process.pid,
                        acquiredAt: new Date().toISOString(),
                    }),
                    'utf8',
                );
                return action();
            } finally {
                try {
                    fs.closeSync(lockHandle);
                } catch {
                    // Best effort cleanup only.
                }
                try {
                    fs.rmSync(lockPath, { force: true });
                } catch {
                    // Best effort cleanup only.
                }
            }
        } catch (error) {
            const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
            if (code !== 'EEXIST') {
                throw error;
            }

            removeStaleStateLock(lockPath);
            if (Date.now() - startedAt >= STATE_LOCK_TIMEOUT_MS) {
                throw new Error(`Timed out waiting for exclusive access to '${STATE_FILE}'.`);
            }
            sleepBlocking(STATE_LOCK_RETRY_MS);
        }
    }
}

function removeStaleStateLock(lockPath: string) {
    try {
        const stats = fs.statSync(lockPath);
        if (Date.now() - stats.mtimeMs >= STATE_LOCK_STALE_MS) {
            fs.rmSync(lockPath, { force: true });
        }
    } catch {
        // Lock may have been released between retries.
    }
}

function sleepBlocking(ms: number) {
    if (LOCK_WAIT_VIEW && typeof Atomics.wait === 'function') {
        Atomics.wait(LOCK_WAIT_VIEW, 0, 0, ms);
        return;
    }

    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        // Busy wait only as a fallback if Atomics.wait is unavailable.
    }
}
