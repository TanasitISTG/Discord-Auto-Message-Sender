import { Badge } from '@/components/ui/badge';
import type { PreflightResult } from '@/lib/desktop';

interface SessionPreflightResultProps {
    preflight: PreflightResult | null;
}

export function SessionPreflightResult({ preflight }: SessionPreflightResultProps) {
    if (!preflight) {
        return null;
    }

    return (
        <div className="space-y-4 rounded-xl border border-border/50 bg-background/50 p-5 shadow-xs backdrop-blur-xs">
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-sm font-semibold tracking-tight">Preflight Result</div>
                    <div className="mt-0.5 text-[11px] font-semibold tracking-tight text-muted-foreground">
                        {new Date(preflight.checkedAt).toLocaleString()}
                    </div>
                </div>
                <Badge tone={preflight.ok ? 'success' : 'danger'}>{preflight.ok ? 'pass' : 'fail'}</Badge>
            </div>

            {preflight.issues.length > 0 ? (
                <div className="space-y-2 text-xs leading-relaxed text-amber-300">
                    {preflight.issues.map((issue) => (
                        <div key={issue}>{issue}</div>
                    ))}
                </div>
            ) : (
                <div className="text-xs leading-relaxed text-muted-foreground">No blocking issues.</div>
            )}

            <div className="grid gap-2">
                {preflight.channels.map((channel) => (
                    <div
                        key={channel.channelId}
                        className="flex items-center justify-between rounded-xl border border-border/60 bg-background/40 px-4 py-3 text-sm shadow-inner-glow"
                    >
                        <div>
                            <div className="font-medium text-foreground">{channel.channelName}</div>
                            <div className="mt-0.5 text-[11px] font-semibold tracking-tight text-muted-foreground">
                                {channel.reason ?? 'Access verified.'}
                            </div>
                        </div>
                        <Badge tone={channel.skipped ? 'neutral' : channel.ok ? 'success' : 'danger'}>
                            {channel.skipped ? 'skipped' : channel.ok ? 'ok' : (channel.status ?? 'fail')}
                        </Badge>
                    </div>
                ))}
            </div>
        </div>
    );
}
