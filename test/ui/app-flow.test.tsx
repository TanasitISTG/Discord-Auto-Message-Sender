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
        eventHandler: null as ((event: any) => void) | null
    };

    const mocks = {
        loadConfig: vi.fn(async () => ({ kind: 'ok', config: structuredClone(baseConfig) })),
        getSessionState: vi.fn(async () => state.session),
        loadState: vi.fn(async () => structuredClone(state.senderState)),
        saveConfig: vi.fn(async (config) => ({ ok: true, config })),
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
