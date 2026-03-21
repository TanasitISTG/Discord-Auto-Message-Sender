import fs from 'fs';
import path from 'path';
import { SenderStateRecord } from '../types';

export const STATE_FILE = '.sender-state.json';

export function getDefaultSenderState(): SenderStateRecord {
    return {
        summaries: [],
        recentFailures: [],
        recentMessageHistory: {}
    };
}

export function resolveStateFile(baseDir: string): string {
    return path.join(baseDir, STATE_FILE);
}

export function loadSenderState(baseDir: string): SenderStateRecord {
    const filePath = resolveStateFile(baseDir);
    if (!fs.existsSync(filePath)) {
        return getDefaultSenderState();
    }

    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<SenderStateRecord>;
        return {
            lastSession: raw.lastSession,
            summaries: Array.isArray(raw.summaries) ? raw.summaries : [],
            recentFailures: Array.isArray(raw.recentFailures) ? raw.recentFailures : [],
            recentMessageHistory: raw.recentMessageHistory && typeof raw.recentMessageHistory === 'object'
                ? Object.fromEntries(
                    Object.entries(raw.recentMessageHistory).map(([channelId, messages]) => [
                        channelId,
                        Array.isArray(messages) ? messages.filter((message): message is string => typeof message === 'string') : []
                    ])
                )
                : {},
            warning: typeof raw.warning === 'string' ? raw.warning : undefined
        };
    } catch {
        return {
            ...getDefaultSenderState(),
            warning: 'Local sender state was corrupted and has been reset.'
        };
    }
}

export function saveSenderState(baseDir: string, state: SenderStateRecord) {
    const filePath = resolveStateFile(baseDir);
    const nextState: SenderStateRecord = {
        ...state,
        warning: undefined
    };
    fs.writeFileSync(filePath, JSON.stringify(nextState, null, 2), 'utf8');
}
