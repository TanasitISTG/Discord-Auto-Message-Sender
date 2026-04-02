import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, getDesktopMock, headerActions, resetDesktopState, sessionWorkspace } from './app-flow-test-helpers';

const desktopMock = getDesktopMock();

test('App flips the header CTA to stop and disables the session start button after starting', async () => {
    resetDesktopState();
    const user = userEvent.setup();

    render(<App />);

    await waitFor(() => {
        expect(headerActions().getByRole('button', { name: 'Resume' })).toBeTruthy();
    });
    await user.click(headerActions().getByRole('button', { name: 'Resume' }));

    await waitFor(() => {
        expect(desktopMock.mocks.startSession).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
        expect(headerActions().getByRole('button', { name: 'Stop' })).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: 'Session' }));

    const startButton = await waitFor(() => sessionWorkspace().getByRole('button', { name: 'Start' }));
    expect((startButton as HTMLButtonElement).disabled).toBe(true);
});

test('App can discard a saved checkpoint from the rendered session flow', async () => {
    resetDesktopState();
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Session' }));

    await screen.findByText('Interrupted session available');
    await user.click(screen.getByRole('button', { name: 'Discard Checkpoint' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Discard Checkpoint' }));

    await waitFor(() => {
        expect(desktopMock.mocks.discardResumeSession).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
        expect(screen.queryByText('Interrupted session available')).toBeNull();
    });
    await waitFor(() => {
        expect(screen.getAllByRole('button', { name: 'Start' }).length).toBeGreaterThan(0);
    });
});

test('App reacts to streamed session events in the rendered flow', async () => {
    resetDesktopState();
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Session' }));
    await screen.findByText('Interrupted session available');

    await act(async () => {
        desktopMock.state.eventHandler?.({
            type: 'session_paused',
            state: {
                id: 'session-active',
                status: 'paused',
                updatedAt: '2026-03-21T10:02:00.000Z',
                activeChannels: ['123456789012345678'],
                completedChannels: [],
                failedChannels: [],
                sentMessages: 2,
            },
        });
    });

    await screen.findByRole('button', { name: 'Resume' });
    expect(screen.getAllByText('paused').length).toBeGreaterThan(0);
});

test('App can remove the secure token and block new session starts', async () => {
    resetDesktopState();
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Config' }));
    await user.click(await screen.findByRole('button', { name: 'Remove Token' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove Token' }));

    await waitFor(() => {
        expect(desktopMock.mocks.clearSecureToken).toHaveBeenCalledTimes(1);
    });
    await screen.findByText('Save a Discord token securely before starting a session.');

    const startButton = screen.getByRole('button', { name: 'Resume' });
    expect((startButton as HTMLButtonElement).disabled).toBe(true);
});

test('App keeps an active session running after the secure token is removed', async () => {
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

    await user.click(screen.getByRole('button', { name: 'Config' }));
    await user.click(await screen.findByRole('button', { name: 'Remove Token' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove Token' }));

    await waitFor(() => {
        expect(desktopMock.mocks.clearSecureToken).toHaveBeenCalledTimes(1);
    });

    await screen.findByText('Save a Discord token securely before starting a session.');
    expect(screen.getAllByRole('button', { name: 'Stop' }).length).toBeGreaterThan(0);
});

test('App keeps preflight available when token readiness is blocked', async () => {
    resetDesktopState();
    desktopMock.state.setup = {
        ...desktopMock.state.setup,
        tokenPresent: false,
        tokenStorage: 'missing',
    };
    desktopMock.state.diagnostics = {
        ...desktopMock.state.diagnostics,
        tokenStorage: 'missing',
    };

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Preflight' }));

    await waitFor(() => {
        expect(desktopMock.mocks.runPreflight).toHaveBeenCalledTimes(1);
    });
});

test('App shows the setup checklist until preflight succeeds, then collapses it to setup complete', async () => {
    resetDesktopState();
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText('Setup Checklist');
    await screen.findByText('Run preflight successfully');

    await user.click(await screen.findByRole('button', { name: 'Preflight' }));
    await waitFor(() => {
        expect(desktopMock.mocks.runPreflight).toHaveBeenCalledTimes(1);
    });

    await user.click(await screen.findByRole('button', { name: 'Dashboard' }));
    await screen.findByText('Setup Complete');
});
