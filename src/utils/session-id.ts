import path from 'path';

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function validateSessionId(sessionId: string): string {
    if (!SESSION_ID_PATTERN.test(sessionId)) {
        throw new Error('Invalid session id.');
    }

    return sessionId;
}

export function resolveSessionLogPath(baseDir: string, sessionId: string): string {
    const validSessionId = validateSessionId(sessionId);
    const logsDir = path.resolve(baseDir, 'logs');
    const logPath = path.resolve(logsDir, `${validSessionId}.jsonl`);

    const relativePath = path.relative(logsDir, logPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error('Invalid session id.');
    }

    return logPath;
}
