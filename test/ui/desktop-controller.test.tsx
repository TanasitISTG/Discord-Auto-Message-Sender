import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { DesktopConfirmDialog } from '../../app/src/shared/desktop-confirm-dialog';
import { useDesktopController } from '../../app/src/shared/use-desktop-controller';

const desktopMock = vi.hoisted(() => {
    const state = {
        session: null as any,
        senderState: {
            schemaVersion: 1,
            lastSession: {
                id: 'session-1',
                status: 'completed',
                updatedAt: '2026-03-21T10:00:00.000Z',
                activeChannels: [],
                completedChannels: ['123'],
                failedChannels: [],
                sentMessages: 1,
                summary: {
                    totalChannels: 1,
                    completedChannels: 1,
                    failedChannels: 0,
                    sentMessages: 1,
                    startedAt: '2026-03-21T10:00:00.000Z',
                    finishedAt: '2026-03-21T10:05:00.000Z'
                }
            },
            summaries: [
                {
                    totalChannels: 1,
                    completedChannels: 1,
                    failedChannels: 0,
                    sentMessages: 1,
                    startedAt: '2026-03-21T10:00:00.000Z',
                    finishedAt: '2026-03-21T10:05:00.000Z'
                }
            ],
            recentFailures: [],
            recentMessageHistory: {},
            channelHealth: {}
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
        loadConfig: vi.fn(async () => ({
            kind: 'ok',
            config: {
                userAgent: 'UA',
                channels: [],
                messageGroups: {
                    default: ['Hello']
                }
            }
        })),
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
        loadNotificationDeliverySettings: vi.fn(async () => ({
            windowsDesktopEnabled: true,
            telegram: {
                enabled: false,
                botTokenStored: false,
                chatId: '',
                previewMode: 'full'
            }
        })),
        getNotificationDeliveryState: vi.fn(async () => ({
            settings: {
                windowsDesktopEnabled: true,
                telegram: {
                    enabled: false,
                    botTokenStored: false,
                    chatId: '',
                    previewMode: 'full'
                }
            },
            telegramState: {
                status: 'disabled'
            }
        })),
        loadReleaseDiagnostics: vi.fn(async () => structuredClone(state.diagnostics)),
        saveConfig: vi.fn(),
        saveEnvironment: vi.fn(),
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
        saveNotificationDeliverySettings: vi.fn(async ({ settings }) => ({
            settings,
            telegramState: {
                status: settings.telegram.enabled && settings.telegram.chatId ? 'unconfigured' : 'disabled'
            }
        })),
        saveTelegramBotToken: vi.fn(async () => ({
            settings: {
                windowsDesktopEnabled: true,
                telegram: {
                    enabled: false,
                    botTokenStored: true,
                    chatId: '',
                    previewMode: 'full'
                }
            },
            telegramState: {
                status: 'disabled'
            }
        })),
        clearTelegramBotToken: vi.fn(async () => ({
            settings: {
                windowsDesktopEnabled: true,
                telegram: {
                    enabled: false,
                    botTokenStored: false,
                    chatId: '',
                    previewMode: 'full'
                }
            },
            telegramState: {
                status: 'disabled'
            }
        })),
        detectTelegramChat: vi.fn(async () => ({
            chatId: '123456789',
            title: 'tana'
        })),
        sendTestTelegramNotification: vi.fn(async () => ({
            ok: true,
            message: 'Telegram test notification sent.',
            state: {
                status: 'ready',
                lastTestedAt: '2026-03-21T10:00:00.000Z'
            }
        })),
        clearSecureToken: vi.fn(),
        runPreflight: vi.fn(),
        runDryRun: vi.fn(),
        startSession: vi.fn(),
        pauseSession: vi.fn(),
        resumeSession: vi.fn(),
        startInboxMonitor: vi.fn(async () => ({
            status: 'running',
            enabled: true,
            pollIntervalSeconds: 30
        })),
        stopSession: vi.fn(),
        stopInboxMonitor: vi.fn(async () => ({
            status: 'stopped',
            enabled: false,
            pollIntervalSeconds: 30
        })),
        loadLogs: vi.fn(async () => ({
            ok: true,
            path: 'logs/session-1.jsonl',
            entries: [
                {
                    id: 'entry-1',
                    timestamp: '2026-03-21T10:05:00.000Z',
                    level: 'info',
                    context: 'desktop',
                    message: 'session complete'
                }
            ]
        })),
        openLogsDirectory: vi.fn(async () => state.setup.logsDir),
        exportSupportBundle: vi.fn(async () => ({
            path: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/support/discord-auto-message-sender-support-123.zip',
            includedFiles: ['diagnostics.json', 'setup.json', 'config.json'],
            missingFiles: []
        })),
        resetRuntimeState: vi.fn(async () => {
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
                deletedLogFiles: 1
            };
        }),
        openLogFile: vi.fn(),
        openDataDirectory: vi.fn(),
        discardResumeSession: vi.fn(),
        subscribeToAppEvents: vi.fn(async (handler: (event: any) => void) => {
            state.eventHandler = handler;
            return () => {
                state.eventHandler = null;
            };
        })
    };

    return { state, mocks };
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

function resetDesktopState() {
    desktopMock.state.session = null;
    desktopMock.state.eventHandler = null;
    desktopMock.state.senderState = {
        schemaVersion: 1,
        lastSession: {
            id: 'session-1',
            status: 'completed',
            updatedAt: '2026-03-21T10:00:00.000Z',
            activeChannels: [],
            completedChannels: ['123'],
            failedChannels: [],
            sentMessages: 1,
            summary: {
                totalChannels: 1,
                completedChannels: 1,
                failedChannels: 0,
                sentMessages: 1,
                startedAt: '2026-03-21T10:00:00.000Z',
                finishedAt: '2026-03-21T10:05:00.000Z'
            }
        },
        summaries: [
            {
                totalChannels: 1,
                completedChannels: 1,
                failedChannels: 0,
                sentMessages: 1,
                startedAt: '2026-03-21T10:00:00.000Z',
                finishedAt: '2026-03-21T10:05:00.000Z'
            }
        ],
        recentFailures: [],
        recentMessageHistory: {},
        channelHealth: {}
    };

    for (const mock of Object.values(desktopMock.mocks)) {
        mock.mockClear();
    }
}

function Harness() {
    const controller = useDesktopController();

    return (
        <div>
            <div>{controller.releaseDiagnostics?.appVersion ?? 'loading'}</div>
            <div>{controller.releaseDiagnostics?.logsDir ?? 'loading-path'}</div>
            <div>summaries:{controller.senderState.summaries.length}</div>
            <div>logs:{controller.logs.length}</div>
            <div>{controller.supportBundle?.path ?? 'no-bundle'}</div>
            <button onClick={() => void controller.loadCurrentLogs()}>load logs</button>
            <button onClick={() => void controller.exportSupportBundle()}>export bundle</button>
            <button onClick={() => void controller.resetRuntimeState()}>reset runtime</button>
            <DesktopConfirmDialog
                dialog={controller.confirmDialog}
                pending={controller.confirmDialogPending}
                onClose={controller.closeConfirmation}
                onConfirm={controller.confirmCurrentDialog}
            />
        </div>
    );
}

test('desktop controller exposes release diagnostics version and paths', async () => {
    resetDesktopState();

    render(<Harness />);

    await screen.findByText('1.0.0');
    await screen.findByText('C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/logs');
});

test('desktop controller reports the exported support bundle path back to the UI', async () => {
    resetDesktopState();
    const user = userEvent.setup();

    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'export bundle' }));

    await waitFor(() => {
        expect(desktopMock.mocks.exportSupportBundle).toHaveBeenCalledTimes(1);
    });
    await screen.findByText('C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/support/discord-auto-message-sender-support-123.zip');
});

