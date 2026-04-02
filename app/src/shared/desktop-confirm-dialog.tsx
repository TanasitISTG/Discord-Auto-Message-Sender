import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export type ConfirmDialogTone = 'danger' | 'warning';

export interface ConfirmDialogState {
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    pendingLabel: string;
    tone: ConfirmDialogTone;
}

interface DesktopConfirmDialogProps {
    dialog: ConfirmDialogState;
    pending: boolean;
    onClose(): void;
    onConfirm(): void | Promise<void>;
}

export function DesktopConfirmDialog({ dialog, pending, onClose, onConfirm }: DesktopConfirmDialogProps) {
    return (
        <AlertDialog
            open={dialog.open}
            onOpenChange={(open) => {
                if (!open && !pending) {
                    onClose();
                }
            }}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
                    <AlertDialogDescription>{dialog.description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>{dialog.cancelLabel}</AlertDialogCancel>
                    <AlertDialogAction
                        className={
                            dialog.tone === 'warning'
                                ? 'border-amber-500/70 bg-amber-500/90 text-black hover:bg-amber-400'
                                : undefined
                        }
                        disabled={pending}
                        onClick={(event) => {
                            event.preventDefault();
                            void onConfirm();
                        }}
                    >
                        {pending ? dialog.pendingLabel : dialog.confirmLabel}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
