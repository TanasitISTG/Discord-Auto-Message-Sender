import { Play, Shuffle, Square, TimerReset } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toneFromStatus, type DesktopController } from '@/controllers/desktop/use-desktop-controller';
import { navigation, type Screen } from '@/shared/screens';

interface AppHeaderProps {
    screen: Screen;
    controller: DesktopController;
    onSelectScreen(screen: Screen): void;
}

export function AppHeader({ screen, controller, onSelectScreen }: AppHeaderProps) {
    return (
        <header className="sticky top-0 z-10 flex min-h-[56px] items-center justify-between border-b border-border/50 bg-background/80 px-5 py-3 backdrop-blur-md lg:px-8">
            <div className="flex items-center gap-3 sm:gap-4">
                <h2 className="text-sm font-semibold tracking-wide text-foreground">
                    {navigation.find((item) => item.id === screen)?.label ?? 'Dashboard'}
                </h2>

                <div className="hidden h-4 w-px bg-border/60 sm:block" />

                <div className="hidden items-center gap-2 sm:flex">
                    <Badge tone={toneFromStatus(controller.session?.status)}>{controller.session?.status ?? 'idle'}</Badge>
                    <Badge
                        tone={
                            controller.appReadiness.token.status === 'missing' || controller.appReadiness.token.status === 'corrupted'
                                ? 'danger'
                                : 'success'
                        }
                    >
                        token {controller.appReadiness.token.label}
                    </Badge>
                    <Badge tone={controller.appReadiness.config.status === 'invalid' || controller.appReadiness.config.status === 'missing' ? 'warning' : 'success'}>
                        config {controller.appReadiness.config.status}
                    </Badge>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={async () => {
                    await controller.runDryRunCommand();
                    onSelectScreen('preview');
                }}>
                    <Shuffle className="mr-2 h-3.5 w-3.5" />
                    Dry Run
                </Button>
                <Button size="sm" variant="secondary" onClick={async () => {
                    await controller.runPreflightCommand();
                    onSelectScreen('session');
                }}>
                    <TimerReset className="mr-2 h-3.5 w-3.5" />
                    Preflight
                </Button>
                {controller.hasActiveSession ? (
                    <Button
                        size="sm"
                        variant="danger"
                        disabled={controller.session?.status === 'stopping'}
                        onClick={async () => {
                            await controller.stopCurrentSession();
                            onSelectScreen('session');
                        }}
                    >
                        <Square className="mr-2 h-3.5 w-3.5" />
                        {controller.session?.status === 'stopping' ? 'Stopping...' : 'Stop'}
                    </Button>
                ) : (
                    <Button
                        size="sm"
                        disabled={!controller.appReadiness.canStartSession}
                        onClick={async () => {
                            await controller.startSessionCommand();
                            onSelectScreen('session');
                        }}
                    >
                        <Play className="mr-2 h-3.5 w-3.5" />
                        {controller.senderState.resumeSession ? 'Resume' : 'Start'}
                    </Button>
                )}
            </div>
        </header>
    );
}
