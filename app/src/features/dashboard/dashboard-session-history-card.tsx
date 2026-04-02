import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { SenderStateRecord } from '@/lib/desktop';

interface DashboardSessionHistoryCardProps {
    senderState: SenderStateRecord;
}

export function DashboardSessionHistoryCard({ senderState }: DashboardSessionHistoryCardProps) {
    return (
        <Card className="md:col-span-2 xl:col-span-4">
            <CardHeader>
                <CardTitle>Session History</CardTitle>
                <CardDescription>Persistent local summaries from `.sender-state.json`.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {senderState.summaries.length === 0 ? (
                    <div className="pb-1 text-sm text-muted-foreground">No historical sessions recorded yet.</div>
                ) : (
                    senderState.summaries.map((summary) => (
                        <div
                            key={`${summary.startedAt}-${summary.finishedAt ?? 'running'}`}
                            className="grid gap-3 rounded-md border border-border bg-transparent p-4 transition-colors hover:bg-zinc-900 md:grid-cols-[1.3fr_1fr_1fr_1fr]"
                        >
                            <div>
                                <div className="font-medium text-foreground">
                                    {new Date(summary.startedAt).toLocaleString()}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    {summary.finishedAt
                                        ? `Finished ${new Date(summary.finishedAt).toLocaleString()}`
                                        : 'In progress'}
                                </div>
                            </div>
                            <div className="text-sm text-muted-foreground">{summary.sentMessages} messages sent</div>
                            <div className="text-sm text-muted-foreground">
                                {summary.completedChannels}/{summary.totalChannels} channels
                            </div>
                            <div
                                className="truncate text-sm text-muted-foreground"
                                title={summary.stopReason ?? 'Completed without stop reason'}
                            >
                                {summary.stopReason ?? 'Completed'}
                            </div>
                        </div>
                    ))
                )}
            </CardContent>
        </Card>
    );
}
