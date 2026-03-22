import { useEffect, useState } from 'react';
import { Play, Shuffle, Square, TimerReset } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfigScreen } from '@/features/config/config-screen';
import { DashboardScreen } from '@/features/dashboard/dashboard-screen';
import { LogsScreen } from '@/features/logs/logs-screen';
import { PreviewScreen } from '@/features/preview/preview-screen';
import { SessionScreen } from '@/features/session/session-screen';
import { SupportScreen } from '@/features/support/support-screen';
import { navigation, Screen } from '@/shared/screens';
import { toneFromStatus, useDesktopController } from '@/shared/use-desktop-controller';
import { describeBlockingIssue } from '@/shared/readiness';

function toneFromSidecarStatus(status: ReturnType<typeof useDesktopController>['sidecarStatus']) {
    switch (status) {
        case 'ready':
            return 'success';
        case 'restarting':
            return 'warning';
        case 'failed':
            return 'danger';
        default:
            return 'neutral';
    }
}

export default function App() {
    const [screen, setScreen] = useState<Screen>('dashboard');
    const controller = useDesktopController();

    useEffect(() => {
        if (controller.preferredScreen) {
            setScreen(controller.preferredScreen);
        }
    }, [controller.preferredScreen]);

    return (
        <div className="grid min-h-screen grid-cols-1 bg-background text-foreground lg:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="grid-sheen border-r border-border/70 bg-card/70 p-5">
                <div className="mb-8">
                    <div className="mb-2 text-xs uppercase tracking-[0.3em] text-primary">Desktop Sender</div>
                    <h1 className="text-2xl font-semibold">Discord Auto Message Sender</h1>
                    <p className="mt-2 text-sm text-muted-foreground">GUI-first local control plane for config, preview, preflight, sessions, and logs.</p>
                </div>

                <nav className="space-y-2">
                    {navigation.map((item) => {
                        const Icon = item.icon;
                        return (
                            <button
                                key={item.id}
                                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
                                    screen === item.id
                                        ? 'border-primary/40 bg-primary/10 text-foreground'
                                        : 'border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-accent'
                                }`}
                                onClick={() => setScreen(item.id)}
                            >
                                <Icon className="h-4 w-4" />
                                {item.label}
                            </button>
                        );
                    })}
                </nav>
            </aside>

            <main className="p-5 lg:p-8">
                <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <div className="mb-2 flex items-center gap-3">
                            {controller.releaseDiagnostics ? (
                                <span className="font-mono text-xs text-muted-foreground">v{controller.releaseDiagnostics.appVersion} beta</span>
                            ) : null}
                            <Badge tone={toneFromStatus(controller.session?.status)}>{controller.session?.status ?? 'idle'}</Badge>
                            <Badge tone={toneFromSidecarStatus(controller.sidecarStatus)}>runtime {controller.sidecarStatus}</Badge>
                            <Badge
                                tone={
                                    controller.appReadiness.token.status === 'missing' || controller.appReadiness.token.status === 'corrupted'
                                        ? 'danger'
                                        : controller.appReadiness.token.status === 'environment'
                                            ? 'warning'
                                            : 'success'
                                }
                            >
                                token {controller.appReadiness.token.label}
                            </Badge>
                            <Badge tone={controller.appReadiness.config.status === 'invalid' || controller.appReadiness.config.status === 'missing' ? 'warning' : 'success'}>
                                config {controller.appReadiness.config.status}
                            </Badge>
                            {!controller.setupChecklist.complete ? (
                                <Badge tone="warning">
                                    setup {controller.setupChecklist.completedCount}/{controller.setupChecklist.totalCount}
                                </Badge>
                            ) : null}
                            {controller.session?.id ? <span className="font-mono text-xs text-muted-foreground">{controller.session.id}</span> : null}
                            {controller.draft.validationErrors.length > 0 ? <Badge tone="warning">{controller.draft.validationErrors.length} validation issue{controller.draft.validationErrors.length === 1 ? '' : 's'}</Badge> : null}
                        </div>
                        <p className="text-sm text-muted-foreground">{controller.notice}</p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <Button variant="secondary" onClick={async () => {
                            await controller.runDryRunCommand();
                            setScreen('preview');
                        }}>
                            <Shuffle className="mr-2 h-4 w-4" />
                            Dry Run
                        </Button>
                        <Button variant="secondary" onClick={async () => {
                            await controller.runPreflightCommand();
                            setScreen('session');
                        }}>
                            <TimerReset className="mr-2 h-4 w-4" />
                            Preflight
                        </Button>
                        {controller.hasActiveSession ? (
                            <Button
                                variant="danger"
                                disabled={controller.session?.status === 'stopping'}
                                onClick={async () => {
                                    await controller.stopCurrentSession();
                                    setScreen('session');
                                }}
                            >
                                <Square className="mr-2 h-4 w-4" />
                                {controller.session?.status === 'stopping' ? 'Stopping...' : 'Stop Session'}
                            </Button>
                        ) : (
                            <Button
                                disabled={!controller.appReadiness.canStartSession}
                                onClick={async () => {
                                await controller.startSessionCommand();
                                setScreen('session');
                            }}
                            >
                                <Play className="mr-2 h-4 w-4" />
                                {controller.senderState.resumeSession ? 'Resume Session' : 'Start Session'}
                            </Button>
                        )}
                    </div>
                </div>

                {controller.appReadiness.blockingIssues.length > 0 || controller.sidecarMessage ? (
                    <div className="mb-6 rounded-2xl border border-border bg-background/40 p-4 text-sm">
                        <div className="mb-2 font-medium">Desktop Readiness</div>
                        <div className="space-y-2 text-muted-foreground">
                            {controller.appReadiness.blockingIssues.map((issue) => (
                                <div key={issue}>{describeBlockingIssue(issue)}</div>
                            ))}
                            {controller.sidecarMessage ? <div>{controller.sidecarMessage}</div> : null}
                        </div>
                    </div>
                ) : null}

                {screen === 'dashboard' ? (
                    <DashboardScreen
                        groupedMetrics={controller.groupedMetrics}
                        latestSummary={controller.latestSummary}
                        senderState={controller.senderState}
                        hasActiveSession={controller.hasActiveSession}
                        appReadiness={controller.appReadiness}
                        setupChecklist={controller.setupChecklist}
                        recoveryState={controller.recoveryState}
                        runtimeMessage={controller.sidecarMessage}
                        onOpenConfig={() => setScreen('config')}
                        onOpenSession={() => setScreen('session')}
                        onRunDryRun={async () => {
                            await controller.runDryRunCommand();
                            setScreen('preview');
                        }}
                        onRunPreflight={async () => {
                            await controller.runPreflightCommand();
                            setScreen('session');
                        }}
                        onOpenLogs={async () => {
                            await controller.loadCurrentLogs();
                            setScreen('logs');
                        }}
                        onResumeSession={async () => {
                            await controller.startSessionCommand();
                            setScreen('session');
                        }}
                        onDiscardCheckpoint={async () => {
                            await controller.discardResumeCheckpoint();
                        }}
                    />
                ) : null}

                {screen === 'config' ? (
                    <ConfigScreen
                        draft={controller.draft}
                        setup={controller.setup}
                        tokenStatus={controller.appReadiness.token}
                        setupChecklist={controller.setupChecklist}
                        notice={controller.surfaceNotices.config}
                        environmentDraft={controller.environmentDraft}
                        runtime={controller.runtime}
                        onEnvironmentDraftChange={controller.setEnvironmentDraft}
                        onSaveEnvironment={async () => {
                            await controller.saveEnvironmentDraft();
                        }}
                        onClearSecureToken={async () => {
                            await controller.clearSecureToken();
                        }}
                        onOpenDataDirectory={async () => {
                            await controller.openDesktopDataDirectory();
                        }}
                        onOpenConfig={() => setScreen('config')}
                        onRunPreflight={async () => {
                            await controller.runPreflightCommand();
                            setScreen('session');
                        }}
                        onOpenSession={() => setScreen('session')}
                        onSaveConfig={async () => {
                            await controller.saveConfigDraft();
                        }}
                        onPreviewDryRun={async () => {
                            await controller.runDryRunCommand();
                            setScreen('preview');
                        }}
                    />
                ) : null}

                {screen === 'preview' ? (
                    <PreviewScreen
                        runtime={controller.runtime}
                        setRuntime={controller.setRuntime}
                        dryRun={controller.dryRun}
                        onRefreshPreview={async () => {
                            await controller.runDryRunCommand();
                        }}
                        onOpenConfig={() => setScreen('config')}
                    />
                ) : null}

                {screen === 'session' ? (
                    <SessionScreen
                        runtime={controller.runtime}
                        setRuntime={controller.setRuntime}
                        session={controller.session}
                        hasActiveSession={controller.hasActiveSession}
                        senderState={controller.senderState}
                        preflight={controller.preflight}
                        appReadiness={controller.appReadiness}
                        recoveryState={controller.recoveryState}
                        notice={controller.surfaceNotices.session}
                        runtimeMessage={controller.sidecarMessage}
                        onStart={async () => {
                            await controller.startSessionCommand();
                        }}
                        onRunPreflight={async () => {
                            await controller.runPreflightCommand();
                        }}
                        onPauseResume={async () => {
                            await controller.togglePauseResume();
                        }}
                        onStop={async () => {
                            await controller.stopCurrentSession();
                        }}
                        onDiscardCheckpoint={async () => {
                            await controller.discardResumeCheckpoint();
                        }}
                        onOpenConfig={() => setScreen('config')}
                    />
                ) : null}

                {screen === 'logs' ? (
                    <LogsScreen
                        logs={controller.logs}
                        sessionId={controller.currentLogSessionId}
                        notice={controller.surfaceNotices.logs}
                        onRefresh={async () => {
                            await controller.loadCurrentLogs();
                        }}
                        onOpenLogFile={async () => {
                            await controller.openCurrentLogFile();
                        }}
                    />
                ) : null}

                {screen === 'support' ? (
                    <SupportScreen
                        diagnostics={controller.releaseDiagnostics}
                        setup={controller.setup}
                        supportBundle={controller.supportBundle}
                        hasActiveSession={controller.hasActiveSession}
                        notice={controller.notice}
                        onCopyDiagnostics={async () => {
                            await controller.copyReleaseDiagnostics();
                        }}
                        onOpenDataDirectory={async () => {
                            await controller.openDesktopDataDirectory();
                        }}
                        onOpenLogsDirectory={async () => {
                            await controller.openLogsDirectory();
                        }}
                        onExportSupportBundle={async () => {
                            await controller.exportSupportBundle();
                        }}
                        onResetRuntimeState={async () => {
                            await controller.resetRuntimeState();
                        }}
                    />
                ) : null}
            </main>
        </div>
    );
}
