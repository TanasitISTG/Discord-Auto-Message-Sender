import { useEffect, useState } from 'react';
import { Play, Send, Shuffle, Square, TimerReset } from 'lucide-react';
import { Toaster } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfigScreen } from '@/features/config/config-screen';
import { DashboardScreen } from '@/features/dashboard/dashboard-screen';
import { LogsScreen } from '@/features/logs/logs-screen';
import { PreviewScreen } from '@/features/preview/preview-screen';
import { SessionScreen } from '@/features/session/session-screen';
import { SupportScreen } from '@/features/support/support-screen';
import { DesktopConfirmDialog } from '@/shared/desktop-confirm-dialog';
import { navigation, Screen } from '@/shared/screens';
import { toneFromStatus, useDesktopController } from '@/shared/use-desktop-controller';
import { describeBlockingIssue } from '@/shared/readiness';

export default function App() {
    const [screen, setScreen] = useState<Screen>('dashboard');
    const controller = useDesktopController();

    useEffect(() => {
        if (controller.preferredScreen) {
            setScreen(controller.preferredScreen);
        }
    }, [controller.preferredScreen]);

    return (
        <div className="grid min-h-screen grid-cols-1 bg-background text-foreground lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="grid-sheen flex flex-col border-r border-border/50 bg-card/40">
                <div className="p-5 pb-6">
                    <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-primary">
                        <Send className="h-4 w-4" />
                        <span>Desktop Sender</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">GUI-first local control plane for Discord messaging.</p>
                </div>

                <nav className="flex-1 space-y-1.5 px-3">
                    {navigation.map((item) => {
                        const Icon = item.icon;
                        const isActive = screen === item.id;
                        return (
                            <button
                                key={item.id}
                                className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all ${
                                    isActive
                                        ? 'bg-primary/10 text-cyan-50 shadow-inner-glow'
                                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                                }`}
                                onClick={() => setScreen(item.id)}
                            >
                                {isActive && (
                                    <div className="absolute inset-y-1/4 left-0 w-1 rounded-r-full bg-primary shadow-glow-sm" />
                                )}
                                <Icon className="h-4 w-4" />
                                {item.label}
                            </button>
                        );
                    })}
                </nav>

                <div className="border-t border-border/50 p-4">
                    <div className="flex flex-col gap-2.5">
                        {controller.releaseDiagnostics ? (
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Version</span>
                                <span className="font-mono text-[11px]">v{controller.releaseDiagnostics.appVersion} beta</span>
                            </div>
                        ) : null}
                        {controller.session?.id ? (
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Session ID</span>
                                <span className="ml-2 truncate font-mono text-[11px]">{controller.session.id.split('-')[0]}</span>
                            </div>
                        ) : null}
                        {!controller.setupChecklist.complete ? (
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Setup tasks</span>
                                <Badge tone="warning" className="px-1.5 py-0 text-[9px]">{controller.setupChecklist.completedCount}/{controller.setupChecklist.totalCount}</Badge>
                            </div>
                        ) : null}
                        <div className="mt-1 flex items-center justify-between border-t border-border/30 pt-3">
                            <span className="text-xs text-muted-foreground">Sidecar runtime</span>
                            <div className="flex items-center gap-2">
                                {controller.sidecarStatus === 'ready' ? (
                                    <span className="relative flex h-2 w-2">
                                        <span className="absolute inline-flex h-full w-full animate-pulse-slow rounded-full bg-emerald-400 opacity-75"></span>
                                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                                    </span>
                                ) : (
                                    <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                                )}
                                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-foreground/90">{controller.sidecarStatus}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </aside>

            <main className="flex flex-col">
                <header className="sticky top-0 z-10 flex min-h-[56px] items-center justify-between border-b border-border/50 bg-background/80 px-5 py-3 backdrop-blur-md lg:px-8">
                    <div className="flex items-center gap-3 sm:gap-4">
                        <h2 className="text-sm font-semibold tracking-wide text-foreground">
                            {navigation.find((n) => n.id === screen)?.label ?? 'Dashboard'}
                        </h2>
                        
                        <div className="hidden h-4 w-px bg-border/60 sm:block" />

                        <div className="hidden items-center gap-2 sm:flex">
                            <Badge tone={toneFromStatus(controller.session?.status)}>{controller.session?.status ?? 'idle'}</Badge>
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
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button size="sm" variant="secondary" onClick={async () => {
                            await controller.runDryRunCommand();
                            setScreen('preview');
                        }}>
                            <Shuffle className="mr-2 h-3.5 w-3.5" />
                            Dry Run
                        </Button>
                        <Button size="sm" variant="secondary" onClick={async () => {
                            await controller.runPreflightCommand();
                            setScreen('session');
                        }}>
                            <TimerReset className="mr-2 h-3.5 w-3.5" />
                            Preflight
                        </Button>
                        {controller.hasActiveSession ? (
                            <Button
                                size="sm"
                                variant="danger"
                                disabled={controller.session?.status === 'stopping'}
                                onClick={async () => {
                                    await controller.stopCurrentSession();
                                    setScreen('session');
                                }}
                            >
                                <Square className="mr-2 h-3.5 w-3.5" />
                                {controller.session?.status === 'stopping' ? 'Stopping...' : 'Stop'}
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                disabled={!controller.appReadiness.canStartSession}
                                onClick={async () => {
                                    await controller.startSessionCommand();
                                    setScreen('session');
                                }}
                            >
                                <Play className="mr-2 h-3.5 w-3.5" />
                                {controller.senderState.resumeSession ? 'Resume' : 'Start'}
                            </Button>
                        )}
                    </div>
                </header>

                <div className="flex-1 p-5 lg:p-8">
                    {controller.appReadiness.blockingIssues.length > 0 || controller.sidecarMessage || controller.draft.validationErrors.length > 0 ? (
                        <div className="mb-6 flex flex-col gap-2">
                            {controller.appReadiness.blockingIssues.map((issue) => (
                                <div key={issue} className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                                    <span className="font-semibold uppercase tracking-[0.1em] text-amber-400">Readiness</span>
                                    <span>{describeBlockingIssue(issue)}</span>
                                </div>
                            ))}
                            {controller.sidecarMessage ? (
                                <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                                    <span className="font-semibold uppercase tracking-[0.1em] text-red-400">Runtime</span>
                                    <span>{controller.sidecarMessage}</span>
                                </div>
                            ) : null}
                            {controller.draft.validationErrors.length > 0 ? (
                                <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                                    <span className="font-semibold uppercase tracking-[0.1em] text-amber-400">Config</span>
                                    <span>{controller.draft.validationErrors.length} validation issue{controller.draft.validationErrors.length === 1 ? '' : 's'}</span>
                                </div>
                            ) : null}
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
                </div>
            </main>
            <DesktopConfirmDialog
                dialog={controller.confirmDialog}
                pending={controller.confirmDialogPending}
                onClose={controller.closeConfirmation}
                onConfirm={controller.confirmCurrentDialog}
            />
            <Toaster
                position="top-right"
                richColors
                closeButton
                theme="dark"
                toastOptions={{
                    classNames: {
                        toast: 'border border-border/60 bg-card/95 text-foreground shadow-[0_18px_48px_rgba(0,0,0,0.4)]',
                        title: 'text-sm font-medium',
                        description: 'text-xs text-muted-foreground'
                    }
                }}
            />
        </div>
    );
}
