import { useEffect, useEffectEvent, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
    type DesktopEvent,
    type DryRunResult,
    type InboxMonitorState,
    type LogEntry,
    type NotificationDeliverySnapshot,
    type PreflightResult,
    type SessionSnapshot,
    type SidecarStatus,
    subscribeToAppEvents,
} from '@/lib/desktop';
import { mergeLogsById } from './helpers';
import type { PreferredScreen, RecoveryState } from './types';

interface UseDesktopEventsOptions {
    sessionRef: MutableRefObject<SessionSnapshot | null>;
    setSession: Dispatch<SetStateAction<SessionSnapshot | null>>;
    setLogs: Dispatch<SetStateAction<LogEntry[]>>;
    setPreflight: Dispatch<SetStateAction<PreflightResult | null>>;
    setDryRun: Dispatch<SetStateAction<DryRunResult | null>>;
    setInboxMonitorState: Dispatch<SetStateAction<InboxMonitorState>>;
    setNotificationDelivery: Dispatch<SetStateAction<NotificationDeliverySnapshot>>;
    setSidecarStatus: Dispatch<SetStateAction<SidecarStatus>>;
    setSidecarMessage: Dispatch<SetStateAction<string | null>>;
    setRecoveryState: Dispatch<SetStateAction<RecoveryState | null>>;
    setPreferredScreen: Dispatch<SetStateAction<PreferredScreen>>;
    setNotice: Dispatch<SetStateAction<string>>;
    setSurfaceNotice(
        scope: 'config' | 'session' | 'logs',
        tone: 'neutral' | 'success' | 'warning' | 'danger',
        message: string,
    ): void;
    refreshAll(): Promise<void>;
    refreshState(): Promise<void>;
}

export function useDesktopEvents({
    sessionRef,
    setSession,
    setLogs,
    setPreflight,
    setDryRun,
    setInboxMonitorState,
    setNotificationDelivery,
    setSidecarStatus,
    setSidecarMessage,
    setRecoveryState,
    setPreferredScreen,
    setNotice,
    setSurfaceNotice,
    refreshAll,
    refreshState,
}: UseDesktopEventsOptions) {
    const handleDesktopEvent = useEffectEvent((event: DesktopEvent) => {
        switch (event.type) {
            case 'session_started':
            case 'session_paused':
            case 'session_resumed':
            case 'session_stopping':
            case 'channel_state_changed':
            case 'session_state_updated':
            case 'summary_ready':
                setSession(event.state);
                if (event.type === 'session_started' || event.type === 'summary_ready') {
                    setRecoveryState(null);
                }
                void refreshState();
                return;
            case 'log_event_emitted':
                setLogs((previous) => mergeLogsById([event.entry, ...previous]));
                return;
            case 'preflight_result_emitted':
                setPreflight(event.result);
                setPreferredScreen('session');
                return;
            case 'dry_run_ready':
                setDryRun(event.result);
                setPreferredScreen('preview');
                return;
            case 'inbox_monitor_state_changed':
                setInboxMonitorState(event.monitor);
                return;
            case 'inbox_notification_ready':
                setInboxMonitorState(event.monitor);
                setNotice(
                    `New ${event.notification.kind === 'message_request' ? 'message request' : 'direct message'} from ${event.notification.authorName}.`,
                );
                return;
            case 'notification_delivery_state_changed':
                setNotificationDelivery(event.delivery);
                return;
            case 'telegram_chat_detected':
                setNotificationDelivery((previous) => ({
                    ...previous,
                    settings: {
                        ...previous.settings,
                        telegram: {
                            ...previous.settings.telegram,
                            chatId: event.chatId,
                        },
                    },
                    telegramState: {
                        ...previous.telegramState,
                        lastResolvedChatTitle: event.title,
                    },
                }));
                setNotice(`Detected Telegram chat ${event.title ? `${event.title} ` : ''}(${event.chatId}).`);
                return;
            case 'telegram_test_result':
                setNotificationDelivery((previous) => ({
                    ...previous,
                    telegramState: event.state,
                }));
                setNotice(event.message);
                return;
            case 'close_blocked':
                setSession(event.state);
                setNotice(event.message);
                setPreferredScreen('session');
                return;
            case 'sidecar_error':
                setSidecarStatus(event.status);
                setSidecarMessage(event.message);
                if (sessionRef.current && ['running', 'paused', 'stopping'].includes(sessionRef.current.status)) {
                    setRecoveryState({
                        interruptedAt: new Date().toISOString(),
                        message: event.message,
                    });
                    setSession(null);
                    setPreferredScreen('session');
                    setNotice(
                        'The desktop runtime was interrupted while a session was active. Review the saved checkpoint before resuming.',
                    );
                    setSurfaceNotice(
                        'session',
                        'warning',
                        'Runtime interrupted while a session was active. Review the saved checkpoint before resuming.',
                    );
                    void refreshState();
                } else {
                    setNotice(event.message);
                }
                return;
            case 'sidecar_ready':
                setSidecarStatus('ready');
                setSidecarMessage(null);
                void refreshAll();
                setNotice('Desktop runtime connected.');
                return;
            default:
                return;
        }
    });

    const refreshAllOnMount = useEffectEvent(() => {
        void refreshAll();
    });

    useEffect(() => {
        refreshAllOnMount();

        let active = true;
        let cleanup = () => {};
        void (async () => {
            const unsubscribe = await subscribeToAppEvents((event) => {
                handleDesktopEvent(event);
            });
            if (!active) {
                unsubscribe();
                return;
            }
            cleanup = unsubscribe;
        })();

        return () => {
            active = false;
            cleanup();
        };
    }, []);
}
