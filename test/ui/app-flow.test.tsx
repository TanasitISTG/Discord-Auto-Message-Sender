import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from '../../app/src/App';

const desktopMock = vi.hoisted(() => {
    const baseConfig = {
        userAgent: 'UA',
        channels: [
            {
                name: 'General',
                id: '123456789012345678',
                referrer: 'https://discord.com/channels/@me/123456789012345678',
                messageGroup: 'default',
                schedule: {
                    intervalSeconds: 5,
                    randomMarginSeconds: 2,
                    timezone: 'UTC',
                    maxSendsPerDay: null,
                    cooldownWindowSize: 3
                }
            }
        ],
        messageGroups: {
            default: ['Hello']
        }
    };

    const resumeSession = {
        sessionId: 'session-resume',
        updatedAt: '2026-03-21T10:00:00.000Z',
        runtime: {
            numMessages: 1,
            baseWaitSeconds: 5,
            marginSeconds: 2
        },
        configSignature: '{}',
        state: {
            id: 'session-resume',
            status: 'running',
            updatedAt: '2026-03-21T10:00:00.000Z',
            activeChannels: ['123'],
            completedChannels: [],
            failedChannels: [],
            sentMessages: 1
        },
        recentMessageHistory: {
            '123': ['Hello']
        }
    };

    const state = {
        session: null as any,
        senderState: {
            schemaVersion: 1,
            summaries: [],
            recentFailures: [],
            recentMessageHistory: {},
            channelHealth: {},
            resumeSession
        } as any,
        setup: {
            tokenPresent: true,
            tokenStorage: 'secure',
            dataDir: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender',
            secureStorePath: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/discord-token.secure',
            envPath: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/.env',
            configPath: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/config.json',
            statePath: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/.sender-state.json',
            logsDir: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/logs'
        } as any,
        diagnostics: {
            appVersion: '0.1.0',
            dataDir: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender',
            logsDir: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/logs',
            configPath: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/config.json',
            statePath: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/.sender-state.json',
            secureStorePath: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/discord-token.secure',
            tokenStorage: 'secure',
            sidecarStatus: 'ready'
        } as any,
        eventHandler: null as ((event: any) => void) | null
    };

    const mocks = {
        loadConfig: vi.fn(async () => ({ kind: 'ok', config: structuredClone(baseConfig) })),
        getSessionState: vi.fn(async () => state.session),
        loadState: vi.fn(async () => structuredClone(state.senderState)),
        loadSetupState: vi.fn(async () => structuredClone(state.setup)),
        loadReleaseDiagnostics: vi.fn(async () => structuredClone(state.diagnostics)),
        saveConfig: vi.fn(async (config) => ({ ok: true, config })),
        saveEnvironment: vi.fn(async () => ({
            ...state.setup
        })),
        clearSecureToken: vi.fn(async () => {
            state.setup = {
                ...state.setup,
                tokenPresent: false,
                tokenStorage: 'missing'
            };
            state.diagnostics = {
                ...state.diagnostics,
                tokenStorage: 'missing'
            };
            return structuredClone(state.setup);
        }),
        runPreflight: vi.fn(async () => ({
            ok: true,
            checkedAt: '2026-03-21T10:00:00.000Z',
            configValid: true,
            tokenPresent: true,
            issues: [],
            channels: []
        })),
        runDryRun: vi.fn(async () => ({
            generatedAt: '2026-03-21T10:00:00.000Z',
            willSendMessages: true,
            channels: [],
            summary: {
                selectedChannels: 0,
                skippedChannels: 0,
                totalSampleMessages: 0
            }
        })),
        startSession: vi.fn(async () => {
            state.session = {
                id: 'session-active',
                status: 'running',
                updatedAt: '2026-03-21T10:01:00.000Z',
                activeChannels: ['123'],
                completedChannels: [],
                failedChannels: [],
                sentMessages: 2,
                resumedFromCheckpoint: Boolean(state.senderState.resumeSession)
            };
            return structuredClone(state.session);
        }),
        pauseSession: vi.fn(async () => {
            state.session = {
                ...state.session,
                status: 'paused'
            };
            return structuredClone(state.session);
        }),
        resumeSession: vi.fn(async () => {
            state.session = {
                ...state.session,
                status: 'running'
            };
            return structuredClone(state.session);
        }),
        stopSession: vi.fn(async () => {
            state.session = {
                ...state.session,
                status: 'stopping'
            };
            return structuredClone(state.session);
        }),
        loadLogs: vi.fn(async () => ({
            ok: true,
            path: 'logs/session.jsonl',
            entries: []
        })),
        openLogFile: vi.fn(async () => 'logs/session.jsonl'),
        openDataDirectory: vi.fn(async () => 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender'),
        discardResumeSession: vi.fn(async () => {
            state.senderState = {
                ...state.senderState,
                resumeSession: undefined
            };
            return structuredClone(state.senderState);
        }),
        subscribeToAppEvents: vi.fn(async (handler: (event: any) => void) => {
            state.eventHandler = handler;
            return () => {
                state.eventHandler = null;
            };
        })
    };

    return { baseConfig, resumeSession, state, mocks };
});

vi.mock('../../app/src/lib/desktop', () => desktopMock.mocks);
vi.mock('@/lib/desktop', () => desktopMock.mocks);

function resetDesktopState() {
    desktopMock.state.session = null;
    desktopMock.state.senderState = {
        schemaVersion: 1,
        summaries: [],
        recentFailures: [],
        recentMessageHistory: {},
        channelHealth: {},
        resumeSession: structuredClone(desktopMock.resumeSession)
    };
    desktopMock.state.setup = {
        tokenPresent: true,
        tokenStorage: 'secure',
        dataDir: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender',
        secureStorePath: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/discord-token.secure',
        envPath: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/.env',
        configPath: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/config.json',
        statePath: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/.sender-state.json',
        logsDir: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/logs'
    };
    desktopMock.state.diagnostics = {
        appVersion: '0.1.0',
        dataDir: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender',
        logsDir: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/logs',
        configPath: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/config.json',
        statePath: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/.sender-state.json',
        secureStorePath: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/discord-token.secure',
        tokenStorage: 'secure',
        sidecarStatus: 'ready'
    };

    for (const mock of Object.values(desktopMock.mocks)) {
        mock.mockClear();
    }
}

test('App flips the header CTA to stop and disables the session start button after starting', async () => {
    resetDesktopState();
    const user = userEvent.setup();

    render(<App />);

    await waitFor(() => {
        expect(screen.getAllByRole('button', { name: 'Resume Session' }).length).toBeGreaterThan(0);
    });
    const headerResumeButton = screen.getAllByRole('button', { name: 'Resume Session' })
        .find((button) => button.className.includes('h-10'));
    expect(headerResumeButton).toBeTruthy();
    await user.click(headerResumeButton!);

    await waitFor(() => {
        expect(desktopMock.mocks.startSession).toHaveBeenCalledTimes(1);
    });
    await screen.findByRole('button', { name: 'Stop Session' });

    await user.click(screen.getByRole('button', { name: 'Session' }));

    const startButton = await screen.findByRole('button', { name: 'Start' });
    expect((startButton as HTMLButtonElement).disabled).toBe(true);
});

test('App can discard a saved checkpoint from the rendered session flow', async () => {
    resetDesktopState();
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Session' }));

    await screen.findByText('Interrupted session available');
    await user.click(screen.getByRole('button', { name: 'Discard Checkpoint' }));

    await waitFor(() => {
        expect(desktopMock.mocks.discardResumeSession).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
        expect(screen.queryByText('Interrupted session available')).toBeNull();
    });
    await screen.findByRole('button', { name: 'Start Session' });
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
                sentMessages: 2
            }
        });
    });

    await screen.findByRole('button', { name: 'Resume' });
    expect(screen.getAllByText('paused').length).toBeGreaterThan(0);
});

