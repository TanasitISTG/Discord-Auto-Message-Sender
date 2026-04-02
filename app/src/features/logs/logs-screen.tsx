import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SurfaceNotice } from '@/controllers/desktop/types';
import type { LogEntry } from '@/lib/desktop';
import { InlineNotice } from '@/shared/components';

interface LogsScreenProps {
    logs: LogEntry[];
    sessionId: string | null;
    notice?: SurfaceNotice;
    onRefresh(): void | Promise<void>;
    onOpenLogFile(): void | Promise<void>;
}

const EVENT_LABELS: Record<string, string> = {
    channel_completed: 'Channel completed',
    channel_failed: 'Channel failure',
    channel_missing_messages: 'Missing message group',
    channel_started: 'Channel started',
    channel_suppressed: 'Channel suppressed',
    http_error: 'HTTP error',
    message_sent: 'Message sent',
    quiet_hours_wait: 'Quiet-hours pause',
    rate_limit_wait: 'Rate-limit cooldown',
    rate_limited: 'Rate limit',
    request_error: 'Request error',
    resume_suppression_wait: 'Resume cooldown',
    session_segment_started: 'Session segment',
};

function levelTone(level: LogEntry['level']): 'neutral' | 'success' | 'warning' | 'danger' {
    switch (level) {
        case 'success':
            return 'success';
        case 'warning':
            return 'warning';
        case 'error':
            return 'danger';
        default:
            return 'neutral';
    }
}

function resolveEventKey(log: LogEntry): string {
    return typeof log.meta?.event === 'string' ? log.meta.event : 'eventless';
}

function resolveEventLabel(log: LogEntry): string {
    const eventKey = resolveEventKey(log);
    if (eventKey === 'session_segment_started') {
        return log.segmentKind === 'resumed' ? 'Resumed from checkpoint' : 'Fresh session start';
    }

    return (
        EVENT_LABELS[eventKey] ??
        eventKey
            .split('_')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ')
    );
}

function formatMeta(log: LogEntry) {
    const details: string[] = [];
    if (typeof log.meta?.retryAfter === 'number') {
        details.push(`Retry ${log.meta.retryAfter}s`);
    }
    if (typeof log.meta?.pacingMs === 'number') {
        details.push(`Pacing ${log.meta.pacingMs} ms`);
    }
    if (typeof log.meta?.counter === 'string') {
        details.push(`Counter ${log.meta.counter}`);
    }
    if (typeof log.meta?.status === 'number') {
        details.push(`HTTP ${log.meta.status}`);
    }
    return details;
}

function buildEventOptions(logs: LogEntry[]) {
    const examples = new Map<string, LogEntry>();
    for (const log of logs) {
        const key = resolveEventKey(log);
        if (!examples.has(key)) {
            examples.set(key, log);
        }
    }

    return [...examples.entries()]
        .map(([key, example]) => ({
            key,
            label: resolveEventLabel(example),
        }))
        .sort((left, right) => left.label.localeCompare(right.label));
}

export function LogsScreen({ logs, sessionId, notice, onRefresh, onOpenLogFile }: LogsScreenProps) {
    const [eventFilter, setEventFilter] = useState('all');

    const eventOptions = useMemo(() => buildEventOptions(logs), [logs]);
    const filteredLogs = useMemo(
        () => (eventFilter === 'all' ? logs : logs.filter((log) => resolveEventKey(log) === eventFilter)),
        [eventFilter, logs],
    );

    return (
        <section aria-label="Logs workspace" className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="xl:sticky xl:top-8 self-start">
                <Card>
                    <CardHeader>
                        <CardTitle>Log Controls</CardTitle>
                        <CardDescription>
                            Filter the current session log and open the underlying JSONL file.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {notice ? <InlineNotice tone={notice.tone} message={notice.message} /> : null}

                        <div className="space-y-2">
                            <label className="block text-sm text-muted-foreground" htmlFor="logs-event-filter">
                                Filter by event
                            </label>
                            <Select value={eventFilter} onValueChange={setEventFilter}>
                                <SelectTrigger aria-label="Filter by event" id="logs-event-filter">
                                    <SelectValue placeholder="All events" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All events</SelectItem>
                                    {eventOptions.map((option) => (
                                        <SelectItem key={option.key} value={option.key}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-2">
                            <Button variant="secondary" onClick={() => void onRefresh()}>
                                Refresh From Disk
                            </Button>
                            <Button onClick={() => void onOpenLogFile()} disabled={!sessionId}>
                                Open Log File
                            </Button>
                        </div>

                        <div className="rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-sm text-muted-foreground">
                            {sessionId ? `Session ${sessionId}` : 'No session log selected yet.'}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Structured Log</CardTitle>
                    <CardDescription>
                        {filteredLogs.length} visible entr{filteredLogs.length === 1 ? 'y' : 'ies'}.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {filteredLogs.length === 0 ? (
                        <div className="rounded-lg border border-border/50 bg-background/50 px-4 py-6 text-sm text-muted-foreground">
                            No log entries match the current filter.
                        </div>
                    ) : (
                        filteredLogs.map((log) => {
                            const eventLabel = resolveEventLabel(log);
                            const metaDetails = formatMeta(log);

                            return (
                                <div
                                    key={log.id}
                                    className="rounded-lg border border-border/50 bg-background/50 px-4 py-3"
                                >
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge tone={levelTone(log.level)}>{log.level}</Badge>
                                        <div className="text-sm font-medium text-foreground">{eventLabel}</div>
                                        {log.segmentKind ? (
                                            <div className="text-xs text-muted-foreground">
                                                {log.segmentKind === 'resumed' ? 'Resumed segment' : 'Fresh segment'}
                                            </div>
                                        ) : null}
                                    </div>
                                    <div className="mt-2 text-sm text-foreground">{log.message}</div>
                                    {metaDetails.length > 0 ? (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {metaDetails.map((detail) => (
                                                <div
                                                    key={detail}
                                                    className="rounded-md border border-border/50 bg-card px-2 py-1 text-xs text-muted-foreground"
                                                >
                                                    {detail}
                                                </div>
                                            ))}
                                        </div>
                                    ) : null}
                                    <div className="mt-2 text-xs text-muted-foreground">
                                        {new Date(log.timestamp).toLocaleString()} - {log.context}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </CardContent>
            </Card>
        </section>
    );
}
