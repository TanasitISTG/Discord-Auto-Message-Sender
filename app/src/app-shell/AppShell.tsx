import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import type { DesktopController } from '@/controllers/desktop/use-desktop-controller';
import { DesktopConfirmDialog } from '@/shared/desktop-confirm-dialog';
import { describeBlockingIssue } from '@/shared/readiness';
import type { Screen } from '@/shared/screens';
import { AppHeader } from './AppHeader';
import { AppSidebar } from './AppSidebar';
import { ScreenRouter } from './ScreenRouter';

interface AppShellProps {
    controller: DesktopController;
}

export function AppShell({ controller }: AppShellProps) {
    const [screen, setScreen] = useState<Screen>('dashboard');

    useEffect(() => {
        if (controller.preferredScreen) {
            setScreen(controller.preferredScreen);
        }
    }, [controller.preferredScreen]);

    return (
        <div className="grid min-h-screen grid-cols-1 bg-background text-foreground lg:grid-cols-[240px_minmax(0,1fr)]">
            <AppSidebar controller={controller} screen={screen} onSelectScreen={setScreen} />

            <main className="flex flex-col">
                <AppHeader controller={controller} screen={screen} onSelectScreen={setScreen} />

                <div className="flex-1 p-5 lg:p-8">
                    {controller.appReadiness.blockingIssues.length > 0 || controller.sidecarMessage || controller.draft.validationErrors.length > 0 ? (
                        <div className="mb-6 flex flex-col gap-2">
                            {controller.appReadiness.blockingIssues.map((issue) => (
                                <div key={issue} className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                                    <span className="font-semibold uppercase tracking-widest text-amber-400">Readiness</span>
                                    <span>{describeBlockingIssue(issue)}</span>
                                </div>
                            ))}
                            {controller.sidecarMessage ? (
                                <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                                    <span className="font-semibold uppercase tracking-widest text-red-400">Runtime</span>
                                    <span>{controller.sidecarMessage}</span>
                                </div>
                            ) : null}
                            {controller.draft.validationErrors.length > 0 ? (
                                <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                                    <span className="font-semibold uppercase tracking-widest text-amber-400">Config</span>
                                    <span>{controller.draft.validationErrors.length} validation issue{controller.draft.validationErrors.length === 1 ? '' : 's'}</span>
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    <ScreenRouter controller={controller} screen={screen} onSelectScreen={setScreen} />
                </div>
            </main>

            <DesktopConfirmDialog
                dialog={controller.confirmDialog}
                pending={controller.confirmDialogPending}
                onClose={controller.closeConfirmation}
                onConfirm={controller.confirmCurrentDialog}
            />
            <Toaster
                position="top-right"
                richColors
                closeButton
                theme="dark"
                toastOptions={{
                    classNames: {
                        toast: 'border border-border/60 bg-card/95 text-foreground shadow-[0_18px_48px_rgba(0,0,0,0.4)]',
                        title: 'text-sm font-medium',
                        description: 'text-xs text-muted-foreground'
                    }
                }}
            />
        </div>
    );
}
