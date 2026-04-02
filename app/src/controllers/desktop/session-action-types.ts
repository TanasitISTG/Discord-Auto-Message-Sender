import type { MutableRefObject } from 'react';
import type {
    DryRunResult,
    LogEntry,
    PreflightResult,
    RuntimeOptions,
    SenderStateRecord,
    SessionSnapshot,
} from '@/lib/desktop';
import type { ConfigDraftController } from '@/features/config/use-config-draft';
import type { BlockingIssue } from '@/shared/readiness';
import type { ConfirmDialogRequest, RecoveryState } from './types';

export interface SessionActionOptions {
    draft: ConfigDraftController;
    runtime: RuntimeOptions;
    session: SessionSnapshot | null;
    sessionRef: MutableRefObject<SessionSnapshot | null>;
    senderState: SenderStateRecord;
    currentLogSessionId: string | null;
    startBlockingIssue: BlockingIssue | undefined;
    setSession(next: SessionSnapshot | null): void;
    setSenderState(next: SenderStateRecord): void;
    setPreflight(next: PreflightResult | null): void;
    setDryRun(next: DryRunResult | null): void;
    setLogs(next: LogEntry[]): void;
    setNotice(next: string): void;
    setRecoveryState(next: RecoveryState | null): void;
    setSurfaceNotice(
        scope: 'config' | 'session' | 'logs',
        tone: 'neutral' | 'success' | 'warning' | 'danger',
        message: string,
    ): void;
    requestConfirmation(request: Omit<ConfirmDialogRequest, 'open'>): void;
}
