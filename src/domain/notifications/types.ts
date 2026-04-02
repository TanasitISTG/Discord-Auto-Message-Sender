export type InboxNotificationKind = 'direct_message' | 'message_request';
export type InboxMonitorStatus = 'stopped' | 'starting' | 'running' | 'blocked' | 'degraded' | 'failed';
export type NotificationChannel = 'windows_desktop' | 'telegram';
export type TelegramDeliveryStatus = 'disabled' | 'unconfigured' | 'ready' | 'testing' | 'failed';
export type TelegramPreviewMode = 'full';

export interface InboxNotificationItem {
    id: string;
    kind: InboxNotificationKind;
    channelId: string;
    channelName: string;
    authorId: string;
    authorName: string;
    previewText: string;
    messageId: string;
    receivedAt: string;
}

export interface InboxMonitorSettings {
    enabled: boolean;
    pollIntervalSeconds: number;
    notifyDirectMessages: boolean;
    notifyMessageRequests: boolean;
}

export interface InboxMonitorState {
    status: InboxMonitorStatus;
    enabled: boolean;
    pollIntervalSeconds: number;
    lastCheckedAt?: string;
    lastSuccessfulPollAt?: string;
    lastNotificationAt?: string;
    lastError?: string;
    backoffUntil?: string;
}

export interface InboxMonitorLastSeen {
    initializedAt?: string;
    selfUserId?: string;
    channelMessageIds: Record<string, string>;
}

export interface InboxMonitorSnapshot {
    settings: InboxMonitorSettings;
    state: InboxMonitorState;
    lastSeen: InboxMonitorLastSeen;
}

export interface TelegramSettings {
    enabled: boolean;
    botTokenStored: boolean;
    chatId: string;
    previewMode: TelegramPreviewMode;
}

export interface TelegramState {
    status: TelegramDeliveryStatus;
    lastCheckedAt?: string;
    lastDeliveredAt?: string;
    lastTestedAt?: string;
    lastError?: string;
    lastResolvedChatTitle?: string;
}

export interface NotificationDeliverySettings {
    windowsDesktopEnabled: boolean;
    telegram: TelegramSettings;
}

export interface NotificationDeliverySnapshot {
    settings: NotificationDeliverySettings;
    telegramState: TelegramState;
}
