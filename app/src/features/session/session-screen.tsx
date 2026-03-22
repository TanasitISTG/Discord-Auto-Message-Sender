import { AlertCircle, Play, Square } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { PreflightResult, RuntimeOptions, SenderStateRecord, SessionSnapshot } from '@/lib/desktop';
import { InlineNotice, NumberField, StateRow } from '@/shared/components';
import type { AppReadiness } from '@/shared/readiness';
import { describeBlockingIssue } from '@/shared/readiness';
import type { RecoveryState, SurfaceNotice } from '@/shared/use-desktop-controller';

interface SessionScreenProps {
    runtime: RuntimeOptions;
    setRuntime(next: RuntimeOptions): void;
    session: SessionSnapshot | null;
    hasActiveSession: boolean;
    senderState: SenderStateRecord;
    preflight: PreflightResult | null;
    appReadiness: AppReadiness;
    recoveryState: RecoveryState | null;
    notice?: SurfaceNotice;
    runtimeMessage?: string | null;
    onStart(): void | Promise<void>;
    onRunPreflight(): void | Promise<void>;
    onPauseResume(): void | Promise<void>;
    onStop(): void | Promise<void>;
    onDiscardCheckpoint(): void | Promise<void>;
    onOpenConfig(): void;
}

export function SessionScreen({
    runtime,
    setRuntime,
    session,
    hasActiveSession,
    senderState,
    preflight,
    appReadiness,
    recoveryState,
    notice,
    runtimeMessage,
    onStart,
    onRunPreflight,
    onPauseResume,
    onStop,
    onDiscardCheckpoint,
    onOpenConfig
}: SessionScreenProps) {
    const healthEntries = Object.values(session?.channelHealth ?? senderState.channelHealth ?? {}).filter((entry) => entry.status !== 'healthy');
    const resumeSession = senderState.resumeSession;
    const suppressedEntries = Object.values(session?.channelProgress ?? {}).filter((entry) => entry.status === 'suppressed');
    const runModeLabel = recoveryState
        ? 'Runtime interrupted'
        : session?.status === 'stopping'
            ? 'Stopping after current send'
            : suppressedEntries.length > 0
                ? 'Waiting on cooldown'
                : session?.resumedFromCheckpoint
                    ? 'Resumed from checkpoint'
                    : session
                        ? 'Fresh run'
                        : resumeSession
                            ? 'Next start will resume checkpoint'
                            : 'Fresh run';

    return (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card>
                <CardHeader>
                    <CardTitle>Preflight And Live Session</CardTitle>
                    <CardDescription>Run validation, inspect per-channel access results, and control the active sender worker.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <Badge tone={recoveryState || suppressedEntries.length > 0 || session?.status === 'stopping' || session?.resumedFromCheckpoint ? 'warning' : 'success'}>
                            {runModeLabel}
                        </Badge>
                        {session?.currentSegmentId ? (
                            <span className="font-mono text-xs text-muted-foreground">{session.currentSegmentId}</span>
                        ) : null}
                    </div>

                    {notice ? <InlineNotice tone={notice.tone} message={notice.message} /> : null}

                    {recoveryState ? (
                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100 shadow-sm backdrop-blur-sm">
                            <div className="font-semibold tracking-tight">Runtime interrupted</div>
                            <div className="mt-1 text-red-50/80 leading-relaxed">{recoveryState.message}</div>
                            <div className="mt-3 text-[11px] font-semibold tracking-tight text-red-50/70">
                                Interrupted {new Date(recoveryState.interruptedAt).toLocaleString()}
                            </div>
                        </div>
                    ) : null}

                    {suppressedEntries.length > 0 ? (
                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100 shadow-sm backdrop-blur-sm">
                            <div className="font-semibold tracking-tight">Waiting on cooldown</div>
                            <div className="mt-1 text-amber-50/80 leading-relaxed">
                                {suppressedEntries.length} channel{suppressedEntries.length === 1 ? '' : 's'} currently suppressed and waiting for the next retry window.
                            </div>
                        </div>
                    ) : null}

                    <div className="grid gap-3 md:grid-cols-3">
                        <NumberField label="Messages / channel" value={runtime.numMessages} onChange={(value) => setRuntime({ ...runtime, numMessages: Number(value) })} />
                        <NumberField label="Base wait (sec)" value={runtime.baseWaitSeconds} onChange={(value) => setRuntime({ ...runtime, baseWaitSeconds: Number(value) })} />
                        <NumberField label="Random margin" value={runtime.marginSeconds} onChange={(value) => setRuntime({ ...runtime, marginSeconds: Number(value) })} />
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <Button onClick={onStart} disabled={hasActiveSession || !appReadiness.canStartSession}>
                            <Play className="mr-2 h-4 w-4" />
                            {resumeSession && !session ? 'Resume' : 'Start'}
                        </Button>
                        <Button variant="secondary" onClick={onRunPreflight}>
                            Run Preflight
                        </Button>
                        <Button variant="secondary" onClick={onPauseResume} disabled={appReadiness.sidecar !== 'ready' || !session || !['running', 'paused'].includes(session.status)}>
                            {session?.status === 'paused' ? 'Resume' : 'Pause'}
                        </Button>
                        <Button variant="danger" onClick={onStop} disabled={appReadiness.sidecar !== 'ready' || !session || ['completed', 'failed', 'stopping'].includes(session.status)}>
                            <Square className="mr-2 h-4 w-4" />
                            {session?.status === 'stopping' ? 'Stopping...' : 'Stop'}
                        </Button>
                    </div>

                    {appReadiness.blockingIssues.length > 0 || runtimeMessage ? (
                        <div className="space-y-3 rounded-xl border border-border/50 bg-background/50 p-4 text-sm shadow-sm backdrop-blur-sm">
                            {appReadiness.blockingIssues.map((issue) => (
                                <div key={issue} className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-amber-100 shadow-sm">
                                    <div className="leading-relaxed">{describeBlockingIssue(issue)}</div>
                                    {(issue === 'token_missing' || issue === 'config_missing' || issue === 'config_invalid') ? (
                                        <Button size="sm" className="mt-4" onClick={onOpenConfig}>
                                            Open Config
                                        </Button>
                                    ) : null}
                                </div>
                            ))}
                            {runtimeMessage ? (
                                <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-100 leading-relaxed shadow-sm">
                                    {runtimeMessage}
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {preflight ? (
                        <div className="space-y-4 rounded-xl border border-border/50 bg-background/50 p-5 shadow-sm backdrop-blur-sm">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-sm font-semibold tracking-tight">Preflight Result</div>
                                    <div className="text-[11px] font-semibold tracking-tight text-muted-foreground mt-0.5">{new Date(preflight.checkedAt).toLocaleString()}</div>
                                </div>
                                <Badge tone={preflight.ok ? 'success' : 'danger'}>{preflight.ok ? 'pass' : 'fail'}</Badge>
                            </div>

                            {preflight.issues.length > 0 ? (
                                <div className="space-y-2 text-xs leading-relaxed text-amber-300">
                                    {preflight.issues.map((issue) => <div key={issue}>{issue}</div>)}
                                </div>
                            ) : (
                                <div className="text-xs leading-relaxed text-muted-foreground">No blocking issues.</div>
                            )}

                            <div className="grid gap-2">
                                {preflight.channels.map((channel) => (
                                    <div key={channel.channelId} className="flex items-center justify-between rounded-xl border border-border/60 bg-background/40 shadow-inner-glow px-4 py-3 text-sm">
                                        <div>
                                            <div className="font-medium text-foreground">{channel.channelName}</div>
                                            <div className="text-[11px] font-semibold tracking-tight text-muted-foreground mt-0.5">{channel.reason ?? 'Access verified.'}</div>
                                        </div>
                                        <Badge tone={channel.skipped ? 'neutral' : channel.ok ? 'success' : 'danger'}>
                                            {channel.skipped ? 'skipped' : channel.ok ? 'ok' : channel.status ?? 'fail'}
                                        </Badge>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {resumeSession && !session ? (
                        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-50 shadow-sm backdrop-blur-sm">
                            <div className="font-semibold tracking-tight">Interrupted session available</div>
                            <div className="mt-1 text-[11px] font-semibold tracking-tight text-cyan-50/70">
                                Last checkpoint: {new Date(resumeSession.updatedAt).toLocaleString()}
                            </div>
                            <div className="mt-3 text-cyan-50/80 leading-relaxed">
                                Start will continue with {resumeSession.runtime.numMessages === 0 ? 'infinite' : resumeSession.runtime.numMessages} messages per channel and the saved pacing/recent-history state.
                            </div>
                            <div className="mt-5 flex flex-wrap gap-3">
                                <Button size="sm" onClick={onStart} disabled={!appReadiness.canStartSession}>
                                    <Play className="mr-2 h-4 w-4" />
                                    Resume Session
                                </Button>
                                <Button size="sm" variant="secondary" onClick={onDiscardCheckpoint}>
                                    Discard Checkpoint
                                </Button>
                            </div>
                        </div>
                    ) : null}
                </CardContent>
            </Card>

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
                        <StateRow label="Pacing" value={session?.pacing ? `${session.pacing.currentRequestIntervalMs} ms` : 'Baseline'} />
                        <StateRow label="Peak pacing" value={session?.pacing ? `${session.pacing.maxRequestIntervalMs} ms` : 'Baseline'} />
                        <StateRow label="Rate-limit count" value={String(session?.pacing?.recentRateLimitCount ?? 0)} />
                        {session?.summary ? (
                            <div className="rounded-xl border border-border/50 bg-background/50 p-4 shadow-sm mt-2">
                                <div className="mb-2 text-sm font-semibold tracking-tight">Final Summary</div>
                                <div className="space-y-2 text-muted-foreground leading-relaxed">
                                    <div>{session.summary.completedChannels}/{session.summary.totalChannels} channels completed</div>
                                    <div>{session.summary.sentMessages} messages sent</div>
                                    <div>{session.summary.rateLimitEvents ?? 0} rate-limit events</div>
                                </div>
                            </div>
                        ) : null}
                        {session?.stopReason ? (
                            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-200 shadow-sm mt-2">
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
                        <CardDescription>Suppressed channels cool down instead of thrashing the session with repeated failures.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {healthEntries.length === 0 ? (
                            <div className="text-sm text-muted-foreground">All tracked channels are healthy.</div>
                        ) : healthEntries.map((entry) => (
                            <div key={entry.channelId} className="rounded-xl border border-border/50 bg-background/50 p-4 text-sm shadow-sm transition-colors hover:bg-card/60">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="font-medium text-foreground">{entry.channelName}</div>
                                    <Badge tone={entry.status === 'suppressed' ? 'warning' : entry.status === 'failed' ? 'danger' : 'neutral'}>
                                        {entry.status}
                                    </Badge>
                                </div>
                                <div className="mt-3 text-muted-foreground leading-relaxed">{entry.lastReason ?? 'No reason recorded.'}</div>
                                <div className="mt-3 text-[11px] font-semibold tracking-tight text-muted-foreground uppercase">
                                    {entry.suppressedUntil ? `Suppressed until ${new Date(entry.suppressedUntil).toLocaleString()}` : `${entry.consecutiveRateLimits} rate limits, ${entry.consecutiveFailures} failures`}
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>
        </section>
    );
}
