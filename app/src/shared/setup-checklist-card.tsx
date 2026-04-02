import { CheckCircle2, CircleDashed, Play, Settings2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { SetupChecklist, SetupChecklistAction, SetupChecklistItem } from '@/shared/readiness';

interface SetupChecklistCardProps {
    checklist: SetupChecklist;
    currentScreen: 'dashboard' | 'config';
    onOpenConfig(): void;
    onRunPreflight(): void | Promise<void>;
    onOpenSession(): void;
}

function ActionButton({
    item,
    currentScreen,
    onOpenConfig,
    onRunPreflight,
    onOpenSession,
}: {
    item: SetupChecklistItem;
    currentScreen: 'dashboard' | 'config';
    onOpenConfig(): void;
    onRunPreflight(): void | Promise<void>;
    onOpenSession(): void;
}) {
    if (item.done) {
        return <span className="text-[11px] uppercase tracking-[0.18em] text-emerald-300">Done</span>;
    }

    const actionMap: Record<
        SetupChecklistAction,
        { label: string; onClick: () => void | Promise<void>; icon: typeof Settings2 }
    > = {
        config: {
            label: currentScreen === 'config' ? 'Complete Below' : item.actionLabel,
            onClick: onOpenConfig,
            icon: Settings2,
        },
        preflight: {
            label: item.actionLabel,
            onClick: onRunPreflight,
            icon: ShieldCheck,
        },
        session: {
            label: item.actionLabel,
            onClick: onOpenSession,
            icon: Play,
        },
    };

    const action = actionMap[item.action];
    const Icon = action.icon;
    return (
        <Button
            size="sm"
            variant="secondary"
            disabled={currentScreen === 'config' && item.action === 'config'}
            onClick={() => void action.onClick()}
        >
            <Icon className="mr-2 h-4 w-4" />
            {action.label}
        </Button>
    );
}

export function SetupChecklistCard({
    checklist,
    currentScreen,
    onOpenConfig,
    onRunPreflight,
    onOpenSession,
}: SetupChecklistCardProps) {
    if (checklist.complete) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Setup Complete</CardTitle>
                    <CardDescription>
                        The packaged app has the basics it needs: secure token, saved config, and a successful preflight
                        in this session.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-muted-foreground">
                        {checklist.completedCount}/{checklist.totalCount} setup checks complete.
                    </div>
                    <Button variant="secondary" onClick={onOpenSession}>
                        <Play className="mr-2 h-4 w-4" />
                        Open Session
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Setup Checklist</CardTitle>
                <CardDescription>
                    Complete these packaged-app steps before treating the desktop sender as ready.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground">
                    {checklist.completedCount}/{checklist.totalCount} completed.
                </div>
                {checklist.items.map((item) => (
                    <div
                        key={item.id}
                        className={`rounded-xl border p-5 shadow-xs backdrop-blur-xs transition-colors ${
                            item.done
                                ? 'border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/15'
                                : 'border-border/50 bg-background/50 hover:bg-card/60'
                        }`}
                    >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    {item.done ? (
                                        <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                                    ) : (
                                        <CircleDashed className="h-4 w-4 text-muted-foreground" />
                                    )}
                                    <div className="font-medium text-foreground">{item.label}</div>
                                </div>
                                <div className="mt-2 text-sm text-muted-foreground">{item.detail}</div>
                            </div>
                            <ActionButton
                                item={item}
                                currentScreen={currentScreen}
                                onOpenConfig={onOpenConfig}
                                onRunPreflight={onRunPreflight}
                                onOpenSession={onOpenSession}
                            />
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
