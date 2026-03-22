import { ActionTile, MetricCard, StateRow } from '@/shared/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { SenderStateRecord, SessionSnapshot } from '@/lib/desktop';
import type { AppReadiness, SetupChecklist } from '@/shared/readiness';
import { describeBlockingIssue } from '@/shared/readiness';
import { SetupChecklistCard } from '@/shared/setup-checklist-card';
import type { RecoveryState } from '@/shared/use-desktop-controller';

interface DashboardScreenProps {
    groupedMetrics: {
        channelCount: number;
        groupCount: number;
        messageCount: number;
    };
    latestSummary: SessionSnapshot['summary'] | undefined;
    senderState: SenderStateRecord;
    hasActiveSession: boolean;
    appReadiness: AppReadiness;
    setupChecklist: SetupChecklist;
    recoveryState: RecoveryState | null;
    runtimeMessage?: string | null;
    onOpenConfig(): void;
    onOpenSession(): void;
    onRunDryRun(): void | Promise<void>;
    onRunPreflight(): void | Promise<void>;
    onOpenLogs(): void | Promise<void>;
    onResumeSession(): void | Promise<void>;
    onDiscardCheckpoint(): void | Promise<void>;
}

export function DashboardScreen({
    groupedMetrics,
    latestSummary,
    senderState,
    hasActiveSession,
    appReadiness,
    setupChecklist,
    recoveryState,
    runtimeMessage,
    onOpenConfig,
    onOpenSession,
    onRunDryRun,
    onRunPreflight,
    onOpenLogs,
    onResumeSession,
    onDiscardCheckpoint
}: DashboardScreenProps) {
    const healthEntries = Object.values(senderState.channelHealth ?? {}).filter((entry) => entry.status !== 'healthy');
    const suppressedCount = healthEntries.filter((entry) => entry.status === 'suppressed').length;
    const nextStartMode = senderState.resumeSession ? 'Resumed from checkpoint' : 'Fresh run';

    return (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="md:col-span-2 xl:col-span-4">
                <SetupChecklistCard
                    checklist={setupChecklist}
                    currentScreen="dashboard"
                    onOpenConfig={onOpenConfig}
                    onRunPreflight={onRunPreflight}
                    onOpenSession={onOpenSession}
                />
            </div>

            {appReadiness.blockingIssues.length > 0 || appReadiness.warnings.length > 0 || runtimeMessage ? (
                <Card className="md:col-span-2 xl:col-span-4">
                    <CardHeader>
                        <CardTitle>Release Readiness</CardTitle>
                        <CardDescription>Packaged-app prerequisites and runtime recovery are surfaced here before you start a session.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {appReadiness.blockingIssues.map((issue) => (
                            <div key={issue} className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100 shadow-sm backdrop-blur-sm">
                                <div className="font-medium">{describeBlockingIssue(issue)}</div>
                                {(issue === 'token_missing' || issue === 'config_missing' || issue === 'config_invalid') ? (
                                    <Button size="sm" variant="secondary" className="mt-3" onClick={onOpenConfig}>
                                        Open Config
                                    </Button>
                                ) : null}
                            </div>
                        ))}
                        {runtimeMessage ? (
                            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100 shadow-sm backdrop-blur-sm">
                                {runtimeMessage}
                            </div>
                        ) : null}
                        {appReadiness.warnings
                            .filter((warning) => warning !== runtimeMessage)
                            .map((warning) => (
                                <div key={warning} className="rounded-xl border border-border/50 bg-background/50 p-4 text-sm text-muted-foreground">
                                    {warning}
                                </div>
                            ))}
                    </CardContent>
                </Card>
            ) : null}

            <MetricCard label="Configured Channels" value={String(groupedMetrics.channelCount)} detail="Ready for desktop sessions." />
            <MetricCard label="Message Groups" value={String(groupedMetrics.groupCount)} detail={`${groupedMetrics.messageCount} total messages`} />
            <MetricCard label="Last Run" value={latestSummary ? `${latestSummary.sentMessages}` : '0'} detail={latestSummary ? `${latestSummary.completedChannels}/${latestSummary.totalChannels} channels completed` : 'No session summary yet.'} />
            <MetricCard label="Next Start" value={nextStartMode} detail={senderState.resumeSession ? 'Saved checkpoint is ready for continuation.' : `${suppressedCount} suppressed channels tracked locally.`} />

            <Card className="md:col-span-2 xl:col-span-2">
                <CardHeader>
                    <CardTitle>Quick Actions</CardTitle>
                    <CardDescription>The desktop app now covers the normal operator loop without touching JSON or the terminal.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                    <ActionTile title="Open Config" detail="Edit channels, groups, and messages visually." onClick={onOpenConfig} />
                    <ActionTile title="Run Dry Run" detail="Preview selected channels, groups, and cadence without sending." onClick={onRunDryRun} />
                    <ActionTile title="Run Preflight" detail="Validate config and check channel access." onClick={onRunPreflight} />
                    <ActionTile title="Open Logs" detail="Inspect local JSONL logs with filters." onClick={onOpenLogs} />
                </CardContent>
            </Card>

            <Card className="md:col-span-2">
                <CardHeader>
                    <CardTitle>Recent Run Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                    {latestSummary ? (
                        <>
                            <StateRow label="Started" value={new Date(latestSummary.startedAt).toLocaleString()} />
                            <StateRow label="Finished" value={latestSummary.finishedAt ? new Date(latestSummary.finishedAt).toLocaleString() : 'In progress'} />
                            <StateRow label="Sent messages" value={String(latestSummary.sentMessages)} />
                            <StateRow label="Channel outcome" value={`${latestSummary.completedChannels} complete / ${latestSummary.failedChannels} failed`} />
                            <StateRow label="Rate-limit events" value={String(latestSummary.rateLimitEvents ?? 0)} />
                            <StateRow label="Peak pacing" value={latestSummary.maxPacingIntervalMs ? `${latestSummary.maxPacingIntervalMs} ms` : 'Baseline'} />
                        </>
                    ) : (
                        <div>No session summary recorded yet.</div>
                    )}
                </CardContent>
            </Card>

            <Card className="md:col-span-2">
                <CardHeader>
                    <CardTitle>Recovery Snapshot</CardTitle>
                    <CardDescription>Suppressed and degraded channels are persisted locally so the dashboard can explain current runtime posture.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {recoveryState ? (
                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100 shadow-sm backdrop-blur-sm">
                            <div className="font-medium text-red-50">Runtime interrupted during an active session</div>
                            <div className="mt-1 leading-relaxed text-red-50/80">{recoveryState.message}</div>
                            <div className="mt-2 text-[11px] text-red-50/70">
                                Interrupted {new Date(recoveryState.interruptedAt).toLocaleString()}
                            </div>
                        </div>
                    ) : null}
                    {senderState.resumeSession ? (
                        <div className="rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm shadow-sm backdrop-blur-sm">
                            <div className="font-semibold tracking-tight text-cyan-100">Resume checkpoint available</div>
                            <div className="mt-1 text-xs text-primary/80">
                                Updated {new Date(senderState.resumeSession.updatedAt).toLocaleString()}
                            </div>
                            <div className="mt-3 text-cyan-50/90">
                                Next start: {nextStartMode}
                            </div>
                            <div className="mt-1 text-cyan-50/90">
                                Runtime: {senderState.resumeSession.runtime.numMessages === 0 ? 'infinite' : senderState.resumeSession.runtime.numMessages} messages, {senderState.resumeSession.runtime.baseWaitSeconds}s base wait, {senderState.resumeSession.runtime.marginSeconds}s margin
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
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => void onOpenLogs()}
                                >
                                    Open Logs
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="text-sm text-muted-foreground">No interrupted session needs continuation.</div>
                    )}

                    {healthEntries.length === 0 ? (
                        <div className="text-sm text-muted-foreground pb-1">All tracked channels are healthy.</div>
                    ) : healthEntries.map((entry) => (
                        <div key={entry.channelId} className="rounded-xl border border-border/50 bg-background/50 p-4 text-sm transition-colors hover:bg-card/80">
                            <div className="flex items-center justify-between gap-3">
                                <div className="font-medium text-foreground">{entry.channelName}</div>
                                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-500/90">{entry.status}</div>
                            </div>
                            <div className="mt-2 leading-relaxed text-muted-foreground">{entry.lastReason ?? 'No reason recorded.'}</div>
                            <div className="mt-2 text-[11px] text-muted-foreground/70">
                                {entry.suppressedUntil ? `Suppressed until ${new Date(entry.suppressedUntil).toLocaleString()}` : `${entry.consecutiveRateLimits} recent rate limits, ${entry.consecutiveFailures} recent failures`}
                            </div>
                        </div>
                    ))}
                </CardContent>
            </Card>

            <Card className="md:col-span-2 xl:col-span-4">
                <CardHeader>
                    <CardTitle>Session History</CardTitle>
                    <CardDescription>Persistent local summaries from `.sender-state.json`.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {senderState.summaries.length === 0 ? (
                        <div className="text-sm text-muted-foreground pb-1">No historical sessions recorded yet.</div>
                    ) : senderState.summaries.map((summary) => (
                        <div key={`${summary.startedAt}-${summary.finishedAt ?? 'running'}`} className="grid gap-3 rounded-xl border border-border/50 bg-background/50 p-4 transition-colors hover:bg-card/80 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
                            <div>
                                <div className="font-medium text-foreground">{new Date(summary.startedAt).toLocaleString()}</div>
                                <div className="text-xs text-muted-foreground">
                                    {summary.finishedAt ? `Finished ${new Date(summary.finishedAt).toLocaleString()}` : 'In progress'}
                                </div>
                            </div>
                            <div className="text-sm text-muted-foreground">{summary.sentMessages} messages sent</div>
                            <div className="text-sm text-muted-foreground">{summary.completedChannels}/{summary.totalChannels} channels</div>
                            <div className="text-sm text-muted-foreground truncate" title={summary.stopReason ?? 'Completed without stop reason'}>{summary.stopReason ?? 'Completed'}</div>
                        </div>
                    ))}
                </CardContent>
            </Card>
        </section>
    );
}
