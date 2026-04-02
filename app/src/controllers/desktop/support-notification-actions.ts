import {
    clearTelegramBotToken as clearTelegramBotTokenCommand,
    detectTelegramChat as detectTelegramChatCommand,
    getInboxMonitorState,
    saveInboxMonitorSettings,
    saveNotificationDeliverySettings,
    saveTelegramBotToken,
    sendTestTelegramNotification as sendTestTelegramNotificationCommand,
    type InboxMonitorSettings,
    type NotificationDeliverySettings
} from '@/lib/desktop';
import { showErrorToast, showInfoToast, showSuccessToast, showWarningToast } from '@/shared/toast';
import type { SupportActionOptions } from './support-action-types';

export function createSupportNotificationActions({
    setInboxMonitorSettings,
    setInboxMonitorState,
    setNotificationDelivery,
    setNotice,
    requestConfirmation
}: SupportActionOptions) {
    return {
        async saveInboxMonitorSettingsDraft(nextSettings: InboxMonitorSettings) {
            try {
                const snapshot = await saveInboxMonitorSettings(nextSettings);
                setInboxMonitorSettings(snapshot.settings);
                const nextState = await getInboxMonitorState().catch(() => snapshot.state);
                setInboxMonitorState(nextState);
                setNotice(snapshot.settings.enabled ? 'Inbox notifications enabled.' : 'Inbox notifications disabled.');
                if (snapshot.settings.enabled) {
                    showSuccessToast('Inbox notifications enabled.');
                } else {
                    showInfoToast('Inbox notifications disabled.');
                }
                return snapshot;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                showErrorToast('Inbox notification settings could not be saved.');
                return null;
            }
        },
        async saveNotificationDeliverySettingsDraft(nextSettings: NotificationDeliverySettings) {
            try {
                const snapshot = await saveNotificationDeliverySettings(nextSettings);
                setNotificationDelivery(snapshot);
                setNotice('Notification delivery settings saved.');
                showSuccessToast('Notification delivery settings saved.');
                return snapshot;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                showErrorToast('Notification delivery settings could not be saved.');
                return null;
            }
        },
        async saveTelegramBotTokenDraft(botToken: string) {
            if (!botToken.trim()) {
                setNotice('Telegram bot token is required.');
                showWarningToast('Paste a Telegram bot token before saving.');
                return null;
            }

            try {
                const snapshot = await saveTelegramBotToken(botToken.trim());
                setNotificationDelivery(snapshot);
                setNotice('Telegram bot token saved securely for this Windows user.');
                showSuccessToast('Telegram bot token saved.');
                return snapshot;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                showErrorToast('Telegram bot token could not be saved.');
                return null;
            }
        },
        async clearTelegramBotToken() {
            requestConfirmation({
                title: 'Remove stored Telegram bot token?',
                description: 'Telegram notifications will stop until a new bot token is saved.',
                confirmLabel: 'Remove Telegram Token',
                cancelLabel: 'Cancel',
                pendingLabel: 'Removing...',
                tone: 'danger',
                onConfirm: async () => {
                    const snapshot = await clearTelegramBotTokenCommand();
                    setNotificationDelivery(snapshot);
                    setNotice('Telegram bot token removed from this Windows profile.');
                    showWarningToast('Telegram bot token removed.');
                }
            });
            return null;
        },
        async detectTelegramChat() {
            try {
                const detected = await detectTelegramChatCommand();
                setNotificationDelivery((previous) => ({
                    ...previous,
                    settings: {
                        ...previous.settings,
                        telegram: {
                            ...previous.settings.telegram,
                            chatId: detected.chatId
                        }
                    },
                    telegramState: {
                        ...previous.telegramState,
                        lastResolvedChatTitle: detected.title
                    }
                }));
                setNotice(`Detected Telegram chat ${detected.title ? `${detected.title} ` : ''}(${detected.chatId}).`);
                showSuccessToast('Telegram chat detected.');
                return detected;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                showErrorToast('Telegram chat detection failed.');
                return null;
            }
        },
        async sendTestTelegramNotification() {
            try {
                const result = await sendTestTelegramNotificationCommand();
                setNotificationDelivery((previous) => ({
                    ...previous,
                    telegramState: result.state
                }));
                setNotice(result.message);
                if (result.ok) {
                    showSuccessToast('Telegram test notification sent.');
                } else {
                    showWarningToast(result.message);
                }
                return result;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setNotice(message);
                showErrorToast('Telegram test notification failed.');
                return null;
            }
        }
    };
}
