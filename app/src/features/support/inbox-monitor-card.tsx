import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { InboxMonitorSettings, InboxMonitorState } from '@/lib/desktop';

interface InboxMonitorCardProps {
    settings: InboxMonitorSettings;
    state: InboxMonitorState;
    tokenPresent: boolean;
    onSave(settings: InboxMonitorSettings): void | Promise<void>;
}

function statusLabel(state: InboxMonitorState) {
    switch (state.status) {
        case 'running':
            return 'running';
        case 'degraded':
            return 'degraded';
        case 'blocked':
            return 'blocked';
        case 'failed':
            return 'failed';
        case 'starting':
            return 'starting';
        default:
            return 'stopped';
    }
}

function formatLocalTimestamp(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function InboxMonitorCard({
    settings,
    state,
    tokenPresent,
    onSave
}: InboxMonitorCardProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Inbox Notifications</CardTitle>
                <CardDescription>Windows desktop toasts for new DMs and message requests while the app is running.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <label className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/50 p-4 text-sm text-foreground">
                    <span className="font-medium">Enable inbox notifications</span>
                    <Checkbox
                        checked={settings.enabled}
                        onCheckedChange={(checked) => void onSave({
                            ...settings,
                            enabled: checked === true
                        })}
                    />
                </label>

                <label className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/50 p-4 text-sm text-foreground">
                    <span className="font-medium">Notify on direct messages</span>
                    <Checkbox
                        checked={settings.notifyDirectMessages}
                        onCheckedChange={(checked) => void onSave({
                            ...settings,
                            notifyDirectMessages: checked === true
                        })}
                    />
                </label>

                <label className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/50 p-4 text-sm text-foreground">
                    <span className="font-medium">Notify on message requests</span>
                    <Checkbox
                        checked={settings.notifyMessageRequests}
                        onCheckedChange={(checked) => void onSave({
                            ...settings,
                            notifyMessageRequests: checked === true
                        })}
                    />
                </label>

                <label className="block space-y-2 text-sm text-muted-foreground">
                    <span>Poll interval in seconds</span>
                    <Input
                        type="number"
                        min={15}
                        max={300}
                        value={settings.pollIntervalSeconds}
                        onChange={(event) => void onSave({
                            ...settings,
                            pollIntervalSeconds: Number(event.target.value || settings.pollIntervalSeconds)
                        })}
                    />
                </label>

                <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-border/50 bg-background/50 p-4 text-sm">
                        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Monitor state</div>
                        <div className="mt-2 font-semibold text-foreground">{statusLabel(state)}</div>
                    </div>
                    <div className="rounded-xl border border-border/50 bg-background/50 p-4 text-sm">
                        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Token readiness</div>
                        <div className="mt-2 font-semibold text-foreground">{tokenPresent ? 'available' : 'missing'}</div>
                    </div>
                </div>

                {state.lastSuccessfulPollAt ? (
                    <div className="rounded-xl border border-border/50 bg-background/50 p-4 text-sm text-muted-foreground">
                        Last successful poll: <span className="font-mono text-xs text-foreground/90">{formatLocalTimestamp(state.lastSuccessfulPollAt)}</span>
                    </div>
                ) : null}

                {state.lastError ? (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                        {state.lastError}
                    </div>
                ) : null}

                <Button
                    variant="secondary"
                    disabled={!settings.enabled || !tokenPresent}
                    onClick={() => void onSave({ ...settings })}
                >
                    Save Notification Settings
                </Button>
            </CardContent>
        </Card>
    );
}
