import { ChangeEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    ArrowDown,
    ArrowUp,
    LayoutDashboard,
    Logs,
    Play,
    Plus,
    Save,
    Search,
    Settings2,
    Shuffle,
    Square,
    TimerReset,
    Trash2
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    AppConfig,
    DryRunResult,
    LogEntry,
    PreflightResult,
    SenderStateRecord,
    SessionState,
    getSessionState,
    loadConfig,
    loadLogs,
    loadState,
    openLogFile,
    pauseSession,
    resumeSession,
    runDryRun,
    runPreflight,
    saveConfig,
    startSession,
    stopSession,
    subscribeToAppEvents
} from '@/lib/desktop';

type Screen = 'dashboard' | 'config' | 'preview' | 'session' | 'logs';

const navigation = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'config' as const, label: 'Config', icon: Settings2 },
    { id: 'preview' as const, label: 'Dry Run', icon: Shuffle },
    { id: 'session' as const, label: 'Session', icon: Play },
    { id: 'logs' as const, label: 'Logs', icon: Logs }
];

const emptyConfig: AppConfig = {
    userAgent: '',
    channels: [],
    messageGroups: {
        default: ['Hello!']
    }
};

function toneFromStatus(status?: SessionState['status']) {
    switch (status) {
        case 'running':
            return 'success';
        case 'paused':
            return 'warning';
        case 'failed':
            return 'danger';
        case 'completed':
            return 'success';
        default:
            return 'neutral';
    }
}

