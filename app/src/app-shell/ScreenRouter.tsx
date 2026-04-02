import type { DesktopController } from '@/controllers/desktop/use-desktop-controller';
import { ConfigScreen } from '@/features/config/config-screen';
import { DashboardScreen } from '@/features/dashboard/dashboard-screen';
import { LogsScreen } from '@/features/logs/logs-screen';
import { PreviewScreen } from '@/features/preview/preview-screen';
import { SessionScreen } from '@/features/session/session-screen';
import { SupportScreen } from '@/features/support/support-screen';
import type { Screen } from '@/shared/screens';

interface ScreenRouterProps {
    screen: Screen;
    controller: DesktopController;
    onSelectScreen(screen: Screen): void;
}

export function ScreenRouter({ screen, controller, onSelectScreen }: ScreenRouterProps) {
    if (screen === 'dashboard') {
        return (
            <DashboardScreen
                groupedMetrics={controller.groupedMetrics}
                latestSummary={controller.latestSummary}
                senderState={controller.senderState}
                hasActiveSession={controller.hasActiveSession}
                appReadiness={controller.appReadiness}
                setupChecklist={controller.setupChecklist}
                recoveryState={controller.recoveryState}
                runtimeMessage={controller.sidecarMessage}
                onOpenConfig={() => onSelectScreen('config')}
                onOpenSession={() => onSelectScreen('session')}
                onRunDryRun={async () => {
                    await controller.runDryRunCommand();
                    onSelectScreen('preview');
                }}
                onRunPreflight={async () => {
                    await controller.runPreflightCommand();
                    onSelectScreen('session');
                }}
                onOpenLogs={async () => {
                    await controller.loadCurrentLogs();
                    onSelectScreen('logs');
                }}
                onResumeSession={async () => {
                    await controller.startSessionCommand();
                    onSelectScreen('session');
                }}
                onDiscardCheckpoint={async () => {
                    await controller.discardResumeCheckpoint();
                }}
            />
        );
    }

    if (screen === 'config') {
        return (
            <ConfigScreen
                draft={controller.draft}
                setup={controller.setup}
                tokenStatus={controller.appReadiness.token}
                setupChecklist={controller.setupChecklist}
                notice={controller.surfaceNotices.config}
                environmentDraft={controller.environmentDraft}
                runtime={controller.runtime}
                onEnvironmentDraftChange={controller.setEnvironmentDraft}
                onSaveEnvironment={async () => {
                    await controller.saveEnvironmentDraft();
                }}
                onClearSecureToken={async () => {
                    await controller.clearSecureToken();
                }}
                onOpenDataDirectory={async () => {
                    await controller.openDesktopDataDirectory();
                }}
                onOpenConfig={() => onSelectScreen('config')}
                onRunPreflight={async () => {
                    await controller.runPreflightCommand();
                    onSelectScreen('session');
                }}
                onOpenSession={() => onSelectScreen('session')}
                onSaveConfig={async () => {
                    await controller.saveConfigDraft();
                }}
                onPreviewDryRun={async () => {
                    await controller.runDryRunCommand();
                    onSelectScreen('preview');
                }}
            />
        );
    }

    if (screen === 'preview') {
        return (
            <PreviewScreen
                runtime={controller.runtime}
                setRuntime={controller.setRuntime}
                dryRun={controller.dryRun}
                onRefreshPreview={async () => {
                    await controller.runDryRunCommand();
                }}
                onOpenConfig={() => onSelectScreen('config')}
            />
        );
    }

    if (screen === 'session') {
        return (
            <SessionScreen
                runtime={controller.runtime}
                setRuntime={controller.setRuntime}
                session={controller.session}
                hasActiveSession={controller.hasActiveSession}
                senderState={controller.senderState}
                preflight={controller.preflight}
                appReadiness={controller.appReadiness}
                recoveryState={controller.recoveryState}
                notice={controller.surfaceNotices.session}
                runtimeMessage={controller.sidecarMessage}
                onStart={async () => {
                    await controller.startSessionCommand();
                }}
                onRunPreflight={async () => {
                    await controller.runPreflightCommand();
                }}
                onPauseResume={async () => {
                    await controller.togglePauseResume();
                }}
                onStop={async () => {
                    await controller.stopCurrentSession();
                }}
                onDiscardCheckpoint={async () => {
                    await controller.discardResumeCheckpoint();
                }}
                onOpenConfig={() => onSelectScreen('config')}
            />
        );
    }

    if (screen === 'logs') {
        return (
            <LogsScreen
                logs={controller.logs}
                sessionId={controller.currentLogSessionId}
                notice={controller.surfaceNotices.logs}
                onRefresh={async () => {
                    await controller.loadCurrentLogs();
                }}
                onOpenLogFile={async () => {
                    await controller.openCurrentLogFile();
                }}
            />
        );
    }

    return (
        <SupportScreen
            diagnostics={controller.releaseDiagnostics}
            setup={controller.setup}
            supportBundle={controller.supportBundle}
            inboxMonitorSettings={controller.inboxMonitorSettings}
            inboxMonitorState={controller.inboxMonitorState}
            notificationDelivery={controller.notificationDelivery}
            hasActiveSession={controller.hasActiveSession}
            notice={controller.notice}
            onCopyDiagnostics={async () => {
                await controller.copyReleaseDiagnostics();
            }}
            onOpenDataDirectory={async () => {
                await controller.openDesktopDataDirectory();
            }}
            onOpenLogsDirectory={async () => {
                await controller.openLogsDirectory();
            }}
            onExportSupportBundle={async () => {
                await controller.exportSupportBundle();
            }}
            onResetRuntimeState={async () => {
                await controller.resetRuntimeState();
            }}
            onSaveInboxMonitorSettings={async (settings) => {
                await controller.saveInboxMonitorSettingsDraft(settings);
            }}
            onSaveNotificationDeliverySettings={async (settings) => {
                await controller.saveNotificationDeliverySettingsDraft(settings);
            }}
            onSaveTelegramBotToken={async (botToken) => {
                await controller.saveTelegramBotTokenDraft(botToken);
            }}
            onClearTelegramBotToken={async () => {
                await controller.clearTelegramBotToken();
            }}
            onDetectTelegramChat={async () => {
                await controller.detectTelegramChat();
            }}
            onSendTestTelegramNotification={async () => {
                await controller.sendTestTelegramNotification();
            }}
        />
    );
}
