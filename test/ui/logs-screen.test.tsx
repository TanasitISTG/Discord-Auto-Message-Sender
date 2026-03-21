import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LogsScreen } from '../../app/src/features/logs/logs-screen';

const logs = [
    {
        id: '1',
        timestamp: '2026-03-21T10:00:00.000Z',
        level: 'warning' as const,
        context: 'BLACK MARKET',
        message: 'Rate Limit! Waiting 120s...',
        meta: {
            event: 'rate_limit_wait'
        }
    },
    {
        id: '2',
        timestamp: '2026-03-21T10:01:00.000Z',
        level: 'warning' as const,
        context: 'DUCK PRO',
        message: 'Stop requested from desktop UI.'
    }
];

test('LogsScreen shows human-readable event labels and no eventless placeholder text', async () => {
    const user = userEvent.setup();
    const { container } = render(
        <LogsScreen
            logs={logs}
            onRefresh={() => undefined}
            onOpenLogFile={() => undefined}
        />
    );

    expect(screen.getByRole('option', { name: 'Rate-limit cooldown' })).toBeTruthy();
    expect(screen.queryByText(/eventless/i)).toBeNull();
    expect(screen.queryByText('rate_limit_wait')).toBeNull();

    const metadataRow = container.querySelector('.mb-2.grid');
    expect(metadataRow?.className.includes('sm:grid-cols-[minmax(0,1.2fr)_110px_180px_96px]')).toBe(true);

    await user.selectOptions(screen.getAllByRole('combobox')[2], 'rate_limit_wait');
    expect(screen.getAllByText('Rate-limit cooldown').length).toBeGreaterThan(1);
});
