import { toast } from 'sonner';

export function showSuccessToast(message: string) {
    toast.success(message, { duration: 3000 });
}

export function showWarningToast(message: string) {
    toast.warning(message, { duration: 4500 });
}

export function showErrorToast(message: string) {
    toast.error(message, { duration: 4500 });
}

export function showInfoToast(message: string) {
    toast(message, { duration: 3000 });
}
