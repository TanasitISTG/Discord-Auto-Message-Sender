import { useState } from 'react';
import { showErrorToast } from '@/shared/toast';
import type { ConfirmDialogRequest } from './types';
import { closedConfirmDialog } from './types';

export function useConfirmationFlow() {
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogRequest>(closedConfirmDialog);
    const [confirmDialogPending, setConfirmDialogPending] = useState(false);

    function requestConfirmation(request: Omit<ConfirmDialogRequest, 'open'>) {
        setConfirmDialog({
            ...request,
            open: true
        });
    }

    function closeConfirmation() {
        if (confirmDialogPending) {
            return;
        }

        setConfirmDialog(closedConfirmDialog);
    }

    async function confirmCurrentDialog() {
        if (confirmDialogPending || !confirmDialog.open || !confirmDialog.onConfirm) {
            return;
        }

        setConfirmDialogPending(true);
        try {
            await confirmDialog.onConfirm();
            setConfirmDialog(closedConfirmDialog);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            showErrorToast(message);
        } finally {
            setConfirmDialogPending(false);
        }
    }

    return {
        confirmDialog,
        confirmDialogPending,
        requestConfirmation,
        closeConfirmation,
        confirmCurrentDialog
    };
}
