import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { AppConfig } from '@/lib/desktop';

interface ChannelsCardProps {
    channels: AppConfig['channels'];
    selectedChannelId: string | null;
    onAddChannel(): void;
    onSelectChannel(channelId: string): void;
}

export function ChannelsCard({
    channels,
    selectedChannelId,
    onAddChannel,
    onSelectChannel
}: ChannelsCardProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Channels</CardTitle>
                <CardDescription>Pick the channel you want to edit without stretching the page height around it.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <Button className="w-full" variant="secondary" onClick={onAddChannel}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Channel
                </Button>

                <div className="space-y-2 xl:max-h-[420px] xl:overflow-auto xl:pr-1">
                    {channels.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                            No channels configured yet.
                        </div>
                    ) : channels.map((channel) => (
                        <button
                            key={channel.id}
                            className={`w-full rounded-xl border p-3 text-left transition-all ${
                                selectedChannelId === channel.id
                                    ? 'border-primary/50 bg-primary/10 shadow-glow-sm'
                                    : 'border-border/50 bg-background/50 hover:border-border/80 hover:bg-accent/50'
                            }`}
                            onClick={() => onSelectChannel(channel.id)}
                        >
                            <div className="font-medium">{channel.name || 'Unnamed channel'}</div>
                            <div className="mt-1 font-mono text-xs text-muted-foreground">{channel.id}</div>
                            <div className="mt-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">{channel.messageGroup}</div>
                        </button>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