test('App can remove the secure token and block new session starts', async () => {
    resetDesktopState();
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Config' }));
    await user.click(await screen.findByRole('button', { name: 'Remove Token' }));

    await waitFor(() => {
        expect(desktopMock.mocks.clearSecureToken).toHaveBeenCalledTimes(1);
    });
    await screen.findByText('Save a Discord token securely before starting a session.');

    const startButton = screen.getByRole('button', { name: 'Resume Session' });
    expect((startButton as HTMLButtonElement).disabled).toBe(true);

    confirmSpy.mockRestore();
});

test('App keeps an active session running after the secure token is removed', async () => {
    resetDesktopState();
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<App />);

    await waitFor(() => {
        expect(screen.getAllByRole('button', { name: 'Resume Session' }).length).toBeGreaterThan(0);
    });
    const headerResumeButton = screen.getAllByRole('button', { name: 'Resume Session' })
        .find((button) => button.className.includes('h-10'));
    expect(headerResumeButton).toBeTruthy();
    await user.click(headerResumeButton!);
    await screen.findByRole('button', { name: 'Stop Session' });

    await user.click(screen.getByRole('button', { name: 'Config' }));
    await user.click(await screen.findByRole('button', { name: 'Remove Token' }));

    await waitFor(() => {
        expect(desktopMock.mocks.clearSecureToken).toHaveBeenCalledTimes(1);
    });

    await screen.findByText('Save a Discord token securely before starting a session.');
    expect(screen.getByRole('button', { name: 'Stop Session' })).toBeTruthy();

    confirmSpy.mockRestore();
});

test('App keeps preflight available when token readiness is blocked', async () => {
    resetDesktopState();
    desktopMock.state.setup = {
        ...desktopMock.state.setup,
        tokenPresent: false,
        tokenStorage: 'missing'
    };
    desktopMock.state.diagnostics = {
        ...desktopMock.state.diagnostics,
        tokenStorage: 'missing'
    };

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Preflight' }));

    await waitFor(() => {
        expect(desktopMock.mocks.runPreflight).toHaveBeenCalledTimes(1);
    });
});

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
    await screen.findByText('runtime restarting');

    await act(async () => {
        desktopMock.state.eventHandler?.({
            type: 'sidecar_ready'
        });
    });

    await waitFor(() => {
        expect(screen.queryAllByText('Desktop runtime restarted after an unexpected sidecar exit.')).toHaveLength(0);
    });
    await screen.findByText('runtime ready');
});
