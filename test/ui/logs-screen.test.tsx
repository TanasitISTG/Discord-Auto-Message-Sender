import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LogsScreen } from '../../app/src/features/logs/logs-screen';

const logs = [
    {
        id: 'segment-2-marker',
        timestamp: '2026-03-21T10:05:00.000Z',
        level: 'info' as const,
        context: 'Session',
        message: 'Resumed from saved checkpoint.',
        sessionId: 'session-1',
        segmentId: 'segment-2',
        segmentKind: 'resumed' as const,
        meta: {
            event: 'session_segment_started',
        },
    },
    {
        id: '2',
        timestamp: '2026-03-21T10:04:30.000Z',
        level: 'warning' as const,
        context: 'BLACK MARKET',
        message: 'Rate Limit! Waiting 120s...',
        sessionId: 'session-1',
        segmentId: 'segment-2',
        segmentKind: 'resumed' as const,
        meta: {
            event: 'rate_limit_wait',
            retryAfter: 120,
            pacingMs: 5000,
        },
    },
    {
        id: 'segment-1-marker',
        timestamp: '2026-03-21T10:00:00.000Z',
        level: 'info' as const,
        context: 'Session',
        message: 'Fresh session segment started.',
        sessionId: 'session-1',
        segmentId: 'segment-1',
        segmentKind: 'fresh' as const,
        meta: {
            event: 'session_segment_started',
        },
    },
];

test('LogsScreen shows human-readable event labels and segment headers', async () => {
    const user = userEvent.setup();
    render(
        <LogsScreen logs={logs} sessionId="session-1" onRefresh={() => undefined} onOpenLogFile={() => undefined} />,
    );

    expect(screen.getByText('Resumed from checkpoint')).toBeTruthy();
    expect(screen.getByText('Fresh session start')).toBeTruthy();
    expect(screen.queryByText(/eventless/i)).toBeNull();
    expect(screen.queryByText('rate_limit_wait')).toBeNull();
    expect(screen.getByText('Retry 120s')).toBeTruthy();
    expect(screen.getByText('Pacing 5000 ms')).toBeTruthy();

    await user.click(screen.getByRole('combobox', { name: 'Filter by event' }));
    expect(screen.getByRole('option', { name: 'Rate-limit cooldown' })).toBeTruthy();
    await user.click(screen.getByRole('option', { name: 'Rate-limit cooldown' }));
    expect(screen.getAllByText('Rate-limit cooldown').length).toBeGreaterThan(0);
});
