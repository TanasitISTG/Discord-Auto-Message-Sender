import {
    AppEvent,
    InboxMonitorLastSeen,
    InboxMonitorSettings,
    InboxMonitorSnapshot,
    InboxMonitorState,
    InboxNotificationItem
} from '../../types';
import {
    getDefaultInboxMonitorSettings,
    getDefaultInboxMonitorSnapshot,
    getDefaultInboxMonitorState
} from '../../infrastructure/state-store';

export const MIN_POLL_INTERVAL_SECONDS = 15;
export const MAX_POLL_INTERVAL_SECONDS = 300;

export type SleepFn = (ms: number) => Promise<void>;
export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface MonitorPollResult {
    notifications: InboxNotificationItem[];
    lastSeen: InboxMonitorLastSeen;
    checkedAt: string;
}

export interface InboxMonitorOptions {
    initialSnapshot?: InboxMonitorSnapshot;
    emitEvent?: (event: AppEvent) => void;
    onSnapshotChange?: (snapshot: InboxMonitorSnapshot) => void;
    fetchImpl?: FetchImpl;
    sleep?: SleepFn;
    now?: () => Date;
    random?: () => number;
}

export interface StartInboxMonitorOptions {
    token?: string;
}

export interface InboxMonitorController {
    loadSettings(): InboxMonitorSettings;
    saveSettings(settings: InboxMonitorSettings): InboxMonitorSnapshot;
    getState(): InboxMonitorState;
    getSnapshot(): InboxMonitorSnapshot;
    start(options?: StartInboxMonitorOptions): Promise<InboxMonitorState>;
    stop(reason?: string): InboxMonitorState;
}

export function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function clampPollIntervalSeconds(value: number): number {
    if (!Number.isFinite(value)) {
        return getDefaultInboxMonitorSettings().pollIntervalSeconds;
    }

    return Math.max(MIN_POLL_INTERVAL_SECONDS, Math.min(MAX_POLL_INTERVAL_SECONDS, Math.round(value)));
}

export function normalizeSettings(settings: InboxMonitorSettings): InboxMonitorSettings {
    return {
        enabled: settings.enabled,
        pollIntervalSeconds: clampPollIntervalSeconds(settings.pollIntervalSeconds),
        notifyDirectMessages: settings.notifyDirectMessages,
        notifyMessageRequests: settings.notifyMessageRequests
    };
}

export function buildStatePatch(
    state: InboxMonitorState,
    patch: Partial<InboxMonitorState>
): InboxMonitorState {
    return {
        ...state,
        ...patch
    };
}

export function hydrateSnapshot(snapshot?: InboxMonitorSnapshot): InboxMonitorSnapshot {
    if (!snapshot) {
        return getDefaultInboxMonitorSnapshot();
    }

    return {
        settings: normalizeSettings(snapshot.settings),
        state: {
            ...snapshot.state,
            pollIntervalSeconds: clampPollIntervalSeconds(snapshot.state.pollIntervalSeconds),
            enabled: snapshot.settings.enabled
        },
        lastSeen: {
            initializedAt: snapshot.lastSeen.initializedAt,
            selfUserId: snapshot.lastSeen.selfUserId,
            channelMessageIds: { ...snapshot.lastSeen.channelMessageIds }
        }
    };
}

export { getDefaultInboxMonitorSnapshot, getDefaultInboxMonitorState, getDefaultInboxMonitorSettings };
