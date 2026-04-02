import type {
    InboxMonitorSettings,
    InboxMonitorState,
    LogEntry,
    NotificationDeliverySnapshot,
    ReleaseDiagnostics,
    SenderStateRecord,
    SessionSnapshot,
    SidecarStatus,
    SupportBundleResult
} from '@/lib/desktop';
import type { ConfirmDialogRequest, PreferredScreen } from './types';

export interface SupportActionOptions {
    session: SessionSnapshot | null;
    releaseDiagnostics: ReleaseDiagnostics | null;
    setInboxMonitorSettings(next: InboxMonitorSettings): void;
    setInboxMonitorState(next: InboxMonitorState): void;
    setNotificationDelivery(next: NotificationDeliverySnapshot | ((previous: NotificationDeliverySnapshot) => NotificationDeliverySnapshot)): void;
    setSupportBundle(next: SupportBundleResult | null): void;
    setSenderState(next: SenderStateRecord): void;
    setReleaseDiagnostics(next: ReleaseDiagnostics | null): void;
    setSidecarStatus(next: SidecarStatus): void;
    setSession(next: SessionSnapshot | null): void;
    setLogs(next: LogEntry[]): void;
    setPreferredScreen(next: PreferredScreen): void;
    setNotice(next: string): void;
    requestConfirmation(request: Omit<ConfirmDialogRequest, 'open'>): void;
}
