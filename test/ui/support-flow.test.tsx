import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, getDesktopMock, headerActions, resetDesktopState } from './app-flow-test-helpers';

const desktopMock = getDesktopMock();

test('App shows the public beta version and support diagnostics', async () => {
    resetDesktopState();
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText('v1.0.0 beta');
    await user.click(await screen.findByRole('button', { name: 'Support' }));

    await screen.findByText('Release Diagnostics');
    await screen.findByText('Public Beta Notes');
    await screen.findByText('C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/logs');
});

test('App exports a support bundle and opens the logs folder from Support', async () => {
    resetDesktopState();
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Support' }));
    await user.click(await screen.findByRole('button', { name: 'Open Logs Folder' }));
    await user.click(await screen.findByRole('button', { name: 'Export Support Bundle' }));

    await waitFor(() => {
        expect(desktopMock.mocks.openLogsDirectory).toHaveBeenCalledTimes(1);
        expect(desktopMock.mocks.exportSupportBundle).toHaveBeenCalledTimes(1);
    });
    await screen.findByText('Latest support bundle');
    await screen.findByText('Missing: logs/*.jsonl');
});

test('App disables runtime reset while a session is active', async () => {
    resetDesktopState();
    const user = userEvent.setup();

    render(<App />);

    await waitFor(() => {
        expect(headerActions().getByRole('button', { name: 'Resume' })).toBeTruthy();
    });
    await user.click(headerActions().getByRole('button', { name: 'Resume' }));
    await waitFor(() => {
        expect(headerActions().getByRole('button', { name: 'Stop' })).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: 'Support' }));
    const resetButton = await screen.findByRole('button', { name: 'Reset Runtime State' });
    expect((resetButton as HTMLButtonElement).disabled).toBe(true);
});

test('App can reset runtime state from Support when idle', async () => {
    resetDesktopState();
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Support' }));
    await waitFor(() => {
        expect((screen.getByRole('button', { name: 'Reset Runtime State' }) as HTMLButtonElement).disabled).toBe(false);
    });
    await user.click(screen.getByRole('button', { name: 'Reset Runtime State' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reset Runtime State' }));

    await waitFor(() => {
        expect(desktopMock.mocks.resetRuntimeState).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
        expect(screen.getAllByText('Runtime state reset. Deleted 2 log files.').length).toBeGreaterThan(0);
    });
});
