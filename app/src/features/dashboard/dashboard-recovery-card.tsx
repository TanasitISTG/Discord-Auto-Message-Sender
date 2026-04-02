import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { RecoveryState } from '@/controllers/desktop/types';
import type { SenderStateRecord } from '@/lib/desktop';
import type { AppReadiness } from '@/shared/readiness';

interface DashboardRecoveryCardProps {
    recoveryState: RecoveryState | null;
    senderState: SenderStateRecord;
    healthEntries: Array<NonNullable<SenderStateRecord['channelHealth']>[string]>;
    hasActiveSession: boolean;
    appReadiness: AppReadiness;
    onResumeSession(): void | Promise<void>;
    onDiscardCheckpoint(): void | Promise<void>;
    onOpenLogs(): void | Promise<void>;
}

export function DashboardRecoveryCard({
    recoveryState,
    senderState,
    healthEntries,
    hasActiveSession,
    appReadiness,
    onResumeSession,
    onDiscardCheckpoint,
    onOpenLogs,
}: DashboardRecoveryCardProps) {
    return (
        <Card className="md:col-span-2">
            <CardHeader>
                <CardTitle>Recovery Snapshot</CardTitle>
                <CardDescription>
                    Suppressed and degraded channels are persisted locally so the dashboard can explain current runtime
                    posture.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {recoveryState ? (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100 shadow-xs backdrop-blur-xs">
                        <div className="font-medium text-red-50">Runtime interrupted during an active session</div>
                        <div className="mt-1 leading-relaxed text-red-50/80">{recoveryState.message}</div>
                        <div className="mt-2 text-[11px] text-red-50/70">
                            Interrupted {new Date(recoveryState.interruptedAt).toLocaleString()}
                        </div>
                    </div>
                ) : null}
                {senderState.resumeSession ? (
                    <div className="rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm shadow-xs backdrop-blur-xs">
                        <div className="font-semibold tracking-tight text-cyan-100">Resume checkpoint available</div>
                        <div className="mt-1 text-xs text-primary/80">
                            Updated {new Date(senderState.resumeSession.updatedAt).toLocaleString()}
                        </div>
                        <div className="mt-3 text-cyan-50/90">Next start: Resumed from checkpoint</div>
                        <div className="mt-1 text-cyan-50/90">
                            Runtime:{' '}
                            {senderState.resumeSession.runtime.numMessages === 0
                                ? 'infinite'
                                : senderState.resumeSession.runtime.numMessages}{' '}
                            messages, {senderState.resumeSession.runtime.baseWaitSeconds}s base wait,{' '}
                            {senderState.resumeSession.runtime.marginSeconds}s margin
                        </div>
                        <div className="mt-5 flex flex-wrap gap-2.5">
                            <Button
                                size="sm"
                                disabled={hasActiveSession || !appReadiness.canStartSession}
                                onClick={() => void onResumeSession()}
                            >
                                Resume Session
                            </Button>
                            <Button
                                size="sm"
                                variant="secondary"
                                disabled={hasActiveSession}
                                onClick={() => void onDiscardCheckpoint()}
                            >
                                Discard Checkpoint
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => void onOpenLogs()}>
                                Open Logs
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="text-sm text-muted-foreground">No interrupted session needs continuation.</div>
                )}

                {healthEntries.length === 0 ? (
                    <div className="pb-1 text-sm text-muted-foreground">All tracked channels are healthy.</div>
                ) : (
                    healthEntries.map((entry) => (
                        <div
                            key={entry.channelId}
                            className="rounded-xl border border-border/50 bg-background/50 p-4 text-sm transition-colors hover:bg-card/80"
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div className="font-medium text-foreground">{entry.channelName}</div>
                                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-500/90">
                                    {entry.status}
                                </div>
                            </div>
                            <div className="mt-2 leading-relaxed text-muted-foreground">
                                {entry.lastReason ?? 'No reason recorded.'}
                            </div>
                            <div className="mt-2 text-[11px] text-muted-foreground/70">
                                {entry.suppressedUntil
                                    ? `Suppressed until ${new Date(entry.suppressedUntil).toLocaleString()}`
                                    : `${entry.consecutiveRateLimits} recent rate limits, ${entry.consecutiveFailures} recent failures`}
                            </div>
                        </div>
                    ))
                )}
            </CardContent>
        </Card>
    );
}
