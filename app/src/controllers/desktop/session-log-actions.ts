import { loadLogs, openLogFile } from '@/lib/desktop';
import { showInfoToast } from '@/shared/toast';
import { mergeLogsById } from './helpers';
import type { SessionActionOptions } from './session-action-types';

export function createSessionLogActions({
    currentLogSessionId,
    setLogs,
    setNotice,
    setSurfaceNotice,
}: SessionActionOptions) {
    return {
        async loadCurrentLogs() {
            const sessionId = currentLogSessionId;
            if (!sessionId) {
                setNotice('Start a session before loading log output.');
                setSurfaceNotice('logs', 'warning', 'Start or resume a session before loading log output.');
                return null;
            }

            try {
                const result = await loadLogs(sessionId);
                setLogs(mergeLogsById(result.entries.slice().reverse()));
                if (result.warnings && result.warnings.length > 0) {
                    setSurfaceNotice(
                        'logs',
                        'warning',
                        'Some log lines were skipped because they were invalid or incomplete.',
                    );
                } else {
                    setSurfaceNotice(
                        'logs',
                        'success',
                        `Loaded ${result.entries.length} log entr${result.entries.length === 1 ? 'y' : 'ies'} from disk.`,
                    );
                }
                return result;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                setSurfaceNotice('logs', 'danger', message);
                return null;
            }
        },
        async openCurrentLogFile() {
            const sessionId = currentLogSessionId;
            if (!sessionId) {
                setNotice('No session log is available yet.');
                setSurfaceNotice('logs', 'warning', 'No session log is available yet.');
                return null;
            }

            try {
                const result = await openLogFile(sessionId);
                setSurfaceNotice('logs', 'neutral', `Opening ${result}`);
                showInfoToast('Opening session log file.');
                return result;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                setSurfaceNotice('logs', 'danger', message);
                return null;
            }
        },
    };
}
