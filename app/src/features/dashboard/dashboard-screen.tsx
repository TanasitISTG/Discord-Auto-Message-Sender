import { ActionTile, MetricCard, StateRow } from '@/shared/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { SenderStateRecord, SessionSnapshot } from '@/lib/desktop';

interface DashboardScreenProps {
    groupedMetrics: {
        channelCount: number;
        groupCount: number;
        messageCount: number;
    };
    latestSummary: SessionSnapshot['summary'] | undefined;
    senderState: SenderStateRecord;
    hasActiveSession: boolean;
    onOpenConfig(): void;
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
    onOpenConfig,
    onRunDryRun,
    onRunPreflight,
    onOpenLogs,
    onResumeSession,
    onDiscardCheckpoint
}: DashboardScreenProps) {
    const healthEntries = Object.values(senderState.channelHealth ?? {}).filter((entry) => entry.status !== 'healthy');
    const suppressedCount = healthEntries.filter((entry) => entry.status === 'suppressed').length;

    return (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Configured Channels" value={String(groupedMetrics.channelCount)} detail="Ready for desktop sessions." />
            <MetricCard label="Message Groups" value={String(groupedMetrics.groupCount)} detail={`${groupedMetrics.messageCount} total messages`} />
            <MetricCard label="Last Run" value={latestSummary ? `${latestSummary.sentMessages}` : '0'} detail={latestSummary ? `${latestSummary.completedChannels}/${latestSummary.totalChannels} channels completed` : 'No session summary yet.'} />
            <MetricCard label="Suppressed Channels" value={String(suppressedCount)} detail={senderState.resumeSession ? 'Checkpoint available for continuation.' : 'No saved recovery checkpoint.'} />

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
                    {senderState.resumeSession ? (
                        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm">
                            <div className="font-medium text-cyan-100">Resume checkpoint available</div>
                            <div className="mt-1 text-cyan-50/80">
                                Updated {new Date(senderState.resumeSession.updatedAt).toLocaleString()}
                            </div>
                            <div className="mt-2 text-cyan-50/80">
                                Runtime: {senderState.resumeSession.runtime.numMessages === 0 ? 'infinite' : senderState.resumeSession.runtime.numMessages} messages, {senderState.resumeSession.runtime.baseWaitSeconds}s base wait, {senderState.resumeSession.runtime.marginSeconds}s margin
                            </div>
                            <div className="mt-4 flex flex-wrap gap-3">
                                <Button
                                    size="sm"
                                    disabled={hasActiveSession}
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
                            </div>
                        </div>
                    ) : (
                        <div className="text-sm text-muted-foreground">No interrupted session needs continuation.</div>
                    )}

                    {healthEntries.length === 0 ? (
                        <div className="text-sm text-muted-foreground">All tracked channels are healthy.</div>
                    ) : healthEntries.map((entry) => (
                        <div key={entry.channelId} className="rounded-2xl border border-border bg-background/30 p-4 text-sm">
                            <div className="flex items-center justify-between gap-3">
                                <div className="font-medium">{entry.channelName}</div>
                                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{entry.status}</div>
                            </div>
                            <div className="mt-2 text-muted-foreground">{entry.lastReason ?? 'No reason recorded.'}</div>
                            <div className="mt-2 text-xs text-muted-foreground">
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
                        <div className="text-sm text-muted-foreground">No historical sessions recorded yet.</div>
                    ) : senderState.summaries.map((summary) => (
                        <div key={`${summary.startedAt}-${summary.finishedAt ?? 'running'}`} className="grid gap-3 rounded-2xl border border-border bg-background/30 p-4 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
                            <div>
                                <div className="font-medium">{new Date(summary.startedAt).toLocaleString()}</div>
                                <div className="text-xs text-muted-foreground">
                                    {summary.finishedAt ? `Finished ${new Date(summary.finishedAt).toLocaleString()}` : 'In progress'}
                                </div>
                            </div>
                            <div className="text-sm text-muted-foreground">{summary.sentMessages} messages sent</div>
                            <div className="text-sm text-muted-foreground">{summary.completedChannels}/{summary.totalChannels} channels completed</div>
                            <div className="text-sm text-muted-foreground">{summary.stopReason ?? 'Completed without stop reason'}</div>
                        </div>
                    ))}
                </CardContent>
            </Card>
        </section>
    );
}
