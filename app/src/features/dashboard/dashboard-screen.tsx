import { ActionTile, MetricCard } from '@/shared/components';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { RecoveryState } from '@/controllers/desktop/types';
import type { SenderStateRecord, SessionSnapshot } from '@/lib/desktop';
import type { AppReadiness, SetupChecklist } from '@/shared/readiness';
import { SetupChecklistCard } from '@/shared/setup-checklist-card';
import { DashboardReadinessCard } from './dashboard-readiness-card';
import { DashboardRecoveryCard } from './dashboard-recovery-card';
import { DashboardRunSummaryCard } from './dashboard-run-summary-card';
import { DashboardSessionHistoryCard } from './dashboard-session-history-card';

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
    onDiscardCheckpoint,
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

            <DashboardReadinessCard
                appReadiness={appReadiness}
                runtimeMessage={runtimeMessage}
                onOpenConfig={onOpenConfig}
            />

            <MetricCard
                label="Configured Channels"
                value={String(groupedMetrics.channelCount)}
                detail="Ready for desktop sessions."
            />
            <MetricCard
                label="Message Groups"
                value={String(groupedMetrics.groupCount)}
                detail={`${groupedMetrics.messageCount} total messages`}
            />
            <MetricCard
                label="Last Run"
                value={latestSummary ? `${latestSummary.sentMessages}` : '0'}
                detail={
                    latestSummary
                        ? `${latestSummary.completedChannels}/${latestSummary.totalChannels} channels completed`
                        : 'No session summary yet.'
                }
            />
            <MetricCard
                label="Next Start"
                value={nextStartMode}
                detail={
                    senderState.resumeSession
                        ? 'Saved checkpoint is ready for continuation.'
                        : `${suppressedCount} suppressed channels tracked locally.`
                }
            />

            <Card className="md:col-span-2 xl:col-span-2">
                <CardHeader>
                    <CardTitle>Quick Actions</CardTitle>
                    <CardDescription>
                        The desktop app now covers the normal operator loop without touching JSON or the terminal.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                    <ActionTile
                        title="Open Config"
                        detail="Edit channels, groups, and messages visually."
                        onClick={onOpenConfig}
                    />
                    <ActionTile
                        title="Run Dry Run"
                        detail="Preview selected channels, groups, and cadence without sending."
                        onClick={onRunDryRun}
                    />
                    <ActionTile
                        title="Run Preflight"
                        detail="Validate config and check channel access."
                        onClick={onRunPreflight}
                    />
                    <ActionTile
                        title="Open Logs"
                        detail="Inspect local JSONL logs with filters."
                        onClick={onOpenLogs}
                    />
                </CardContent>
            </Card>

            <DashboardRunSummaryCard latestSummary={latestSummary} />
            <DashboardRecoveryCard
                recoveryState={recoveryState}
                senderState={senderState}
                healthEntries={healthEntries}
                hasActiveSession={hasActiveSession}
                appReadiness={appReadiness}
                onResumeSession={onResumeSession}
                onDiscardCheckpoint={onDiscardCheckpoint}
                onOpenLogs={onOpenLogs}
            />
            <DashboardSessionHistoryCard senderState={senderState} />
        </section>
    );
}
