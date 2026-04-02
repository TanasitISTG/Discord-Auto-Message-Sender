import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type {
    DesktopSetupState,
    InboxMonitorSettings,
    InboxMonitorState,
    NotificationDeliverySettings,
    NotificationDeliverySnapshot,
    ReleaseDiagnostics,
    SupportBundleResult,
} from '@/lib/desktop';
import { InboxMonitorCard } from './inbox-monitor-card';
import { TelegramNotificationsCard } from './telegram-notifications-card';

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border border-border/50 bg-background/50 p-4 shadow-xs hover:bg-card/60 transition-colors">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
            <div className="mt-2 break-all font-mono text-xs text-foreground/90">{value}</div>
        </div>
    );
}

interface SupportScreenProps {
    diagnostics: ReleaseDiagnostics | null;
    setup: DesktopSetupState | null;
    supportBundle: SupportBundleResult | null;
    inboxMonitorSettings: InboxMonitorSettings;
    inboxMonitorState: InboxMonitorState;
    notificationDelivery: NotificationDeliverySnapshot;
    hasActiveSession: boolean;
    notice: string;
    onCopyDiagnostics(): void | Promise<void>;
    onOpenDataDirectory(): void | Promise<void>;
    onOpenLogsDirectory(): void | Promise<void>;
    onExportSupportBundle(): void | Promise<void>;
    onResetRuntimeState(): void | Promise<void>;
    onSaveInboxMonitorSettings(settings: InboxMonitorSettings): void | Promise<void>;
    onSaveNotificationDeliverySettings(settings: NotificationDeliverySettings): void | Promise<void>;
    onSaveTelegramBotToken(botToken: string): void | Promise<void>;
    onClearTelegramBotToken(): void | Promise<void>;
    onDetectTelegramChat(): void | Promise<void>;
    onSendTestTelegramNotification(): void | Promise<void>;
}

