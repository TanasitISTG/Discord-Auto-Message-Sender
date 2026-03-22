import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DryRunResult, RuntimeOptions } from '@/lib/desktop';
import { NumberField, StateRow } from '@/shared/components';

interface PreviewScreenProps {
    runtime: RuntimeOptions;
    setRuntime(next: RuntimeOptions): void;
    dryRun: DryRunResult | null;
    onRefreshPreview(): void | Promise<void>;
    onOpenConfig(): void;
}

export function PreviewScreen({ runtime, setRuntime, dryRun, onRefreshPreview, onOpenConfig }: PreviewScreenProps) {
    return (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card>
                <CardHeader>
                    <CardTitle>Dry Run Preview</CardTitle>
                    <CardDescription>No messages are sent. This is a local preview of channel selection, group resolution, and cadence.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                        <NumberField label="Messages / channel" value={runtime.numMessages} onChange={(value) => setRuntime({ ...runtime, numMessages: Number(value) })} />
                        <NumberField label="Base wait (sec)" value={runtime.baseWaitSeconds} onChange={(value) => setRuntime({ ...runtime, baseWaitSeconds: Number(value) })} />
                        <NumberField label="Random margin" value={runtime.marginSeconds} onChange={(value) => setRuntime({ ...runtime, marginSeconds: Number(value) })} />
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <Button onClick={onRefreshPreview}>Refresh Preview</Button>
                        <Button variant="secondary" onClick={onOpenConfig}>Open Config</Button>
                    </div>

                    {!dryRun ? (
                        <div className="rounded-xl border border-dashed border-border/50 bg-background/50 p-6 text-sm text-center text-muted-foreground">Run a dry run to generate a send preview.</div>
                    ) : (
                        <div className="space-y-3">
                            {dryRun.channels.map((channel) => (
                                <div key={channel.channelId} className="rounded-xl border border-border/50 bg-background/50 p-5 shadow-sm">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <div>
                                            <div className="font-semibold text-foreground tracking-tight">{channel.channelName}</div>
                                            <div className="text-[11px] font-semibold tracking-tight text-muted-foreground mt-0.5">{channel.groupName}</div>
                                        </div>
                                        <Badge tone={channel.skipReasons.length === 0 ? 'success' : 'warning'}>
                                            {channel.skipReasons.length === 0 ? 'sendable' : 'skipped'}
                                        </Badge>
                                    </div>
                                    <div className="mb-4 text-xs leading-relaxed text-muted-foreground">
                                        Cadence: {channel.cadence.numMessages === 0 ? 'infinite until stopped' : `${channel.cadence.numMessages} messages`} with {channel.cadence.baseWaitSeconds}s base wait and {channel.cadence.marginSeconds}s margin.
                                    </div>
                                    <div className="space-y-2">
                                        {channel.sampleMessages.length === 0 ? (
                                            <div className="text-sm text-muted-foreground">No messages resolved for this channel.</div>
                                        ) : channel.sampleMessages.map((message, index) => (
                                            <div key={`${channel.channelId}-${index}`} className="rounded-xl border border-border/60 bg-background/40 px-4 py-3 text-sm text-foreground/90 shadow-inner-glow">
                                                {message}
                                            </div>
                                        ))}
                                    </div>
                                    {channel.skipReasons.length > 0 ? (
                                        <div className="mt-4 space-y-1 text-xs text-amber-300">
                                            {channel.skipReasons.map((reason) => <div key={reason}>{reason}</div>)}
                                        </div>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Preview Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    <StateRow label="Will send messages" value={dryRun?.willSendMessages ? 'Yes' : 'No'} />
                    <StateRow label="Selected channels" value={String(dryRun?.summary.selectedChannels ?? 0)} />
                    <StateRow label="Skipped channels" value={String(dryRun?.summary.skippedChannels ?? 0)} />
                    <StateRow label="Sample messages" value={String(dryRun?.summary.totalSampleMessages ?? 0)} />
                    <div className="rounded-xl border border-border/50 bg-background/50 p-4 text-sm leading-relaxed text-muted-foreground shadow-sm">
                        {dryRun?.willSendMessages
                            ? 'Dry run confirms the current config can resolve at least one sendable channel.'
                            : 'Visible no-send state: fix skipped channels before starting a live session.'}
                    </div>
                </CardContent>
            </Card>
        </section>
    );
}
