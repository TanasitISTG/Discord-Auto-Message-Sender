import React from 'react';
import { render, screen } from '@testing-library/react';
import {
    App,
    getDesktopMock,
    resetDesktopState,
} from './app-flow-test-helpers';

const desktopMock = getDesktopMock();

test('App mounts a single toaster host', async () => {
    resetDesktopState();
    render(<App />);

    await screen.findByText('v1.0.0 beta');
    expect(screen.getAllByTestId('toaster-host')).toHaveLength(1);
});