export function SupportScreen({
    diagnostics,
    setup,
    supportBundle,
    inboxMonitorSettings,
    inboxMonitorState,
    notificationDelivery,
    hasActiveSession,
    notice,
    onCopyDiagnostics,
    onOpenDataDirectory,
    onOpenLogsDirectory,
    onExportSupportBundle,
    onResetRuntimeState,
    onSaveInboxMonitorSettings,
    onSaveNotificationDeliverySettings,
    onSaveTelegramBotToken,
    onClearTelegramBotToken,
    onDetectTelegramChat,
    onSendTestTelegramNotification,
}: SupportScreenProps) {
    return (
        <section className="flex flex-col gap-4 xl:flex-row xl:items-start">
            <div className="min-w-0 flex-1 space-y-4">
                <InboxMonitorCard
                    settings={inboxMonitorSettings}
                    state={inboxMonitorState}
                    tokenPresent={Boolean(setup?.tokenPresent)}
                    onSave={onSaveInboxMonitorSettings}
                />

                <TelegramNotificationsCard
                    delivery={notificationDelivery}
                    onSaveSettings={onSaveNotificationDeliverySettings}
                    onSaveBotToken={onSaveTelegramBotToken}
                    onClearBotToken={onClearTelegramBotToken}
                    onDetectChat={onDetectTelegramChat}
                    onSendTest={onSendTestTelegramNotification}
                />

                <Card>
                    <CardHeader>
                        <CardTitle>Actions</CardTitle>
                        <CardDescription>Self-serve public-beta recovery and support actions.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Button variant="secondary" onClick={onCopyDiagnostics} disabled={!diagnostics}>
                                Copy Diagnostics JSON
                            </Button>
                            <Button variant="secondary" onClick={onOpenDataDirectory} disabled={!diagnostics}>
                                Open Data Folder
                            </Button>
                            <Button variant="secondary" onClick={onOpenLogsDirectory} disabled={!diagnostics}>
                                Open Logs Folder
                            </Button>
                            <Button onClick={onExportSupportBundle} disabled={!diagnostics}>
                                Export Support Bundle
                            </Button>
                        </div>
                        <Button
                            className="w-full"
                            variant="danger"
                            disabled={hasActiveSession}
                            onClick={onResetRuntimeState}
                        >
                            Reset Runtime State
                        </Button>
                        <div className="rounded-xl border border-border/50 bg-background/50 p-5 text-sm leading-relaxed text-muted-foreground shadow-xs">
                            {hasActiveSession
                                ? 'Stop the active session before resetting runtime state.'
                                : 'Reset Runtime State removes .sender-state.json and session logs without touching config.json or the secure token stores.'}
                        </div>

                        {supportBundle ? (
                            <div className="space-y-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-50">
                                <div className="font-medium">Latest support bundle</div>
                                <div className="break-all font-mono text-xs text-cyan-50/90">{supportBundle.path}</div>
                                <div className="text-cyan-50/80">
                                    Included {supportBundle.includedFiles.length} file
                                    {supportBundle.includedFiles.length === 1 ? '' : 's'}.
                                </div>
                                {supportBundle.missingFiles.length > 0 ? (
                                    <div className="text-cyan-50/80">
                                        Missing: {supportBundle.missingFiles.join(', ')}
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

                        <div className="rounded-xl border border-border/50 bg-background/50 p-5 text-sm leading-relaxed text-muted-foreground shadow-xs">
                            {notice}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Public Beta Notes</CardTitle>
                        <CardDescription>Release constraints for the current Windows beta.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-muted-foreground">
                        <div className="rounded-xl border border-border/50 bg-background/50 p-5 shadow-xs">
                            <div className="mb-2 font-semibold tracking-tight text-foreground">
                                Unsigned Windows Public Beta
                            </div>
                            <div className="leading-relaxed">
                                This build is Windows-only, uses manual MSI updates, and does not ship an auto-updater.
                            </div>
                        </div>
                        <div className="rounded-xl border border-border/50 bg-background/50 p-5 shadow-xs">
                            <div className="mb-2 font-semibold tracking-tight text-foreground">Manual updates</div>
                            <div className="leading-relaxed">
                                Install the newer MSI over the existing version. Downgrades are blocked.
                            </div>
                        </div>
                        <div className="rounded-xl border border-border/50 bg-background/50 p-5 shadow-xs">
                            <div className="mb-2 font-semibold tracking-tight text-foreground">
                                Support export safety
                            </div>
                            <div className="leading-relaxed">
                                The support bundle excludes secure token stores and `.env`, and it redacts plaintext
                                token values, message templates, recent message history, and Telegram error details
                                before export.
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="min-w-0 flex-1 space-y-4">
                <Card>
                    <CardHeader>
                        <CardTitle>Release Diagnostics</CardTitle>
                        <CardDescription>Public-beta runtime details from the packaged desktop shell.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {diagnostics ? (
                            <>
                                <DetailRow label="App version" value={diagnostics.appVersion} />
                                <DetailRow label="Runtime status" value={diagnostics.sidecarStatus} />
                                <DetailRow label="Token storage" value={diagnostics.tokenStorage} />
                                <DetailRow label="App data path" value={diagnostics.dataDir} />
                                <DetailRow label="Logs path" value={diagnostics.logsDir} />
                                <DetailRow label="Config path" value={diagnostics.configPath} />
                                <DetailRow label="Sender state path" value={diagnostics.statePath} />
                                <DetailRow label="Secure token path" value={diagnostics.secureStorePath} />
                            </>
                        ) : (
                            <div className="rounded-xl border border-dashed border-border/50 bg-background/50 p-6 text-center text-sm text-muted-foreground">
                                Loading release diagnostics...
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Issue Reporting</CardTitle>
                        <CardDescription>What to send when a public-beta issue needs investigation.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-muted-foreground">
                        <div className="rounded-xl border border-border/50 bg-background/50 p-5 shadow-xs">
                            <div className="font-semibold tracking-tight text-foreground">
                                1. Export a support bundle
                            </div>
                            <div className="mt-2 leading-relaxed">
                                Use the support bundle action after reproducing the issue if possible.
                            </div>
                        </div>
                        <div className="rounded-xl border border-border/50 bg-background/50 p-5 shadow-xs">
                            <div className="font-semibold tracking-tight text-foreground">
                                2. Describe the exact action
                            </div>
                            <div className="mt-2 leading-relaxed">
                                Include what screen you were on, what you clicked, and what you expected to happen.
                            </div>
                        </div>
                        <div className="rounded-xl border border-border/50 bg-background/50 p-5 shadow-xs">
                            <div className="font-semibold tracking-tight text-foreground">
                                3. Attach the exported ZIP
                            </div>
                            <div className="mt-2 leading-relaxed">
                                Attach the support bundle path or ZIP file instead of copying local app-data files
                                manually.
                            </div>
                        </div>
                        {setup?.warning ? (
                            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-amber-100 shadow-xs backdrop-blur-xs">
                                <span className="font-semibold tracking-tight">Setup warning:</span>{' '}
                                <span className="leading-relaxed">{setup.warning}</span>
                            </div>
                        ) : null}
                    </CardContent>
                </Card>
            </div>
        </section>
    );
}
