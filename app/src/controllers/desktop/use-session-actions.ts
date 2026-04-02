import { createSessionLifecycleActions } from './session-lifecycle-actions';
import { createSessionLogActions } from './session-log-actions';
import type { SessionActionOptions } from './session-action-types';

export function useSessionActions(options: SessionActionOptions) {
    return {
        ...createSessionLifecycleActions(options),
        ...createSessionLogActions(options)
    };
}
