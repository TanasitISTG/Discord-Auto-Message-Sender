import {
    InboxMonitorSettings,
    InboxMonitorSnapshot,
    InboxMonitorState,
    NotificationDeliverySettings,
    NotificationDeliverySnapshot,
    SenderStateRecord
} from '../../types';

export const STATE_FILE = '.sender-state.json';
export const STATE_LOCK_FILE = '.sender-state.lock';
export const STATE_SCHEMA_VERSION = 1;

export function getDefaultInboxMonitorSettings(): InboxMonitorSettings {
    return {
        enabled: false,
        pollIntervalSeconds: 30,
        notifyDirectMessages: true,
        notifyMessageRequests: true
    };
}

export function getDefaultInboxMonitorState(settings: InboxMonitorSettings = getDefaultInboxMonitorSettings()): InboxMonitorState {
    return {
        status: 'stopped',
        enabled: settings.enabled,
        pollIntervalSeconds: settings.pollIntervalSeconds
    };
}

export function getDefaultInboxMonitorSnapshot(): InboxMonitorSnapshot {
    const settings = getDefaultInboxMonitorSettings();
    return {
        settings,
        state: getDefaultInboxMonitorState(settings),
        lastSeen: {
            channelMessageIds: {}
        }
    };
}

export function getDefaultNotificationDeliverySettings(): NotificationDeliverySettings {
    return {
        windowsDesktopEnabled: true,
        telegram: {
            enabled: false,
            botTokenStored: false,
            chatId: '',
            previewMode: 'full'
        }
    };
}

export function getDefaultNotificationDeliverySnapshot(): NotificationDeliverySnapshot {
    return {
        settings: getDefaultNotificationDeliverySettings(),
        telegramState: {
            status: 'disabled'
        }
    };
}

export function getDefaultSenderState(): SenderStateRecord {
    return {
        schemaVersion: STATE_SCHEMA_VERSION,
        summaries: [],
        recentFailures: [],
        recentMessageHistory: {},
        channelHealth: {},
        inboxMonitor: getDefaultInboxMonitorSnapshot(),
        notificationDelivery: getDefaultNotificationDeliverySnapshot()
    };
}
