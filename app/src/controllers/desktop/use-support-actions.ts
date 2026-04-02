import { createSupportNotificationActions } from './support-notification-actions';
import { createSupportRuntimeActions } from './support-runtime-actions';
import type { SupportActionOptions } from './support-action-types';

export function useSupportActions(options: SupportActionOptions) {
    return {
        ...createSupportNotificationActions(options),
        ...createSupportRuntimeActions(options)
    };
}
