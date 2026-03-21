import { useEffect, useState } from 'react';
import { Play, Shuffle, Square, TimerReset } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfigScreen } from '@/features/config/config-screen';
import { DashboardScreen } from '@/features/dashboard/dashboard-screen';
import { LogsScreen } from '@/features/logs/logs-screen';
import { PreviewScreen } from '@/features/preview/preview-screen';
import { SessionScreen } from '@/features/session/session-screen';
import { navigation, Screen } from '@/shared/screens';
import { toneFromStatus, useDesktopController } from '@/shared/use-desktop-controller';

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
                            <Badge tone={toneFromStatus(controller.session?.status)}>{controller.session?.status ?? 'idle'}</Badge>
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
                            <Button onClick={async () => {
                                await controller.startSessionCommand();
                                setScreen('session');
                            }}>
                                <Play className="mr-2 h-4 w-4" />
                                {controller.senderState.resumeSession ? 'Resume Session' : 'Start Session'}
                            </Button>
                        )}
                    </div>
                </div>

                {screen === 'dashboard' ? (
                    <DashboardScreen
                        groupedMetrics={controller.groupedMetrics}
                        latestSummary={controller.latestSummary}
                        senderState={controller.senderState}
                        hasActiveSession={controller.hasActiveSession}
                        onOpenConfig={() => setScreen('config')}
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
                        runtime={controller.runtime}
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
                        onStart={async () => {
                            await controller.startSessionCommand();
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
                    />
                ) : null}

                {screen === 'logs' ? (
                    <LogsScreen
                        logs={controller.logs}
                        onRefresh={async () => {
                            await controller.loadCurrentLogs();
                        }}
                        onOpenLogFile={async () => {
                            await controller.openCurrentLogFile();
                        }}
                    />
                ) : null}
            </main>
        </div>
    );
}
