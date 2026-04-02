import { writeText as writeClipboardText } from '@tauri-apps/plugin-clipboard-manager';
import type {
    AppConfig,
    InboxMonitorSettings,
    InboxMonitorState,
    LogEntry,
    NotificationDeliverySnapshot,
    SenderStateRecord,
    SessionSnapshot,
} from '@/lib/desktop';

export const emptyConfig: AppConfig = {
    userAgent: '',
    channels: [],
    messageGroups: {
        default: ['Hello!'],
    },
};

export const defaultSenderState: SenderStateRecord = {
    schemaVersion: 1,
    summaries: [],
    recentFailures: [],
    recentMessageHistory: {},
    channelHealth: {},
};

export const defaultInboxMonitorSettings: InboxMonitorSettings = {
    enabled: false,
    pollIntervalSeconds: 30,
    notifyDirectMessages: true,
    notifyMessageRequests: true,
};

export const defaultInboxMonitorState: InboxMonitorState = {
    status: 'stopped',
    enabled: false,
    pollIntervalSeconds: 30,
};

export const defaultNotificationDeliverySnapshot: NotificationDeliverySnapshot = {
    settings: {
        windowsDesktopEnabled: true,
        telegram: {
            enabled: false,
            botTokenStored: false,
            chatId: '',
            previewMode: 'full',
        },
    },
    telegramState: {
        status: 'disabled',
    },
};

export async function copyTextToClipboard(text: string) {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        await writeClipboardText(text);
        return;
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    throw new Error('Clipboard access is unavailable in this environment.');
}

export function mergeLogsById(entries: LogEntry[], limit: number = 500): LogEntry[] {
    const seen = new Set<string>();
    const merged: LogEntry[] = [];

    for (const entry of entries) {
        if (seen.has(entry.id)) {
            continue;
        }

        seen.add(entry.id);
        merged.push(entry);

        if (merged.length >= limit) {
            break;
        }
    }

    return merged;
}

export function toneFromStatus(status?: SessionSnapshot['status']) {
    switch (status) {
        case 'running':
            return 'success';
        case 'paused':
        case 'stopped':
            return 'warning';
        case 'failed':
            return 'danger';
        case 'completed':
            return 'success';
        default:
            return 'neutral';
    }
}
