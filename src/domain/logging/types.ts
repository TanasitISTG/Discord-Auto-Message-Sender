export type LogLevel = 'info' | 'success' | 'warning' | 'error' | 'debug';
export type SessionSegmentKind = 'fresh' | 'resumed';

export interface LogEntry {
    id: string;
    timestamp: string;
    level: LogLevel;
    context: string;
    message: string;
    meta?: Record<string, string | number | boolean | null>;
    sessionId?: string;
    segmentId?: string;
    segmentKind?: SessionSegmentKind;
}
