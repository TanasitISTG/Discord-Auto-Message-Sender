import { Play, Square } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { RecoveryState, SurfaceNotice } from '@/controllers/desktop/types';
import type { PreflightResult, RuntimeOptions, SenderStateRecord, SessionSnapshot } from '@/lib/desktop';
import { NumberField } from '@/shared/components';
import type { AppReadiness } from '@/shared/readiness';
import { SessionAlerts } from './session-alerts';
import { SessionPreflightResult } from './session-preflight-result';
import { SessionSidebar } from './session-sidebar';

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
    onOpenConfig,
}: SessionScreenProps) {
    const healthEntries = Object.values(session?.channelHealth ?? senderState.channelHealth ?? {}).filter(
        (entry) => entry.status !== 'healthy',
    );
    const resumeSession = senderState.resumeSession;
    const canResumeCheckpoint = Boolean(resumeSession && !hasActiveSession);
    const checkpoint = canResumeCheckpoint ? resumeSession : null;
    const suppressedEntries = Object.values(session?.channelProgress ?? {}).filter(
        (entry) => entry.status === 'suppressed',
    );
    const runModeLabel = recoveryState
        ? 'Runtime interrupted'
        : session?.status === 'stopping'
          ? 'Stopping after current send'
          : session?.status === 'stopped'
            ? 'Stopped with checkpoint ready'
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
        <section aria-label="Session workspace" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card>
                <CardHeader>
                    <CardTitle>Preflight And Live Session</CardTitle>
                    <CardDescription>
                        Run validation, inspect per-channel access results, and control the active sender worker.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <Badge
                            tone={
                                recoveryState ||
                                suppressedEntries.length > 0 ||
                                session?.status === 'stopping' ||
                                session?.resumedFromCheckpoint
                                    ? 'warning'
                                    : 'success'
                            }
                        >
                            {runModeLabel}
                        </Badge>
                        {session?.currentSegmentId ? (
                            <span className="font-mono text-xs text-muted-foreground">{session.currentSegmentId}</span>
                        ) : null}
                    </div>

                    <SessionAlerts
                        notice={notice}
                        recoveryState={recoveryState}
                        suppressedCount={suppressedEntries.length}
                        appReadiness={appReadiness}
                        runtimeMessage={runtimeMessage}
                        checkpoint={checkpoint}
                        onStart={onStart}
                        onDiscardCheckpoint={onDiscardCheckpoint}
                        onOpenConfig={onOpenConfig}
                    />

                    <div className="grid gap-3 md:grid-cols-3">
                        <NumberField
                            label="Messages / channel"
                            value={runtime.numMessages}
                            onChange={(value) => setRuntime({ ...runtime, numMessages: Number(value) })}
                        />
                        <NumberField
                            label="Base wait (sec)"
                            value={runtime.baseWaitSeconds}
                            onChange={(value) => setRuntime({ ...runtime, baseWaitSeconds: Number(value) })}
                        />
                        <NumberField
                            label="Random margin"
                            value={runtime.marginSeconds}
                            onChange={(value) => setRuntime({ ...runtime, marginSeconds: Number(value) })}
                        />
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <Button onClick={onStart} disabled={hasActiveSession || !appReadiness.canStartSession}>
                            <Play className="mr-2 h-4 w-4" />
                            {canResumeCheckpoint ? 'Resume' : 'Start'}
                        </Button>
                        <Button variant="secondary" onClick={onRunPreflight}>
                            Run Preflight
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={onPauseResume}
                            disabled={
                                appReadiness.sidecar !== 'ready' ||
                                !session ||
                                !['running', 'paused'].includes(session.status)
                            }
                        >
                            {session?.status === 'paused' ? 'Resume' : 'Pause'}
                        </Button>
                        <Button
                            variant="danger"
                            onClick={onStop}
                            disabled={
                                appReadiness.sidecar !== 'ready' ||
                                !session ||
                                ['completed', 'failed', 'stopping', 'stopped'].includes(session.status)
                            }
                        >
                            <Square className="mr-2 h-4 w-4" />
                            {session?.status === 'stopping' ? 'Stopping...' : 'Stop'}
                        </Button>
                    </div>

                    <SessionPreflightResult preflight={preflight} />
                </CardContent>
            </Card>

            <div className="xl:sticky xl:top-8 self-start">
                <SessionSidebar session={session} healthEntries={healthEntries} />
            </div>
        </section>
    );
}