function validateConfig(config: AppConfig): string[] {
    const errors: string[] = [];
    const groupNames = new Set(Object.keys(config.messageGroups));
    const channelIds = new Set<string>();

    if (!config.userAgent.trim()) {
        errors.push('User-Agent is required.');
    }

    if (config.channels.length === 0) {
        errors.push('Add at least one channel before saving.');
    }

    if (groupNames.size === 0) {
        errors.push('At least one message group is required.');
    }

    for (const [groupName, messages] of Object.entries(config.messageGroups)) {
        if (!groupName.trim()) {
            errors.push('Message group names cannot be blank.');
        }

        if (messages.length === 0) {
            errors.push(`Message group '${groupName}' must contain at least one message.`);
        }

        for (const message of messages) {
            if (!message.trim()) {
                errors.push(`Message group '${groupName}' contains an empty message.`);
            }

            if (message.length > 2000) {
                errors.push(`Message group '${groupName}' contains a message longer than Discord's 2000 character limit.`);
            }
        }
    }

    config.channels.forEach((channel, index) => {
        if (!channel.name.trim()) {
            errors.push(`Channel ${index + 1} is missing a name.`);
        }

        if (!/^\d{17,20}$/.test(channel.id.trim())) {
            errors.push(`Channel '${channel.name || `#${index + 1}`}' must use a valid Discord snowflake ID.`);
        }

        if (channelIds.has(channel.id)) {
            errors.push(`Channel ID '${channel.id}' is duplicated.`);
        }

        channelIds.add(channel.id);

        if (!channel.referrer.trim()) {
            errors.push(`Channel '${channel.name || channel.id}' is missing a referrer URL.`);
        }

        if (!groupNames.has(channel.messageGroup)) {
            errors.push(`Channel '${channel.name || channel.id}' references missing group '${channel.messageGroup}'.`);
        }

        if (channel.schedule) {
            if (channel.schedule.intervalSeconds < 0) {
                errors.push(`Channel '${channel.name || channel.id}' has a negative interval.`);
            }
            if (channel.schedule.randomMarginSeconds < 0) {
                errors.push(`Channel '${channel.name || channel.id}' has a negative random margin.`);
            }
        }
    });

    return [...new Set(errors)];
}

export default function App() {
    const [screen, setScreen] = useState<Screen>('dashboard');
    const [config, setConfig] = useState<AppConfig>(emptyConfig);
    const [session, setSession] = useState<SessionState | null>(null);
    const [senderState, setSenderState] = useState<SenderStateRecord>({ summaries: [], recentFailures: [] });
    const [preflight, setPreflight] = useState<PreflightResult | null>(null);
    const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [notice, setNotice] = useState('Loading desktop state...');
    const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
    const [selectedGroupName, setSelectedGroupName] = useState<string>('default');
    const [newGroupName, setNewGroupName] = useState('');
    const [cloneGroupName, setCloneGroupName] = useState('');
    const [logFilter, setLogFilter] = useState('');
    const [runtime, setRuntime] = useState({
        numMessages: 0,
        baseWaitSeconds: 5,
        marginSeconds: 2
    });

    useEffect(() => {
        void refreshAll();

        let cleanup = () => {};
        void (async () => {
            const unsubscribe = await subscribeToAppEvents((payload) => {
                const event = payload as { state?: SessionState; entry?: LogEntry; type?: string; message?: string };
                if (event.state) {
                    setSession(event.state);
                    void refreshState();
                }
                if (event.entry) {
                    setLogs((previous) => [event.entry!, ...previous].slice(0, 500));
                }
                if (event.type === 'close_blocked') {
                    setNotice(event.message ?? 'An active session is blocking window close.');
                    setScreen('session');
                }
            });
            cleanup = unsubscribe;
        })();

        return () => {
            cleanup();
        };
    }, []);

    const validationErrors = useMemo(() => validateConfig(config), [config]);
    const groupedMetrics = useMemo(() => ({
        channelCount: config.channels.length,
        groupCount: Object.keys(config.messageGroups).length,
        messageCount: Object.values(config.messageGroups).reduce((total, messages) => total + messages.length, 0)
    }), [config]);

    const selectedChannel = config.channels.find((channel) => channel.id === selectedChannelId) ?? config.channels[0] ?? null;
    const selectedGroupMessages = config.messageGroups[selectedGroupName] ?? [];

    const filteredLogs = useMemo(() => {
        const query = logFilter.trim().toLowerCase();
        if (!query) {
            return logs;
        }

        return logs.filter((entry) => {
            const haystack = `${entry.context} ${entry.level} ${entry.message} ${JSON.stringify(entry.meta ?? {})}`.toLowerCase();
            return haystack.includes(query);
        });
    }, [logFilter, logs]);

    async function refreshAll() {
        try {
            const [configResult, activeSession, persistedState] = await Promise.all([
                loadConfig(),
                getSessionState(),
                loadState()
            ]);

            if (configResult.kind === 'ok') {
                setConfig(configResult.config);
                setSelectedChannelId(configResult.config.channels[0]?.id ?? null);
                setSelectedGroupName(Object.keys(configResult.config.messageGroups)[0] ?? 'default');
                setNotice('Desktop shell connected.');
            } else if (configResult.kind === 'missing') {
                setNotice('No config.json found yet. Start building the config in the editor.');
            } else {
                setNotice(configResult.error);
            }

            if (activeSession) {
                setSession(activeSession);
            }

            setSenderState(persistedState);
            if (persistedState.warning) {
                setNotice(persistedState.warning);
            }
        } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error));
        }
    }

    async function refreshState() {
        try {
            setSenderState(await loadState());
        } catch {
            // Ignore transient state refresh failures and keep the live UI responsive.
        }
    }

    async function handleSaveConfig() {
        if (validationErrors.length > 0) {
            setNotice(validationErrors[0]);
            return;
        }

        try {
            const result = await saveConfig(config);
            setConfig(result.config);
            setNotice('Configuration saved locally.');
            await refreshState();
        } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error));
        }
    }

    async function handlePreflight() {
        try {
            const result = await runPreflight();
            setPreflight(result);
            setScreen('session');
            setNotice(result.ok ? 'Preflight passed.' : 'Preflight reported issues.');
        } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error));
        }
    }

    async function handleDryRun() {
        try {
            const result = await runDryRun(runtime);
            setDryRun(result);
            setScreen('preview');
            setNotice(result.willSendMessages ? 'Dry run generated. No messages were sent.' : 'Dry run found no sendable channels.');
        } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error));
        }
    }

    async function handleStartSession() {
        if (validationErrors.length > 0) {
            setNotice(validationErrors[0]);
            setScreen('config');
            return;
        }

        try {
            const nextState = await startSession(runtime);
            setSession(nextState);
            setScreen('session');
            setNotice('Session started from the desktop shell.');
        } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error));
        }
    }

    async function handlePauseResume() {
        if (!session) {
            return;
        }

        try {
            const nextState = session.status === 'paused'
                ? await resumeSession()
                : await pauseSession();
            setSession(nextState);
        } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error));
        }
    }

    async function handleStop() {
        if (!session || ['completed', 'failed'].includes(session.status)) {
            return;
        }

        if (!window.confirm('Stop the active session after the current send finishes?')) {
            return;
        }

        try {
            setSession(await stopSession());
        } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error));
        }
    }

    async function handleLoadLogs() {
        const sessionId = session?.id ?? senderState.lastSession?.id;
        if (!sessionId) {
            setNotice('Start a session before loading log output.');
            return;
        }

        try {
            const result = await loadLogs(sessionId);
            setLogs(result.entries.reverse());
            setScreen('logs');
        } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error));
        }
    }

    async function handleOpenLogFile() {
        const sessionId = session?.id ?? senderState.lastSession?.id;
        if (!sessionId) {
            setNotice('No session log is available yet.');
            return;
        }

        try {
            const result = await openLogFile(sessionId);
            setNotice(`Opening ${result}`);
        } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error));
        }
    }

    function patchUserAgent(userAgent: string) {
        setConfig((current) => ({
            ...current,
            userAgent
        }));
    }

    function addChannel() {
        const fallbackGroup = Object.keys(config.messageGroups)[0] ?? 'default';
        const channelId = `new-${Date.now()}`;
        setConfig((current) => ({
            ...current,
            channels: [
                ...current.channels,
                {
                    name: 'New channel',
                    id: channelId,
                    referrer: 'https://discord.com/channels/@me/000000000000000000',
                    messageGroup: fallbackGroup,
                    schedule: {
                        intervalSeconds: 5,
                        randomMarginSeconds: 2,
                        timezone: 'UTC',
                        maxSendsPerDay: null,
                        cooldownWindowSize: 3
                    }
                }
            ]
        }));
        setSelectedChannelId(channelId);
    }

    function updateChannel(channelId: string, field: 'name' | 'id' | 'referrer' | 'messageGroup', value: string) {
        setConfig((current) => ({
            ...current,
            channels: current.channels.map((channel) => channel.id === channelId ? { ...channel, [field]: value } : channel)
        }));
        if (field === 'id' && selectedChannelId === channelId) {
            setSelectedChannelId(value);
        }
    }

    function updateChannelSchedule(
        channelId: string,
        patch: Partial<NonNullable<AppConfig['channels'][number]['schedule']>>
    ) {
        setConfig((current) => ({
            ...current,
            channels: current.channels.map((channel) => channel.id === channelId
                ? {
                    ...channel,
                    schedule: {
                        intervalSeconds: channel.schedule?.intervalSeconds ?? runtime.baseWaitSeconds,
                        randomMarginSeconds: channel.schedule?.randomMarginSeconds ?? runtime.marginSeconds,
                        timezone: channel.schedule?.timezone ?? 'UTC',
                        maxSendsPerDay: channel.schedule?.maxSendsPerDay ?? null,
                        cooldownWindowSize: channel.schedule?.cooldownWindowSize ?? 3,
                        quietHours: channel.schedule?.quietHours ?? null,
                        ...patch
                    }
                }
                : channel)
        }));
    }

    function removeChannel(channelId: string) {
        setConfig((current) => ({
            ...current,
            channels: current.channels.filter((channel) => channel.id !== channelId)
        }));
        if (selectedChannelId === channelId) {
            const nextChannel = config.channels.find((channel) => channel.id !== channelId);
            setSelectedChannelId(nextChannel?.id ?? null);
        }
    }

    function addGroup() {
        const groupName = newGroupName.trim();
        if (!groupName) {
            setNotice('Enter a group name before adding it.');
            return;
        }

        if (config.messageGroups[groupName]) {
            setNotice(`Message group '${groupName}' already exists.`);
            return;
        }

        setConfig((current) => ({
            ...current,
            messageGroups: {
                ...current.messageGroups,
                [groupName]: ['New message']
            }
        }));
        setSelectedGroupName(groupName);
        setNewGroupName('');
    }

    function renameGroup(nextName: string) {
        const normalizedName = nextName.trim();
        if (!normalizedName || normalizedName === selectedGroupName) {
            return;
        }

        if (config.messageGroups[normalizedName]) {
            setNotice(`Message group '${normalizedName}' already exists.`);
            return;
        }

        const currentMessages = config.messageGroups[selectedGroupName];
        if (!currentMessages) {
            return;
        }

        setConfig((current) => {
            const nextGroups = Object.fromEntries(
                Object.entries(current.messageGroups).map(([name, messages]) => [name === selectedGroupName ? normalizedName : name, messages])
            );

            return {
                ...current,
                channels: current.channels.map((channel) => channel.messageGroup === selectedGroupName
                    ? { ...channel, messageGroup: normalizedName }
                    : channel),
                messageGroups: nextGroups
            };
        });
        setSelectedGroupName(normalizedName);
    }

    function cloneGroup() {
        const cloneName = cloneGroupName.trim();
        if (!cloneName) {
            setNotice('Enter a clone name first.');
            return;
        }

        if (config.messageGroups[cloneName]) {
            setNotice(`Message group '${cloneName}' already exists.`);
            return;
        }

        setConfig((current) => ({
            ...current,
            messageGroups: {
                ...current.messageGroups,
                [cloneName]: [...(current.messageGroups[selectedGroupName] ?? [])]
            }
        }));
        setCloneGroupName('');
    }

    function removeGroup(groupName: string) {
        const entries = Object.entries(config.messageGroups);
        if (entries.length <= 1) {
            setNotice('Keep at least one message group.');
            return;
        }

        const fallbackGroup = entries.find(([name]) => name !== groupName)?.[0];
        if (!fallbackGroup) {
            return;
        }

        setConfig((current) => ({
            ...current,
            channels: current.channels.map((channel) => channel.messageGroup === groupName
                ? { ...channel, messageGroup: fallbackGroup }
                : channel),
            messageGroups: Object.fromEntries(
                Object.entries(current.messageGroups).filter(([name]) => name !== groupName)
            )
        }));
        setSelectedGroupName(fallbackGroup);
    }

    function updateMessage(groupName: string, index: number, value: string) {
        setConfig((current) => ({
            ...current,
            messageGroups: {
                ...current.messageGroups,
                [groupName]: current.messageGroups[groupName].map((message, messageIndex) => messageIndex === index ? value : message)
            }
        }));
    }

    function addMessage(groupName: string) {
        setConfig((current) => ({
            ...current,
            messageGroups: {
                ...current.messageGroups,
                [groupName]: [...current.messageGroups[groupName], 'New message']
            }
        }));
    }

    function moveMessage(groupName: string, index: number, direction: -1 | 1) {
        const messages = [...(config.messageGroups[groupName] ?? [])];
        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= messages.length) {
            return;
        }

        [messages[index], messages[nextIndex]] = [messages[nextIndex], messages[index]];
        setConfig((current) => ({
            ...current,
            messageGroups: {
                ...current.messageGroups,
                [groupName]: messages
            }
        }));
    }

    function removeMessage(groupName: string, index: number) {
        const messages = config.messageGroups[groupName];
        if (messages.length <= 1) {
            setNotice('Each message group must contain at least one message.');
            return;
        }

        setConfig((current) => ({
            ...current,
            messageGroups: {
                ...current.messageGroups,
                [groupName]: current.messageGroups[groupName].filter((_, messageIndex) => messageIndex !== index)
            }
        }));
    }

    const latestSummary = senderState.summaries[0] ?? senderState.lastSession?.summary;

    return (
        <div className="grid min-h-screen grid-cols-1 bg-background text-foreground lg:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="grid-sheen border-r border-border/70 bg-card/70 p-5">
                <div className="mb-8">
                    <div className="mb-2 text-xs uppercase tracking-[0.3em] text-primary">Desktop Sender</div>
                    <h1 className="text-2xl font-semibold">Discord Auto Message Sender</h1>
                    <p className="mt-2 text-sm text-muted-foreground">GUI-first local control plane for config, preview, preflight, sessions, and logs.</p>
                </div>

                <nav className="space-y-2">
                    {navigation.map((item) => {
                        const Icon = item.icon;
                        return (
                            <button
                                key={item.id}
                                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
                                    screen === item.id
                                        ? 'border-primary/40 bg-primary/10 text-foreground'
                                        : 'border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-accent'
                                }`}
                                onClick={() => setScreen(item.id)}
                            >
                                <Icon className="h-4 w-4" />
                                {item.label}
                            </button>
                        );
                    })}
                </nav>
            </aside>

            <main className="p-5 lg:p-8">
                <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <div className="mb-2 flex items-center gap-3">
                            <Badge tone={toneFromStatus(session?.status)}>{session?.status ?? 'idle'}</Badge>
                            {session?.id ? <span className="font-mono text-xs text-muted-foreground">{session.id}</span> : null}
                            {validationErrors.length > 0 ? <Badge tone="warning">{validationErrors.length} validation issue{validationErrors.length === 1 ? '' : 's'}</Badge> : null}
                        </div>
                        <p className="text-sm text-muted-foreground">{notice}</p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <Button variant="secondary" onClick={handleDryRun}>
                            <Shuffle className="mr-2 h-4 w-4" />
                            Dry Run
                        </Button>
                        <Button variant="secondary" onClick={handlePreflight}>
                            <TimerReset className="mr-2 h-4 w-4" />
                            Preflight
                        </Button>
                        <Button onClick={handleStartSession}>
                            <Play className="mr-2 h-4 w-4" />
                            Start Session
                        </Button>
                    </div>
                </div>

                {screen === 'dashboard' ? (
                    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <MetricCard label="Configured Channels" value={String(groupedMetrics.channelCount)} detail="Ready for desktop sessions." />
                        <MetricCard label="Message Groups" value={String(groupedMetrics.groupCount)} detail={`${groupedMetrics.messageCount} total messages`} />
                        <MetricCard label="Last Run" value={latestSummary ? `${latestSummary.sentMessages}` : '0'} detail={latestSummary ? `${latestSummary.completedChannels}/${latestSummary.totalChannels} channels completed` : 'No session summary yet.'} />
                        <MetricCard label="Recent Failures" value={String(senderState.recentFailures.length)} detail="Tracked locally for the dashboard." />

                        <Card className="md:col-span-2 xl:col-span-2">
                            <CardHeader>
                                <CardTitle>Quick Actions</CardTitle>
                                <CardDescription>The desktop app now covers the normal operator loop without touching JSON or the terminal.</CardDescription>
                            </CardHeader>
                            <CardContent className="grid gap-3 sm:grid-cols-2">
                                <ActionTile title="Open Config" detail="Edit channels, groups, and messages visually." onClick={() => setScreen('config')} />
                                <ActionTile title="Run Dry Run" detail="Preview selected channels, groups, and cadence without sending." onClick={handleDryRun} />
                                <ActionTile title="Run Preflight" detail="Validate config and check channel access." onClick={handlePreflight} />
                                <ActionTile title="Open Logs" detail="Inspect local JSONL logs with filters." onClick={handleLoadLogs} />
                            </CardContent>
                        </Card>

                        <Card className="md:col-span-2">
                            <CardHeader>
                                <CardTitle>Recent Run Summary</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3 text-sm text-muted-foreground">
                                {latestSummary ? (
                                    <>
                                        <StateRow label="Started" value={new Date(latestSummary.startedAt).toLocaleString()} />
                                        <StateRow label="Finished" value={latestSummary.finishedAt ? new Date(latestSummary.finishedAt).toLocaleString() : 'In progress'} />
                                        <StateRow label="Sent messages" value={String(latestSummary.sentMessages)} />
                                        <StateRow label="Channel outcome" value={`${latestSummary.completedChannels} complete / ${latestSummary.failedChannels} failed`} />
                                    </>
                                ) : (
                                    <div>No session summary recorded yet.</div>
                                )}
                            </CardContent>
                        </Card>

                        <Card className="md:col-span-2 xl:col-span-4">
                            <CardHeader>
                                <CardTitle>Session History</CardTitle>
                                <CardDescription>Persistent local summaries from `.sender-state.json`.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {senderState.summaries.length === 0 ? (
                                    <div className="text-sm text-muted-foreground">No historical sessions recorded yet.</div>
                                ) : senderState.summaries.map((summary) => (
                                    <div key={`${summary.startedAt}-${summary.finishedAt ?? 'running'}`} className="grid gap-3 rounded-2xl border border-border bg-background/30 p-4 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
                                        <div>
                                            <div className="font-medium">{new Date(summary.startedAt).toLocaleString()}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {summary.finishedAt ? `Finished ${new Date(summary.finishedAt).toLocaleString()}` : 'In progress'}
                                            </div>
                                        </div>
                                        <div className="text-sm text-muted-foreground">{summary.sentMessages} messages sent</div>
                                        <div className="text-sm text-muted-foreground">{summary.completedChannels}/{summary.totalChannels} channels completed</div>
                                        <div className="text-sm text-muted-foreground">{summary.stopReason ?? 'Completed without stop reason'}</div>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    </section>
                ) : null}

                {screen === 'config' ? (
                    <section className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)_380px]">
                        <Card>
                            <CardHeader>
                                <CardTitle>Channels</CardTitle>
                                <CardDescription>Assign each channel to a message group and keep the send path editable without raw JSON.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <Button className="w-full" variant="secondary" onClick={addChannel}>
                                    <Plus className="mr-2 h-4 w-4" />
                                    Add Channel
                                </Button>
                                <div className="space-y-2">
                                    {config.channels.length === 0 ? (
                                        <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No channels configured yet.</div>
                                    ) : config.channels.map((channel) => (
                                        <button
                                            key={channel.id}
                                            className={`w-full rounded-xl border p-3 text-left ${
                                                selectedChannel?.id === channel.id ? 'border-primary/40 bg-primary/10' : 'border-border bg-background/30'
                                            }`}
                                            onClick={() => setSelectedChannelId(channel.id)}
                                        >
                                            <div className="font-medium">{channel.name || 'Unnamed channel'}</div>
                                            <div className="mt-1 font-mono text-xs text-muted-foreground">{channel.id}</div>
                                            <div className="mt-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">{channel.messageGroup}</div>
                                        </button>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Config Editor</CardTitle>
                                <CardDescription>Inline validation blocks invalid saves, and every edit stays local until you hit save.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <label className="block space-y-2">
                                    <span className="text-sm text-muted-foreground">User-Agent</span>
                                    <Input value={config.userAgent} onChange={(event: ChangeEvent<HTMLInputElement>) => patchUserAgent(event.target.value)} />
                                </label>

                                {selectedChannel ? (
                                    <div className="space-y-4 rounded-2xl border border-border bg-background/30 p-4">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="text-sm font-semibold">Selected Channel</div>
                                                <div className="text-xs text-muted-foreground">Edit identity, referrer, and group mapping.</div>
                                            </div>
                                            <Button variant="ghost" onClick={() => removeChannel(selectedChannel.id)}>
                                                <Trash2 className="mr-2 h-4 w-4" />
                                                Remove
                                            </Button>
                                        </div>

                                        <div className="grid gap-4 md:grid-cols-2">
                                            <Field label="Channel name">
                                                <Input value={selectedChannel.name} onChange={(event: ChangeEvent<HTMLInputElement>) => updateChannel(selectedChannel.id, 'name', event.target.value)} />
                                            </Field>
                                            <Field label="Channel ID">
                                                <Input value={selectedChannel.id} onChange={(event: ChangeEvent<HTMLInputElement>) => updateChannel(selectedChannel.id, 'id', event.target.value)} />
                                            </Field>
                                        </div>

                                        <Field label="Referrer URL">
                                            <Input value={selectedChannel.referrer} onChange={(event: ChangeEvent<HTMLInputElement>) => updateChannel(selectedChannel.id, 'referrer', event.target.value)} />
                                        </Field>

                                        <Field label="Message group">
                                            <select
                                                className="flex h-10 w-full rounded-xl border bg-background/60 px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
                                                value={selectedChannel.messageGroup}
                                                onChange={(event: ChangeEvent<HTMLSelectElement>) => updateChannel(selectedChannel.id, 'messageGroup', event.target.value)}
                                            >
                                                {Object.keys(config.messageGroups).map((groupName) => (
                                                    <option key={groupName} value={groupName}>{groupName}</option>
                                                ))}
                                            </select>
                                        </Field>

                                        <div className="grid gap-4 md:grid-cols-2">
                                            <Field label="Saved interval (sec)">
                                                <Input
                                                    type="number"
                                                    value={selectedChannel.schedule?.intervalSeconds ?? runtime.baseWaitSeconds}
                                                    onChange={(event: ChangeEvent<HTMLInputElement>) => updateChannelSchedule(selectedChannel.id, { intervalSeconds: Number(event.target.value) })}
                                                />
                                            </Field>
                                            <Field label="Random margin (sec)">
                                                <Input
                                                    type="number"
                                                    value={selectedChannel.schedule?.randomMarginSeconds ?? runtime.marginSeconds}
                                                    onChange={(event: ChangeEvent<HTMLInputElement>) => updateChannelSchedule(selectedChannel.id, { randomMarginSeconds: Number(event.target.value) })}
                                                />
                                            </Field>
                                            <Field label="Timezone">
                                                <Input
                                                    value={selectedChannel.schedule?.timezone ?? 'UTC'}
                                                    onChange={(event: ChangeEvent<HTMLInputElement>) => updateChannelSchedule(selectedChannel.id, { timezone: event.target.value })}
                                                />
                                            </Field>
                                            <Field label="Max sends / day">
                                                <Input
                                                    type="number"
                                                    value={selectedChannel.schedule?.maxSendsPerDay ?? ''}
                                                    onChange={(event: ChangeEvent<HTMLInputElement>) => updateChannelSchedule(selectedChannel.id, { maxSendsPerDay: event.target.value ? Number(event.target.value) : null })}
                                                />
                                            </Field>
                                            <Field label="Quiet hours start">
                                                <Input
                                                    placeholder="22:00"
                                                    value={selectedChannel.schedule?.quietHours?.start ?? ''}
                                                    onChange={(event: ChangeEvent<HTMLInputElement>) => updateChannelSchedule(selectedChannel.id, {
                                                        quietHours: {
                                                            start: event.target.value,
                                                            end: selectedChannel.schedule?.quietHours?.end ?? '06:00'
                                                        }
                                                    })}
                                                />
                                            </Field>
                                            <Field label="Quiet hours end">
                                                <Input
                                                    placeholder="06:00"
                                                    value={selectedChannel.schedule?.quietHours?.end ?? ''}
                                                    onChange={(event: ChangeEvent<HTMLInputElement>) => updateChannelSchedule(selectedChannel.id, {
                                                        quietHours: {
                                                            start: selectedChannel.schedule?.quietHours?.start ?? '22:00',
                                                            end: event.target.value
                                                        }
                                                    })}
                                                />
                                            </Field>
                                        </div>
                                    </div>
                                ) : null}

                                <div className="flex flex-wrap gap-3">
                                    <Button onClick={handleSaveConfig} disabled={validationErrors.length > 0}>
                                        <Save className="mr-2 h-4 w-4" />
                                        Save Config
                                    </Button>
                                    <Button variant="secondary" onClick={handleDryRun}>
                                        <Shuffle className="mr-2 h-4 w-4" />
                                        Preview Dry Run
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Message Groups</CardTitle>
                                <CardDescription>Rename, clone, reorder, and edit messages from one place.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex gap-2">
                                    <Input placeholder="New group name" value={newGroupName} onChange={(event: ChangeEvent<HTMLInputElement>) => setNewGroupName(event.target.value)} />
                                    <Button variant="secondary" onClick={addGroup}>Add</Button>
                                </div>

                                <div className="grid gap-2">
                                    {Object.entries(config.messageGroups).map(([groupName, messages]) => (
                                        <button
                                            key={groupName}
                                            className={`rounded-xl border p-3 text-left ${selectedGroupName === groupName ? 'border-primary/40 bg-primary/10' : 'border-border bg-background/30'}`}
                                            onClick={() => setSelectedGroupName(groupName)}
                                        >
                                            <div className="font-medium">{groupName}</div>
                                            <div className="text-xs text-muted-foreground">{messages.length} messages</div>
                                        </button>
                                    ))}
                                </div>

                                <div className="space-y-3 rounded-2xl border border-border bg-background/30 p-4">
                                    <Field label="Selected group name">
                                        <Input value={selectedGroupName} onChange={(event: ChangeEvent<HTMLInputElement>) => renameGroup(event.target.value)} />
                                    </Field>
                                    <div className="flex gap-2">
                                        <Input placeholder="Clone name" value={cloneGroupName} onChange={(event: ChangeEvent<HTMLInputElement>) => setCloneGroupName(event.target.value)} />
                                        <Button variant="secondary" onClick={cloneGroup}>Clone</Button>
                                    </div>
                                    <Button variant="ghost" onClick={() => removeGroup(selectedGroupName)}>
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Delete Group
                                    </Button>
                                </div>

                                <div className="space-y-3">
                                    {selectedGroupMessages.map((message, index) => (
                                        <div key={`${selectedGroupName}-${index}`} className="rounded-2xl border border-border bg-background/30 p-3">
                                            <div className="mb-2 flex items-center justify-between">
                                                <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Message {index + 1}</span>
                                                <div className="flex gap-2">
                                                    <Button variant="ghost" onClick={() => moveMessage(selectedGroupName, index, -1)} disabled={index === 0}>
                                                        <ArrowUp className="h-4 w-4" />
                                                    </Button>
                                                    <Button variant="ghost" onClick={() => moveMessage(selectedGroupName, index, 1)} disabled={index === selectedGroupMessages.length - 1}>
                                                        <ArrowDown className="h-4 w-4" />
                                                    </Button>
                                                    <Button variant="ghost" onClick={() => removeMessage(selectedGroupName, index)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                            <Textarea value={message} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateMessage(selectedGroupName, index, event.target.value)} />
                                        </div>
                                    ))}
                                </div>

                                <Button className="w-full" variant="secondary" onClick={() => addMessage(selectedGroupName)}>
                                    <Plus className="mr-2 h-4 w-4" />
                                    Add Message
                                </Button>
                            </CardContent>
                        </Card>
                    </section>
                ) : null}

                {screen === 'preview' ? (
                    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                        <Card>
                            <CardHeader>
                                <CardTitle>Dry Run Preview</CardTitle>
                                <CardDescription>No messages are sent. This is a local preview of channel selection, group resolution, and cadence.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid gap-3 md:grid-cols-3">
                                    <LabeledInput label="Messages / channel" value={runtime.numMessages} onChange={(value) => setRuntime((current) => ({ ...current, numMessages: Number(value) }))} />
                                    <LabeledInput label="Base wait (sec)" value={runtime.baseWaitSeconds} onChange={(value) => setRuntime((current) => ({ ...current, baseWaitSeconds: Number(value) }))} />
                                    <LabeledInput label="Random margin" value={runtime.marginSeconds} onChange={(value) => setRuntime((current) => ({ ...current, marginSeconds: Number(value) }))} />
                                </div>

                                <div className="flex flex-wrap gap-3">
                                    <Button onClick={handleDryRun}>
                                        <Shuffle className="mr-2 h-4 w-4" />
                                        Refresh Preview
                                    </Button>
                                    <Button variant="secondary" onClick={() => setScreen('config')}>
                                        Open Config
                                    </Button>
                                </div>

                                {!dryRun ? (
                                    <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">Run a dry run to generate a send preview.</div>
                                ) : (
                                    <div className="space-y-3">
                                        {dryRun.channels.map((channel) => (
                                            <div key={channel.channelId} className="rounded-2xl border border-border bg-background/30 p-4">
                                                <div className="mb-2 flex items-center justify-between gap-3">
                                                    <div>
                                                        <div className="font-semibold">{channel.channelName}</div>
                                                        <div className="text-xs text-muted-foreground">{channel.groupName}</div>
                                                    </div>
                                                    <Badge tone={channel.skipReasons.length === 0 ? 'success' : 'warning'}>
                                                        {channel.skipReasons.length === 0 ? 'sendable' : 'skipped'}
                                                    </Badge>
                                                </div>
                                                <div className="mb-3 text-sm text-muted-foreground">
                                                    Cadence: {channel.cadence.numMessages === 0 ? 'infinite until stopped' : `${channel.cadence.numMessages} messages`} with {channel.cadence.baseWaitSeconds}s base wait and {channel.cadence.marginSeconds}s margin.
                                                </div>
                                                <div className="space-y-2">
                                                    {channel.sampleMessages.length === 0 ? (
                                                        <div className="text-sm text-muted-foreground">No messages resolved for this channel.</div>
                                                    ) : channel.sampleMessages.map((message, index) => (
                                                        <div key={`${channel.channelId}-${index}`} className="rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-sm">
                                                            {message}
                                                        </div>
                                                    ))}
                                                </div>
                                                {channel.skipReasons.length > 0 ? (
                                                    <div className="mt-3 space-y-1 text-sm text-amber-300">
                                                        {channel.skipReasons.map((reason) => <div key={reason}>{reason}</div>)}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Preview Summary</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3 text-sm">
                                <StateRow label="Will send messages" value={dryRun?.willSendMessages ? 'Yes' : 'No'} />
                                <StateRow label="Selected channels" value={String(dryRun?.summary.selectedChannels ?? 0)} />
                                <StateRow label="Skipped channels" value={String(dryRun?.summary.skippedChannels ?? 0)} />
                                <StateRow label="Sample messages" value={String(dryRun?.summary.totalSampleMessages ?? 0)} />
                                <div className="rounded-xl border border-border bg-background/40 p-3 text-muted-foreground">
                                    {dryRun?.willSendMessages
                                        ? 'Dry run confirms the current config can resolve at least one sendable channel.'
                                        : 'Visible no-send state: fix skipped channels before starting a live session.'}
                                </div>
                            </CardContent>
                        </Card>
                    </section>
                ) : null}

                {screen === 'session' ? (
                    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                        <Card>
                            <CardHeader>
                                <CardTitle>Preflight And Live Session</CardTitle>
                                <CardDescription>Run validation, inspect per-channel access results, and control the active sender worker.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid gap-3 md:grid-cols-3">
                                    <LabeledInput label="Messages / channel" value={runtime.numMessages} onChange={(value) => setRuntime((current) => ({ ...current, numMessages: Number(value) }))} />
                                    <LabeledInput label="Base wait (sec)" value={runtime.baseWaitSeconds} onChange={(value) => setRuntime((current) => ({ ...current, baseWaitSeconds: Number(value) }))} />
                                    <LabeledInput label="Random margin" value={runtime.marginSeconds} onChange={(value) => setRuntime((current) => ({ ...current, marginSeconds: Number(value) }))} />
                                </div>

                                <div className="flex flex-wrap gap-3">
                                    <Button onClick={handleStartSession}>
                                        <Play className="mr-2 h-4 w-4" />
                                        Start
                                    </Button>
                                    <Button variant="secondary" onClick={handlePauseResume} disabled={!session || !['running', 'paused'].includes(session.status)}>
                                        {session?.status === 'paused' ? 'Resume' : 'Pause'}
                                    </Button>
                                    <Button variant="danger" onClick={handleStop} disabled={!session || ['completed', 'failed'].includes(session.status)}>
                                        <Square className="mr-2 h-4 w-4" />
                                        Stop
                                    </Button>
                                </div>

                                {preflight ? (
                                    <div className="space-y-3 rounded-2xl border border-border bg-background/30 p-4">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="text-sm font-semibold">Preflight Result</div>
                                                <div className="text-xs text-muted-foreground">{new Date(preflight.checkedAt).toLocaleString()}</div>
                                            </div>
                                            <Badge tone={preflight.ok ? 'success' : 'danger'}>{preflight.ok ? 'pass' : 'fail'}</Badge>
                                        </div>

                                        {preflight.issues.length > 0 ? (
                                            <div className="space-y-2 text-sm text-amber-300">
                                                {preflight.issues.map((issue) => <div key={issue}>{issue}</div>)}
                                            </div>
                                        ) : (
                                            <div className="text-sm text-muted-foreground">No blocking issues.</div>
                                        )}

                                        <div className="space-y-2">
                                            {preflight.channels.map((channel) => (
                                                <div key={channel.channelId} className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-sm">
                                                    <div>
                                                        <div>{channel.channelName}</div>
                                                        <div className="text-xs text-muted-foreground">{channel.reason ?? 'Access verified.'}</div>
                                                    </div>
                                                    <Badge tone={channel.ok ? 'success' : 'danger'}>
                                                        {channel.ok ? 'ok' : channel.status ?? 'fail'}
                                                    </Badge>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Session State</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3 text-sm">
                                <StateRow label="Status" value={session?.status ?? 'idle'} />
                                <StateRow label="Sent messages" value={String(session?.sentMessages ?? 0)} />
                                <StateRow label="Active channels" value={String(session?.activeChannels.length ?? 0)} />
                                <StateRow label="Completed channels" value={String(session?.completedChannels.length ?? 0)} />
                                <StateRow label="Failed channels" value={String(session?.failedChannels.length ?? 0)} />
                                {session?.summary ? (
                                    <div className="rounded-xl border border-border bg-background/40 p-3">
                                        <div className="mb-2 text-sm font-semibold">Final Summary</div>
                                        <div className="space-y-2 text-muted-foreground">
                                            <div>{session.summary.completedChannels}/{session.summary.totalChannels} channels completed</div>
                                            <div>{session.summary.sentMessages} messages sent</div>
                                        </div>
                                    </div>
                                ) : null}
                                {session?.stopReason ? (
                                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-red-200">
                                        <div className="mb-1 flex items-center gap-2 font-medium">
                                            <AlertCircle className="h-4 w-4" />
                                            Stop reason
                                        </div>
                                        <div>{session.stopReason}</div>
                                    </div>
                                ) : null}
                            </CardContent>
                        </Card>
                    </section>
                ) : null}

                {screen === 'logs' ? (
                    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                        <Card>
                            <CardHeader>
                                <CardTitle>Live Logs</CardTitle>
                                <CardDescription>Filter by channel, status, or event text without leaving the desktop app.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input className="pl-9" placeholder="Filter logs by channel, level, or message..." value={logFilter} onChange={(event: ChangeEvent<HTMLInputElement>) => setLogFilter(event.target.value)} />
                                </div>
                                <div className="max-h-[620px] space-y-2 overflow-y-auto rounded-2xl border border-border bg-background/50 p-3 font-mono text-xs">
                                    {filteredLogs.length === 0 ? (
                                        <div className="text-muted-foreground">No log entries match the current filter.</div>
                                    ) : filteredLogs.map((entry) => (
                                        <div key={entry.id} className="rounded-lg border border-border/60 px-3 py-2">
                                            <div className="mb-1 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                                                <span>{entry.context}</span>
                                                <span>{entry.level}</span>
                                                <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                                            </div>
                                            <div>{entry.message}</div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Log Actions</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <Button className="w-full" variant="secondary" onClick={handleLoadLogs}>
                                    Refresh from file
                                </Button>
                                <Button className="w-full" variant="secondary" onClick={handleOpenLogFile}>
                                    Open log file
                                </Button>
                            </CardContent>
                        </Card>
                    </section>
                ) : null}
            </main>
        </div>
    );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
    return (
        <Card>
            <CardHeader>
                <CardDescription>{label}</CardDescription>
                <CardTitle className="text-3xl">{value}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{detail}</CardContent>
        </Card>
    );
}

function ActionTile({ title, detail, onClick }: { title: string; detail: string; onClick: () => void | Promise<void> }) {
    return (
        <button className="rounded-2xl border border-border bg-background/40 p-4 text-left transition hover:border-primary/30 hover:bg-accent" onClick={() => void onClick()}>
            <div className="mb-2 text-sm font-semibold">{title}</div>
            <div className="text-sm text-muted-foreground">{detail}</div>
        </button>
    );
}

function LabeledInput({ label, value, onChange }: { label: string; value: number; onChange: (nextValue: string) => void }) {
    return (
        <label className="space-y-2 text-sm text-muted-foreground">
            <span>{label}</span>
            <Input type="number" value={value} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} />
        </label>
    );
}

function StateRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium text-foreground">{value}</span>
        </div>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block space-y-2">
            <span className="text-sm text-muted-foreground">{label}</span>
            {children}
        </label>
    );
}
