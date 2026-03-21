import { AlertCircle, Play, Square } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { PreflightResult, RuntimeOptions, SessionSnapshot } from '@/lib/desktop';
import { NumberField, StateRow } from '@/shared/components';

interface SessionScreenProps {
    runtime: RuntimeOptions;
    setRuntime(next: RuntimeOptions): void;
    session: SessionSnapshot | null;
    preflight: PreflightResult | null;
    onStart(): void | Promise<void>;
    onPauseResume(): void | Promise<void>;
    onStop(): void | Promise<void>;
}

export function SessionScreen({ runtime, setRuntime, session, preflight, onStart, onPauseResume, onStop }: SessionScreenProps) {
    return (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card>
                <CardHeader>
                    <CardTitle>Preflight And Live Session</CardTitle>
                    <CardDescription>Run validation, inspect per-channel access results, and control the active sender worker.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                        <NumberField label="Messages / channel" value={runtime.numMessages} onChange={(value) => setRuntime({ ...runtime, numMessages: Number(value) })} />
                        <NumberField label="Base wait (sec)" value={runtime.baseWaitSeconds} onChange={(value) => setRuntime({ ...runtime, baseWaitSeconds: Number(value) })} />
                        <NumberField label="Random margin" value={runtime.marginSeconds} onChange={(value) => setRuntime({ ...runtime, marginSeconds: Number(value) })} />
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <Button onClick={onStart}>
                            <Play className="mr-2 h-4 w-4" />
                            Start
                        </Button>
                        <Button variant="secondary" onClick={onPauseResume} disabled={!session || !['running', 'paused'].includes(session.status)}>
                            {session?.status === 'paused' ? 'Resume' : 'Pause'}
                        </Button>
                        <Button variant="danger" onClick={onStop} disabled={!session || ['completed', 'failed'].includes(session.status)}>
                            <Square className="mr-2 h-4 w-4" />
                            Stop
                        </Button>
                    </div>

                    {preflight ? (
                        <div className="space-y-3 rounded-2xl border border-border bg-background/30 p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-sm font-semibold">Preflight Result</div>
                                    <div className="text-xs text-muted-foreground">{new Date(preflight.checkedAt).toLocaleString()}</div>
                                </div>
                                <Badge tone={preflight.ok ? 'success' : 'danger'}>{preflight.ok ? 'pass' : 'fail'}</Badge>
                            </div>

                            {preflight.issues.length > 0 ? (
                                <div className="space-y-2 text-sm text-amber-300">
                                    {preflight.issues.map((issue) => <div key={issue}>{issue}</div>)}
                                </div>
                            ) : (
                                <div className="text-sm text-muted-foreground">No blocking issues.</div>
                            )}

                            <div className="space-y-2">
                                {preflight.channels.map((channel) => (
                                    <div key={channel.channelId} className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-sm">
                                        <div>
                                            <div>{channel.channelName}</div>
                                            <div className="text-xs text-muted-foreground">{channel.reason ?? 'Access verified.'}</div>
                                        </div>
                                        <Badge tone={channel.ok ? 'success' : 'danger'}>
                                            {channel.ok ? 'ok' : channel.status ?? 'fail'}
                                        </Badge>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </CardContent>
            </Card>

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
                    {session?.summary ? (
                        <div className="rounded-xl border border-border bg-background/40 p-3">
                            <div className="mb-2 text-sm font-semibold">Final Summary</div>
                            <div className="space-y-2 text-muted-foreground">
                                <div>{session.summary.completedChannels}/{session.summary.totalChannels} channels completed</div>
                                <div>{session.summary.sentMessages} messages sent</div>
                            </div>
                        </div>
                    ) : null}
                    {session?.stopReason ? (
                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-red-200">
                            <div className="mb-1 flex items-center gap-2 font-medium">
                                <AlertCircle className="h-4 w-4" />
                                Stop reason
                            </div>
                            <div>{session.stopReason}</div>
                        </div>
                    ) : null}
                </CardContent>
            </Card>
        </section>
    );
}
