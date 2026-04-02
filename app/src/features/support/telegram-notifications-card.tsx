import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import type { NotificationDeliverySnapshot, NotificationDeliverySettings } from '@/lib/desktop';

interface TelegramNotificationsCardProps {
    delivery: NotificationDeliverySnapshot;
    onSaveSettings(settings: NotificationDeliverySettings): void | Promise<void>;
    onSaveBotToken(botToken: string): void | Promise<void>;
    onClearBotToken(): void | Promise<void>;
    onDetectChat(): void | Promise<void>;
    onSendTest(): void | Promise<void>;
}

function statusLabel(status: NotificationDeliverySnapshot['telegramState']['status']) {
    switch (status) {
        case 'ready':
            return 'ready';
        case 'testing':
            return 'testing';
        case 'failed':
            return 'failed';
        case 'unconfigured':
            return 'unconfigured';
        default:
            return 'disabled';
    }
}

function formatLocalTimestamp(value?: string) {
    if (!value) {
        return 'Never';
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function TelegramNotificationsCard({
    delivery,
    onSaveSettings,
    onSaveBotToken,
    onClearBotToken,
    onDetectChat,
    onSendTest,
}: TelegramNotificationsCardProps) {
    const [draft, setDraft] = useState<NotificationDeliverySettings>(delivery.settings);
    const [botToken, setBotToken] = useState('');
    const [isSavingSettings, setIsSavingSettings] = useState(false);
    const [isSavingBotToken, setIsSavingBotToken] = useState(false);
    const [isDetectingChat, setIsDetectingChat] = useState(false);
    const [isSendingTest, setIsSendingTest] = useState(false);

    useEffect(() => {
        setDraft(delivery.settings);
    }, [delivery.settings]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Telegram Notifications</CardTitle>
                <CardDescription>
                    Fan out new Discord DMs and message requests to a personal Telegram bot chat while the app is
                    running.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <label className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/50 p-4 text-sm text-foreground">
                    <span className="font-medium">Windows desktop notifications</span>
                    <Checkbox
                        checked={draft.windowsDesktopEnabled}
                        onCheckedChange={(checked) =>
                            setDraft((previous) => ({
                                ...previous,
                                windowsDesktopEnabled: checked === true,
                            }))
                        }
                    />
                </label>

                <label className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/50 p-4 text-sm text-foreground">
                    <span className="font-medium">Telegram notifications</span>
                    <Checkbox
                        checked={draft.telegram.enabled}
                        onCheckedChange={(checked) =>
                            setDraft((previous) => ({
                                ...previous,
                                telegram: {
                                    ...previous.telegram,
                                    enabled: checked === true,
                                },
                            }))
                        }
                    />
                </label>

                <label className="block space-y-2 text-sm text-muted-foreground">
                    <span>Telegram bot token</span>
                    <Input
                        type="password"
                        placeholder={
                            delivery.settings.telegram.botTokenStored
                                ? 'Stored securely. Paste to replace.'
                                : 'Paste your BotFather token'
                        }
                        value={botToken}
                        onChange={(event) => setBotToken(event.target.value)}
                    />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                    <Button
                        variant="secondary"
                        onClick={async () => {
                            setIsSavingBotToken(true);
                            try {
                                await onSaveBotToken(botToken);
                                setBotToken('');
                            } finally {
                                setIsSavingBotToken(false);
                            }
                        }}
                        disabled={!botToken.trim() || isSavingBotToken}
                    >
                        {isSavingBotToken ? 'Saving Telegram Bot Token...' : 'Save Telegram Bot Token'}
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={() => {
                            setBotToken('');
                            void onClearBotToken();
                        }}
                        disabled={!delivery.settings.telegram.botTokenStored}
                    >
                        Clear Telegram Bot Token
                    </Button>
                </div>

                <label className="block space-y-2 text-sm text-muted-foreground">
                    <span>Telegram chat ID</span>
                    <Input
                        type="text"
                        placeholder="Detected or pasted personal chat ID"
                        value={draft.telegram.chatId}
                        onChange={(event) =>
                            setDraft((previous) => ({
                                ...previous,
                                telegram: {
                                    ...previous.telegram,
                                    chatId: event.target.value,
                                },
                            }))
                        }
                    />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                    <Button
                        variant="secondary"
                        onClick={async () => {
                            setIsDetectingChat(true);
                            try {
                                await onDetectChat();
                            } finally {
                                setIsDetectingChat(false);
                            }
                        }}
                        disabled={!delivery.settings.telegram.botTokenStored || isDetectingChat}
                    >
                        {isDetectingChat ? 'Detecting Chat ID...' : 'Detect Chat ID'}
                    </Button>
                    <Button
                        onClick={async () => {
                            setIsSendingTest(true);
                            try {
                                await onSendTest();
                            } finally {
                                setIsSendingTest(false);
                            }
                        }}
                        disabled={
                            !delivery.settings.telegram.enabled ||
                            !delivery.settings.telegram.botTokenStored ||
                            !delivery.settings.telegram.chatId.trim() ||
                            isSendingTest
                        }
                    >
                        {isSendingTest ? 'Sending Test Telegram Notification...' : 'Send Test Telegram Notification'}
                    </Button>
                </div>

                <Button
                    variant="secondary"
                    onClick={async () => {
                        setIsSavingSettings(true);
                        try {
                            await onSaveSettings(draft);
                        } finally {
                            setIsSavingSettings(false);
                        }
                    }}
                    disabled={isSavingSettings}
                >
                    {isSavingSettings ? 'Saving Delivery Settings...' : 'Save Delivery Settings'}
                </Button>

                <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-border/50 bg-background/50 p-4 text-sm">
                        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                            Telegram status
                        </div>
                        <div className="mt-2 font-semibold text-foreground">
                            {statusLabel(delivery.telegramState.status)}
                        </div>
                    </div>
                    <div className="rounded-xl border border-border/50 bg-background/50 p-4 text-sm">
                        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                            Bot token readiness
                        </div>
                        <div className="mt-2 font-semibold text-foreground">
                            {delivery.settings.telegram.botTokenStored ? 'stored securely' : 'missing'}
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-border/50 bg-background/50 p-4 text-sm text-muted-foreground">
                    Last Telegram delivery:{' '}
                    <span className="font-mono text-xs text-foreground/90">
                        {formatLocalTimestamp(delivery.telegramState.lastDeliveredAt)}
                    </span>
                </div>

                <div className="rounded-xl border border-border/50 bg-background/50 p-4 text-sm text-muted-foreground">
                    Last Telegram test:{' '}
                    <span className="font-mono text-xs text-foreground/90">
                        {formatLocalTimestamp(delivery.telegramState.lastTestedAt)}
                    </span>
                </div>

                {delivery.telegramState.lastError ? (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                        {delivery.telegramState.lastError}
                    </div>
                ) : null}

                <div className="rounded-xl border border-border/50 bg-background/50 p-5 text-sm leading-relaxed text-muted-foreground shadow-xs">
                    <div className="font-semibold tracking-tight text-foreground">Setup</div>
                    <div className="mt-2">1. Create a bot in Telegram with `@BotFather` and `/newbot`.</div>
                    <div>2. Open the bot and send `/start` from your personal Telegram account.</div>
                    <div>3. Save the bot token here, then use Detect Chat ID or fetch `getUpdates` manually.</div>
                    <div>
                        4. Telegram receives sender names and message previews, so those details leave the local app.
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
