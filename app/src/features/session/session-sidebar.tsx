import { AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { SenderStateRecord, SessionSnapshot } from '@/lib/desktop';
import { StateRow } from '@/shared/components';

interface SessionSidebarProps {
    session: SessionSnapshot | null;
    healthEntries: Array<NonNullable<SenderStateRecord['channelHealth']>[string]>;
}

export function SessionSidebar({ session, healthEntries }: SessionSidebarProps) {
    return (
        <div className="grid gap-4">
            <Card>
                <CardHeader>
                    <CardTitle>Session State</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    <StateRow label="Status" value={session?.status ?? 'idle'} />
                    <StateRow label="Sent messages" value={String(session?.sentMessages ?? 0)} />
                    <StateRow label="Active channels" value={String(session?.activeChannels.length ?? 0)} />
                    <StateRow label="Completed channels" value={String(session?.completedChannels.length ?? 0)} />
                    <StateRow label="Failed channels" value={String(session?.failedChannels.length ?? 0)} />
                    <StateRow
                        label="Pacing"
                        value={session?.pacing ? `${session.pacing.currentRequestIntervalMs} ms` : 'Baseline'}
                    />
                    <StateRow
                        label="Peak pacing"
                        value={session?.pacing ? `${session.pacing.maxRequestIntervalMs} ms` : 'Baseline'}
                    />
                    <StateRow label="Rate-limit count" value={String(session?.pacing?.recentRateLimitCount ?? 0)} />
                    {session?.summary ? (
                        <div className="mt-2 rounded-md border border-border bg-transparent p-4">
                            <div className="mb-2 text-sm font-semibold tracking-tight">Final Summary</div>
                            <div className="space-y-2 leading-relaxed text-muted-foreground">
                                <div>
                                    {session.summary.completedChannels}/{session.summary.totalChannels} channels
                                    completed
                                </div>
                                <div>{session.summary.sentMessages} messages sent</div>
                                <div>{session.summary.rateLimitEvents ?? 0} rate-limit events</div>
                            </div>
                        </div>
                    ) : null}
                    {session?.stopReason ? (
                        <div className="mt-2 rounded-md border border-red-500/20 bg-red-500/10 p-4 text-red-200">
                            <div className="mb-2 flex items-center gap-2 font-medium tracking-tight">
                                <AlertCircle className="h-4 w-4" />
                                Stop reason
                            </div>
                            <div className="leading-relaxed">{session.stopReason}</div>
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Channel Health</CardTitle>
                    <CardDescription>
                        Suppressed channels cool down instead of thrashing the session with repeated failures.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {healthEntries.length === 0 ? (
                        <div className="text-sm text-muted-foreground">All tracked channels are healthy.</div>
                    ) : (
                        healthEntries.map((entry) => (
                            <div
                                key={entry.channelId}
                                className="rounded-md border border-border bg-transparent p-4 text-sm transition-colors hover:bg-zinc-900"
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="font-medium text-foreground">{entry.channelName}</div>
                                    <Badge
                                        tone={
                                            entry.status === 'suppressed'
                                                ? 'warning'
                                                : entry.status === 'failed'
                                                  ? 'danger'
                                                  : 'neutral'
                                        }
                                    >
                                        {entry.status}
                                    </Badge>
                                </div>
                                <div className="mt-3 leading-relaxed text-muted-foreground">
                                    {entry.lastReason ?? 'No reason recorded.'}
                                </div>
                                <div className="mt-3 text-[11px] font-semibold uppercase tracking-tight text-muted-foreground">
                                    {entry.suppressedUntil
                                        ? `Suppressed until ${new Date(entry.suppressedUntil).toLocaleString()}`
                                        : `${entry.consecutiveRateLimits} rate limits, ${entry.consecutiveFailures} failures`}
                                </div>
                            </div>
                        ))
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
