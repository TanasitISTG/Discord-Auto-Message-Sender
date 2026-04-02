import type { ConfirmDialogState } from '@/shared/desktop-confirm-dialog';

export type SurfaceNoticeScope = 'config' | 'session' | 'logs';
export type SurfaceNoticeTone = 'neutral' | 'success' | 'warning' | 'danger';
export type PreferredScreen = 'session' | 'preview' | null;

export interface SurfaceNotice {
    tone: SurfaceNoticeTone;
    message: string;
}

export interface RecoveryState {
    interruptedAt: string;
    message: string;
}

export interface ConfirmDialogRequest extends ConfirmDialogState {
    onConfirm: (() => Promise<void> | void) | null;
}

export const closedConfirmDialog: ConfirmDialogRequest = {
    open: false,
    title: '',
    description: '',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    pendingLabel: 'Working...',
    tone: 'danger',
    onConfirm: null
};
