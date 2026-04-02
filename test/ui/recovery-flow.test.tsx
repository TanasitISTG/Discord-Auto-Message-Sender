import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
    App,
    getDesktopMock,
    headerActions,
    resetDesktopState,
    sessionWorkspace,
} from './app-flow-test-helpers';

const desktopMock = getDesktopMock();

test('App shows a sidecar restart banner and clears it when the runtime recovers', async () => {
    resetDesktopState();

    render(<App />);
    await waitFor(() => {
        expect(desktopMock.state.eventHandler).toBeTruthy();
    });

    await act(async () => {
        desktopMock.state.eventHandler?.({
            type: 'sidecar_error',
            status: 'restarting',
            message: 'Desktop runtime restarted after an unexpected sidecar exit.'
        });
    });

    await screen.findAllByText('Desktop runtime restarted after an unexpected sidecar exit.');
    await screen.findByText('restarting');

    await act(async () => {
        desktopMock.state.eventHandler?.({
            type: 'sidecar_ready'
        });
    });

    await waitFor(() => {
        expect(screen.queryAllByText('Desktop runtime restarted after an unexpected sidecar exit.')).toHaveLength(0);
    });
    await screen.findByText('ready');
});

test('App keeps a recovery card visible after runtime interruption during an active session', async () => {
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

    await act(async () => {
        desktopMock.state.eventHandler?.({
            type: 'sidecar_error',
            status: 'restarting',
            message: 'Desktop runtime restarted after an unexpected sidecar exit.'
        });
    });

    await screen.findAllByText('Runtime interrupted');
    await screen.findAllByText('Desktop runtime restarted after an unexpected sidecar exit.');
    expect(screen.getAllByRole('button', { name: 'Resume' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Discard Checkpoint' })).toBeTruthy();
});

