import fs from 'fs';
import path from 'path';
import { SenderStateRecord } from '../../types';
import { resolveStateFile, withStateLock } from './locking';
import { getDefaultSenderState, STATE_SCHEMA_VERSION } from './schema';
import { normalizeSenderState } from './sender-state-normalizers';

export function loadSenderState(baseDir: string): SenderStateRecord {
    const loaded = readSenderState(baseDir);

    if (loaded.shouldWriteBack) {
        saveSenderState(baseDir, loaded.state);
        return loaded.warning
            ? { ...loaded.state, warning: loaded.warning }
            : loaded.state;
    }

    return loaded.warning
        ? { ...loaded.state, warning: loaded.warning }
        : loaded.state;
}

export function saveSenderState(baseDir: string, state: SenderStateRecord) {
    withStateLock(baseDir, () => {
        writeSenderStateUnlocked(resolveStateFile(baseDir), state);
    });
}

export function updateSenderState(baseDir: string, updater: (state: SenderStateRecord) => void): SenderStateRecord {
    return withStateLock(baseDir, () => {
        const loaded = readSenderState(baseDir);
        const state = loaded.warning
            ? { ...loaded.state, warning: loaded.warning }
            : loaded.state;
        updater(state);
        writeSenderStateUnlocked(resolveStateFile(baseDir), state);
        return readSenderState(baseDir).state;
    });
}

export function clearResumeSession(baseDir: string): SenderStateRecord {
    return updateSenderState(baseDir, (state) => {
        state.resumeSession = undefined;
    });
}

function readSenderState(baseDir: string): {
    state: SenderStateRecord;
    shouldWriteBack: boolean;
    warning?: string;
} {
    const filePath = resolveStateFile(baseDir);
    if (!fs.existsSync(filePath)) {
        return {
            state: getDefaultSenderState(),
            shouldWriteBack: false
        };
    }

    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<SenderStateRecord> & { schemaVersion?: unknown };
        return normalizeSenderState(raw);
    } catch {
        return {
            state: getDefaultSenderState(),
            shouldWriteBack: false,
            warning: 'Local sender state was corrupted and has been reset.'
        };
    }
}

function writeSenderStateUnlocked(filePath: string, state: SenderStateRecord) {
    const nextState: SenderStateRecord = {
        ...state,
        schemaVersion: STATE_SCHEMA_VERSION,
        warning: undefined
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempFilePath, JSON.stringify(nextState, null, 2), 'utf8');

    try {
        fs.renameSync(tempFilePath, filePath);
    } catch (error) {
        try {
            if (fs.existsSync(filePath)) {
                fs.rmSync(filePath, { force: true });
            }
            fs.renameSync(tempFilePath, filePath);
        } catch (renameError) {
            throw renameError instanceof Error
                ? renameError
                : error;
        } finally {
            if (fs.existsSync(tempFilePath)) {
                fs.rmSync(tempFilePath, { force: true });
            }
        }
    }
}

export { getDefaultSenderState, resolveStateFile };
