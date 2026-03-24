import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
            appVersion: '1.0.0',
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
        loadInboxMonitorSettings: vi.fn(async () => ({
            enabled: false,
            pollIntervalSeconds: 30,
            notifyDirectMessages: true,
            notifyMessageRequests: true
        })),
        getInboxMonitorState: vi.fn(async () => ({
            status: 'stopped',
            enabled: false,
            pollIntervalSeconds: 30
        })),
        loadReleaseDiagnostics: vi.fn(async () => structuredClone(state.diagnostics)),
        saveConfig: vi.fn(async (config) => ({ ok: true, config })),
        saveEnvironment: vi.fn(async () => ({
            ...state.setup
        })),
        saveInboxMonitorSettings: vi.fn(async ({ settings }) => ({
            settings,
            state: {
                status: settings.enabled ? 'running' : 'stopped',
                enabled: settings.enabled,
                pollIntervalSeconds: settings.pollIntervalSeconds
            },
            lastSeen: {
                channelMessageIds: {}
            }
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
        startInboxMonitor: vi.fn(async () => ({
            status: 'running',
            enabled: true,
            pollIntervalSeconds: 30
        })),
        resumeSession: vi.fn(async () => {
            state.session = {
                ...state.session,
                status: 'running'
            };
            return structuredClone(state.session);
        }),
        stopInboxMonitor: vi.fn(async () => ({
            status: 'stopped',
            enabled: false,
            pollIntervalSeconds: 30
        })),
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
        openLogsDirectory: vi.fn(async () => 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/logs'),
        exportSupportBundle: vi.fn(async () => ({
            path: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/support/discord-auto-message-sender-support-123.zip',
            includedFiles: ['diagnostics.json', 'setup.json', 'config.json'],
            missingFiles: ['logs/*.jsonl']
        })),
        resetRuntimeState: vi.fn(async () => {
            state.session = null;
            state.senderState = {
                schemaVersion: 1,
                summaries: [],
                recentFailures: [],
                recentMessageHistory: {},
                channelHealth: {}
            };
            return {
                ok: true,
                clearedStateFile: true,
                deletedLogFiles: 2
            };
        }),
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
const toastMock = vi.hoisted(() => ({
    showSuccessToast: vi.fn(),
    showWarningToast: vi.fn(),
    showErrorToast: vi.fn(),
    showInfoToast: vi.fn()
}));
vi.mock('../../app/src/shared/toast', () => toastMock);
vi.mock('@/shared/toast', () => toastMock);
vi.mock('sonner', () => ({
    Toaster: () => <div data-testid="toaster-host" />,
    toast: Object.assign(vi.fn(), {
        success: vi.fn(),
        warning: vi.fn(),
        error: vi.fn()
    })
}));

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
        appVersion: '1.0.0',
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
        expect(screen.getAllByRole('button', { name: 'Resume' }).length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByRole('button', { name: 'Resume' })[0]!);

    await waitFor(() => {
        expect(desktopMock.mocks.startSession).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
        expect(screen.getAllByRole('button', { name: 'Stop' }).length).toBeGreaterThan(0);
    });

    await user.click(screen.getByRole('button', { name: 'Session' }));

    await waitFor(() => {
        expect(screen.getAllByRole('button', { name: 'Start' }).length).toBeGreaterThan(0);
    });
    const startButton = screen.getAllByRole('button', { name: 'Start' })[0];
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
        expect(screen.getAllByRole('button', { name: 'Resume' }).length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByRole('button', { name: 'Resume' })[0]!);
    await waitFor(() => {
        expect(screen.getAllByRole('button', { name: 'Stop' }).length).toBeGreaterThan(0);
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
        expect(screen.getAllByRole('button', { name: 'Resume' }).length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByRole('button', { name: 'Resume' })[0]!);
    await waitFor(() => {
        expect(screen.getAllByRole('button', { name: 'Stop' }).length).toBeGreaterThan(0);
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
        expect(screen.getAllByRole('button', { name: 'Resume' }).length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByRole('button', { name: 'Resume' })[0]!);
    await waitFor(() => {
        expect(screen.getAllByRole('button', { name: 'Stop' }).length).toBeGreaterThan(0);
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

test('App mounts a single toaster host', async () => {
    resetDesktopState();
    render(<App />);

    await screen.findByText('v1.0.0 beta');
    expect(screen.getAllByTestId('toaster-host')).toHaveLength(1);
});