test('desktop controller refreshes sender state and clears logs after a runtime reset', async () => {
    resetDesktopState();
    const user = userEvent.setup();

    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'load logs' }));
    await screen.findByText('logs:1');

    await user.click(screen.getByRole('button', { name: 'reset runtime' }));
    await user.click(await screen.findByRole('button', { name: 'Reset Runtime State' }));

    await waitFor(() => {
        expect(desktopMock.mocks.resetRuntimeState).toHaveBeenCalledTimes(1);
    });
    await screen.findByText('summaries:0');
    await screen.findByText('logs:0');
});

test('desktop controller deduplicates repeated live log events by entry id', async () => {
    resetDesktopState();

    render(<Harness />);

    await waitFor(() => {
        expect(desktopMock.state.eventHandler).toBeTruthy();
    });

    const duplicateEntry = {
        id: 'dup-1',
        timestamp: '2026-03-21T10:10:00.000Z',
        level: 'info',
        context: 'BLACK MARKET',
        message: 'Message sent',
        meta: {
            event: 'message_sent'
        }
    };

    await act(async () => {
        desktopMock.state.eventHandler?.({ type: 'log_event_emitted', entry: duplicateEntry });
        desktopMock.state.eventHandler?.({ type: 'log_event_emitted', entry: duplicateEntry });
    });

    await screen.findByText('logs:1');
});

test('desktop controller opens a confirmation dialog instead of calling window.confirm', async () => {
    resetDesktopState();
    const user = userEvent.setup();

    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'reset runtime' }));

    await screen.findByRole('alertdialog');
    expect(desktopMock.mocks.resetRuntimeState).not.toHaveBeenCalled();
});
