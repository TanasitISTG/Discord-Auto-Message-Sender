import { Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { DesktopController } from '@/controllers/desktop/use-desktop-controller';
import { navigation, type Screen } from '@/shared/screens';

interface AppSidebarProps {
    screen: Screen;
    controller: DesktopController;
    onSelectScreen(screen: Screen): void;
}

export function AppSidebar({ screen, controller, onSelectScreen }: AppSidebarProps) {
    return (
        <aside className="static flex flex-col border-r border-border bg-background lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
            <div className="p-5 pb-6">
                <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-foreground">
                    <Send className="h-4 w-4" />
                    <span>Desktop Sender</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    GUI-first local control plane for Discord messaging.
                </p>
            </div>

            <nav className="flex-1 space-y-1.5 px-3">
                {navigation.map((item) => {
                    const Icon = item.icon;
                    const isActive = screen === item.id;
                    return (
                        <button
                            key={item.id}
                            className={`relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                                isActive
                                    ? 'bg-zinc-800 text-foreground'
                                    : 'text-muted-foreground hover:bg-zinc-900 hover:text-foreground'
                            }`}
                            onClick={() => onSelectScreen(item.id)}
                        >
                            {isActive ? (
                                <div className="absolute inset-y-1/4 left-0 w-1 rounded-r-full bg-foreground" />
                            ) : null}
                            <Icon className="h-4 w-4" />
                            {item.label}
                        </button>
                    );
                })}
            </nav>

            <div className="border-t border-border p-4">
                <div className="flex flex-col gap-2.5">
                    {controller.releaseDiagnostics ? (
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Version</span>
                            <span className="font-mono text-[11px]">
                                v{controller.releaseDiagnostics.appVersion} beta
                            </span>
                        </div>
                    ) : null}
                    {controller.session?.id ? (
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Session ID</span>
                            <span className="ml-2 truncate font-mono text-[11px]">
                                {controller.session.id.split('-')[0]}
                            </span>
                        </div>
                    ) : null}
                    {!controller.setupChecklist.complete ? (
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Setup tasks</span>
                            <Badge tone="warning" className="px-1.5 py-0 text-[9px]">
                                {controller.setupChecklist.completedCount}/{controller.setupChecklist.totalCount}
                            </Badge>
                        </div>
                    ) : null}
                    <div className="mt-1 flex items-center justify-between border-t border-border pt-3">
                        <span className="text-xs text-muted-foreground">Sidecar runtime</span>
                        <div className="flex items-center gap-2">
                            {controller.sidecarStatus === 'ready' ? (
                                <span className="relative flex h-2 w-2">
                                    <span className="absolute inline-flex h-full w-full animate-pulse-slow rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                                </span>
                            ) : (
                                <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                            )}
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground/90">
                                {controller.sidecarStatus}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </aside>
    );
}
