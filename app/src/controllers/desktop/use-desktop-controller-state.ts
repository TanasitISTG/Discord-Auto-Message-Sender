import { useEffect, useRef, useState } from 'react';
import type {
    DesktopSetupState,
    DryRunResult,
    InboxMonitorSettings,
    InboxMonitorState,
    LogEntry,
    NotificationDeliverySnapshot,
    PreflightResult,
    ReleaseDiagnostics,
    RuntimeOptions,
    SenderStateRecord,
    SessionSnapshot,
    SidecarStatus,
    SupportBundleResult,
} from '@/lib/desktop';
import {
    defaultInboxMonitorSettings,
    defaultInboxMonitorState,
    defaultNotificationDeliverySnapshot,
    defaultSenderState,
} from './helpers';
import type { PreferredScreen, RecoveryState } from './types';

export function useDesktopControllerState() {
    const [session, setSession] = useState<SessionSnapshot | null>(null);
    const [senderState, setSenderState] = useState<SenderStateRecord>(defaultSenderState);
    const [preflight, setPreflight] = useState<PreflightResult | null>(null);
    const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [setup, setSetup] = useState<DesktopSetupState | null>(null);
    const [inboxMonitorSettings, setInboxMonitorSettings] = useState<InboxMonitorSettings>(defaultInboxMonitorSettings);
    const [inboxMonitorState, setInboxMonitorState] = useState<InboxMonitorState>(defaultInboxMonitorState);
    const [notificationDelivery, setNotificationDelivery] = useState<NotificationDeliverySnapshot>(
        defaultNotificationDeliverySnapshot,
    );
    const [releaseDiagnostics, setReleaseDiagnostics] = useState<ReleaseDiagnostics | null>(null);
    const [supportBundle, setSupportBundle] = useState<SupportBundleResult | null>(null);
    const [configStatus, setConfigStatus] = useState<'loading' | 'ready' | 'missing' | 'invalid'>('loading');
    const [configIssue, setConfigIssue] = useState<string | null>(null);
    const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus>('connecting');
    const [sidecarMessage, setSidecarMessage] = useState<string | null>(null);
    const [recoveryState, setRecoveryState] = useState<RecoveryState | null>(null);
    const [environmentDraft, setEnvironmentDraft] = useState('');
    const [notice, setNotice] = useState('Loading desktop state...');
    const [preferredScreen, setPreferredScreen] = useState<PreferredScreen>(null);
    const [runtime, setRuntime] = useState<RuntimeOptions>({
        numMessages: 0,
        baseWaitSeconds: 5,
        marginSeconds: 2,
    });
    const sessionRef = useRef<SessionSnapshot | null>(null);

    useEffect(() => {
        sessionRef.current = session;
    }, [session]);

    return {
        session,
        setSession,
        senderState,
        setSenderState,
        preflight,
        setPreflight,
        dryRun,
        setDryRun,
        logs,
        setLogs,
        setup,
        setSetup,
        inboxMonitorSettings,
        setInboxMonitorSettings,
        inboxMonitorState,
        setInboxMonitorState,
        notificationDelivery,
        setNotificationDelivery,
        releaseDiagnostics,
        setReleaseDiagnostics,
        supportBundle,
        setSupportBundle,
        configStatus,
        setConfigStatus,
        configIssue,
        setConfigIssue,
        sidecarStatus,
        setSidecarStatus,
        sidecarMessage,
        setSidecarMessage,
        recoveryState,
        setRecoveryState,
        environmentDraft,
        setEnvironmentDraft,
        notice,
        setNotice,
        preferredScreen,
        setPreferredScreen,
        runtime,
        setRuntime,
        sessionRef,
    };
}
