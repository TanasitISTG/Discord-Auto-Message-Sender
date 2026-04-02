import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RecoveryState, SurfaceNotice } from '@/controllers/desktop/types';
import type { SenderStateRecord } from '@/lib/desktop';
import { InlineNotice } from '@/shared/components';
import type { AppReadiness } from '@/shared/readiness';
import { describeBlockingIssue } from '@/shared/readiness';

interface SessionAlertsProps {
    notice?: SurfaceNotice;
    recoveryState: RecoveryState | null;
    suppressedCount: number;
    appReadiness: AppReadiness;
    runtimeMessage?: string | null;
    checkpoint: SenderStateRecord['resumeSession'] | null;
    onStart(): void | Promise<void>;
    onDiscardCheckpoint(): void | Promise<void>;
    onOpenConfig(): void;
}

export function SessionAlerts({
    notice,
    recoveryState,
    suppressedCount,
    appReadiness,
    runtimeMessage,
    checkpoint,
    onStart,
    onDiscardCheckpoint,
    onOpenConfig,
}: SessionAlertsProps) {
    return (
        <>
            {notice ? <InlineNotice tone={notice.tone} message={notice.message} /> : null}

            {recoveryState ? (
                <div className="rounded-md border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">
                    <div className="font-semibold tracking-tight">Runtime interrupted</div>
                    <div className="mt-1 leading-relaxed text-red-50/80">{recoveryState.message}</div>
                    <div className="mt-3 text-[11px] font-semibold tracking-tight text-red-50/70">
                        Interrupted {new Date(recoveryState.interruptedAt).toLocaleString()}
                    </div>
                </div>
            ) : null}

            {suppressedCount > 0 ? (
                <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                    <div className="font-semibold tracking-tight">Waiting on cooldown</div>
                    <div className="mt-1 leading-relaxed text-amber-50/80">
                        {suppressedCount} channel{suppressedCount === 1 ? '' : 's'} currently suppressed and waiting for
                        the next retry window.
                    </div>
                </div>
            ) : null}

            {appReadiness.blockingIssues.length > 0 || runtimeMessage ? (
                <div className="space-y-3 rounded-md border border-border bg-transparent p-4 text-sm">
                    {appReadiness.blockingIssues.map((issue) => (
                        <div
                            key={issue}
                            className="rounded-md border border-amber-500/20 bg-amber-500/10 p-4 text-amber-100"
                        >
                            <div className="leading-relaxed">{describeBlockingIssue(issue)}</div>
                            {issue === 'token_missing' || issue === 'config_missing' || issue === 'config_invalid' ? (
                                <Button size="sm" className="mt-4" onClick={onOpenConfig}>
                                    Open Config
                                </Button>
                            ) : null}
                        </div>
                    ))}
                    {runtimeMessage ? (
                        <div className="rounded-md border border-red-500/20 bg-red-500/10 p-4 leading-relaxed text-red-100">
                            {runtimeMessage}
                        </div>
                    ) : null}
                </div>
            ) : null}

            {checkpoint ? (
                <div className="rounded-md border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-50">
                    <div className="font-semibold tracking-tight">Interrupted session available</div>
                    <div className="mt-1 text-[11px] font-semibold tracking-tight text-cyan-50/70">
                        Last checkpoint: {new Date(checkpoint.updatedAt).toLocaleString()}
                    </div>
                    <div className="mt-3 leading-relaxed text-cyan-50/80">
                        Start will continue with{' '}
                        {checkpoint.runtime.numMessages === 0 ? 'infinite' : checkpoint.runtime.numMessages} messages
                        per channel and the saved pacing/recent-history state.
                    </div>
                    <div className="mt-5 flex flex-wrap gap-3">
                        <Button size="sm" onClick={onStart} disabled={!appReadiness.canStartSession}>
                            <Play className="mr-2 h-4 w-4" />
                            Resume Session
                        </Button>
                        <Button size="sm" variant="secondary" onClick={onDiscardCheckpoint}>
                            Discard Checkpoint
                        </Button>
                    </div>
                </div>
            ) : null}
        </>
    );
}
