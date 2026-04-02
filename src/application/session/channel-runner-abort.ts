import type { AppChannel } from '../../domain/config/types';
import { emitLog, type StructuredLogger } from '../../utils/logger';
import { sleepWithAbort } from './pacing-coordinator';
import type { SenderCoordinator, SenderLifecycle, SleepFn } from './sender-types';

interface AbortContext {
    target: AppChannel;
    logger: StructuredLogger;
    coordinator?: SenderCoordinator;
    lifecycle?: SenderLifecycle;
}

export function getAbortReason(coordinator?: SenderCoordinator, lifecycle?: SenderLifecycle) {
    return (
        coordinator?.getAbortReason() ??
        lifecycle?.getStopReason() ??
        'Stopping worker because sending was aborted globally.'
    );
}

export function abortChannelRun({ target, logger, coordinator, lifecycle }: AbortContext) {
    emitLog(logger, target.name, getAbortReason(coordinator, lifecycle), 'yellow');
    if (!lifecycle?.isStopping()) {
        lifecycle?.onChannelFailure?.(target, coordinator?.getAbortReason() ?? 'aborted');
    }
    lifecycle?.onChannelEvent?.(target, lifecycle?.isStopping() ? 'stopped' : 'failed');
}

export async function waitForChannel(waitMs: number, sleep: SleepFn, context: AbortContext) {
    const completed = await sleepWithAbort(waitMs, sleep, context.coordinator, context.lifecycle);
    if (completed) {
        return true;
    }

    abortChannelRun(context);
    return false;
}
