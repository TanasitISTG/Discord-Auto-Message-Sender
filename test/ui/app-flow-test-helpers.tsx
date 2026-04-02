import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
export { act, render, screen, waitFor, within, userEvent };

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
        saveNotificationDeliverySettings: vi.fn(async ({ settings }) => ({
            settings,
            telegramState: {
                status: settings.telegram.enabled && settings.telegram.botTokenStored && settings.telegram.chatId ? 'ready' : 'unconfigured'
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

const { default: App } = await import('../../app/src/App');

export { App };

export function resetDesktopState() {
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

export function headerActions() {
    return within(screen.getByRole('banner'));
}

export function sessionWorkspace() {
    return within(screen.getByRole('region', { name: 'Session workspace' }));
}

export function getDesktopMock() {
    return desktopMock;
}

