import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { SessionSnapshot } from '@/lib/desktop';
import { StateRow } from '@/shared/components';

interface DashboardRunSummaryCardProps {
    latestSummary: SessionSnapshot['summary'] | undefined;
}

export function DashboardRunSummaryCard({ latestSummary }: DashboardRunSummaryCardProps) {
    return (
        <Card className="md:col-span-2">
            <CardHeader>
                <CardTitle>Recent Run Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
                {latestSummary ? (
                    <>
                        <StateRow label="Started" value={new Date(latestSummary.startedAt).toLocaleString()} />
                        <StateRow
                            label="Finished"
                            value={
                                latestSummary.finishedAt
                                    ? new Date(latestSummary.finishedAt).toLocaleString()
                                    : 'In progress'
                            }
                        />
                        <StateRow label="Sent messages" value={String(latestSummary.sentMessages)} />
                        <StateRow
                            label="Channel outcome"
                            value={`${latestSummary.completedChannels} complete / ${latestSummary.failedChannels} failed`}
                        />
                        <StateRow label="Rate-limit events" value={String(latestSummary.rateLimitEvents ?? 0)} />
                        <StateRow
                            label="Peak pacing"
                            value={
                                latestSummary.maxPacingIntervalMs
                                    ? `${latestSummary.maxPacingIntervalMs} ms`
                                    : 'Baseline'
                            }
                        />
                    </>
                ) : (
                    <div>No session summary recorded yet.</div>
                )}
            </CardContent>
        </Card>
    );
}
