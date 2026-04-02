import { NotificationDeliverySettings, NotificationDeliverySnapshot } from '../../types';
import {
    getDefaultNotificationDeliverySettings,
    getDefaultNotificationDeliverySnapshot
} from './schema';

function normalizeTelegramSettings(value: unknown): NotificationDeliverySettings['telegram'] {
    const defaults = getDefaultNotificationDeliverySettings().telegram;
    if (!value || typeof value !== 'object') {
        return defaults;
    }

    const settings = value as Partial<NotificationDeliverySettings['telegram']>;
    return {
        enabled: typeof settings.enabled === 'boolean' ? settings.enabled : defaults.enabled,
        botTokenStored: typeof settings.botTokenStored === 'boolean' ? settings.botTokenStored : defaults.botTokenStored,
        chatId: typeof settings.chatId === 'string' ? settings.chatId : defaults.chatId,
        previewMode: settings.previewMode === 'full' ? settings.previewMode : defaults.previewMode
    };
}

function normalizeNotificationDeliverySettings(value: unknown): NotificationDeliverySettings {
    const defaults = getDefaultNotificationDeliverySettings();
    if (!value || typeof value !== 'object') {
        return defaults;
    }

    const settings = value as Partial<NotificationDeliverySettings>;
    return {
        windowsDesktopEnabled: typeof settings.windowsDesktopEnabled === 'boolean'
            ? settings.windowsDesktopEnabled
            : defaults.windowsDesktopEnabled,
        telegram: normalizeTelegramSettings(settings.telegram)
    };
}

function normalizeTelegramState(value: unknown, settings: NotificationDeliverySettings): NotificationDeliverySnapshot['telegramState'] {
    const defaultStatus = settings.telegram.enabled
        ? (settings.telegram.botTokenStored && settings.telegram.chatId ? 'ready' : 'unconfigured')
        : 'disabled';
    if (!value || typeof value !== 'object') {
        return {
            status: defaultStatus
        };
    }

    const state = value as Partial<NotificationDeliverySnapshot['telegramState']>;
    const status = state.status === 'disabled'
        || state.status === 'unconfigured'
        || state.status === 'ready'
        || state.status === 'testing'
        || state.status === 'failed'
        ? state.status
        : defaultStatus;

    return {
        status,
        lastCheckedAt: typeof state.lastCheckedAt === 'string' ? state.lastCheckedAt : undefined,
        lastDeliveredAt: typeof state.lastDeliveredAt === 'string' ? state.lastDeliveredAt : undefined,
        lastTestedAt: typeof state.lastTestedAt === 'string' ? state.lastTestedAt : undefined,
        lastError: typeof state.lastError === 'string' ? state.lastError : undefined,
        lastResolvedChatTitle: typeof state.lastResolvedChatTitle === 'string' ? state.lastResolvedChatTitle : undefined
    };
}

export function normalizeNotificationDeliverySnapshot(value: unknown): NotificationDeliverySnapshot {
    const defaults = getDefaultNotificationDeliverySnapshot();
    if (!value || typeof value !== 'object') {
        return defaults;
    }

    const snapshot = value as Partial<NotificationDeliverySnapshot>;
    const settings = normalizeNotificationDeliverySettings(snapshot.settings);
    return {
        settings,
        telegramState: normalizeTelegramState(snapshot.telegramState, settings)
    };
}

export {
    getDefaultNotificationDeliverySettings,
    getDefaultNotificationDeliverySnapshot
};
