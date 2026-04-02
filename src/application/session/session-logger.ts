import path from 'path';
import type { AppEvent } from '../../types';
import { createBufferedFileWriter, createStructuredLogger, type StructuredLogger } from '../../utils/logger';
import type { SessionSegment } from './session-state-machine';

const SESSION_LOG_DIR = 'logs';

interface CreateSessionLoggerOptions {
    baseDir: string;
    sessionId: string;
    segment: SessionSegment;
    emitEvent?: (event: AppEvent) => void;
    logger?: StructuredLogger;
}

export function createSessionLoggerArtifacts({
    baseDir,
    sessionId,
    segment,
    emitEvent,
    logger,
}: CreateSessionLoggerOptions) {
    const logWriter = createBufferedFileWriter(path.join(baseDir, SESSION_LOG_DIR, `${sessionId}.jsonl`));
    const baseLogger = createStructuredLogger({
        sinks: [
            logWriter.sink,
            (entry) => emitEvent?.({ type: 'log_event_emitted', entry }),
            ...(logger
                ? [
                      (entry: ReturnType<StructuredLogger['emit']>) => {
                          logger.emit({
                              timestamp: entry.timestamp,
                              context: entry.context,
                              level: entry.level,
                              message: entry.message,
                              meta: entry.meta,
                              sessionId: entry.sessionId,
                              segmentId: entry.segmentId,
                              segmentKind: entry.segmentKind,
                          });
                      },
                  ]
                : []),
        ],
        defaults: {
            sessionId,
        },
    });

    return {
        logWriter,
        logger: baseLogger.child({
            sessionId,
            segmentId: segment.id,
            segmentKind: segment.kind,
        }),
    };
}
