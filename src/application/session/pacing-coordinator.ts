import type { AdaptivePacingState } from '../../domain/session/types';
import type { SenderCoordinator, SenderLifecycle, SleepFn } from './sender-types';
import { SendAbortError } from './sender-types';

const DEFAULT_GLOBAL_REQUEST_INTERVAL_MS = 250;
const DEFAULT_MAX_REQUEST_INTERVAL_MS = 5000;
const ABORT_POLL_INTERVAL_MS = 250;

export async function sleepWithAbort(
    ms: number,
    sleep: SleepFn,
    coordinator?: SenderCoordinator,
    lifecycle?: SenderLifecycle
): Promise<boolean> {
    if (!coordinator && !lifecycle) {
        await sleep(ms);
        return true;
    }

    let remainingMs = ms;
    while (remainingMs > 0) {
        if (coordinator?.isAborted()) {
            return false;
        }

        if (lifecycle?.isStopping()) {
            return false;
        }

        if (lifecycle?.isPaused()) {
            const resumed = await lifecycle.waitUntilResumed(sleep);
            if (!resumed) {
                return false;
            }
            continue;
        }

        const chunkMs = Math.min(remainingMs, ABORT_POLL_INTERVAL_MS);
        await sleep(chunkMs);
        remainingMs -= chunkMs;
    }

    return !(coordinator?.isAborted() ?? false) && !(lifecycle?.isStopping() ?? false);
}

export function createSenderCoordinator(
    minRequestIntervalMs: number = DEFAULT_GLOBAL_REQUEST_INTERVAL_MS,
    initialState?: Partial<AdaptivePacingState>
): SenderCoordinator {
    let abortedReason: string | null = null;
    const abortController = new AbortController();
    let nextRequestAt = 0;
    let requestQueue = Promise.resolve();
    const pacingState: AdaptivePacingState = {
        baseRequestIntervalMs: minRequestIntervalMs,
        currentRequestIntervalMs: Math.max(minRequestIntervalMs, initialState?.currentRequestIntervalMs ?? minRequestIntervalMs),
        maxRequestIntervalMs: Math.max(minRequestIntervalMs, initialState?.maxRequestIntervalMs ?? minRequestIntervalMs),
        penaltyLevel: initialState?.penaltyLevel ?? 0,
        recentRateLimitCount: initialState?.recentRateLimitCount ?? 0,
        lastRateLimitAt: initialState?.lastRateLimitAt,
        lastRecoveryAt: initialState?.lastRecoveryAt
    };

    const coordinator: SenderCoordinator = {
        abort(reason: string) {
            if (!abortedReason) {
                abortedReason = reason;
                abortController.abort(reason);
            }
        },
        isAborted() {
            return abortedReason !== null;
        },
        getAbortReason() {
            return abortedReason;
        },
        getAbortSignal() {
            return abortController.signal;
        },
        recordRateLimit(waitSeconds: number) {
            const penaltyBoost = Math.max(250, Math.ceil(waitSeconds * 250));
            pacingState.penaltyLevel += 1;
            pacingState.recentRateLimitCount += 1;
            pacingState.currentRequestIntervalMs = Math.min(
                DEFAULT_MAX_REQUEST_INTERVAL_MS,
                Math.max(
                    pacingState.baseRequestIntervalMs + (pacingState.penaltyLevel * 125),
                    pacingState.currentRequestIntervalMs + penaltyBoost
                )
            );
            pacingState.maxRequestIntervalMs = Math.max(pacingState.maxRequestIntervalMs, pacingState.currentRequestIntervalMs);
            pacingState.lastRateLimitAt = new Date().toISOString();
            return { ...pacingState };
        },
        recordSuccess() {
            if (pacingState.currentRequestIntervalMs > pacingState.baseRequestIntervalMs) {
                const decayStep = Math.max(125, Math.ceil((pacingState.currentRequestIntervalMs - pacingState.baseRequestIntervalMs) / 2));
                pacingState.currentRequestIntervalMs = Math.max(
                    pacingState.baseRequestIntervalMs,
                    pacingState.currentRequestIntervalMs - decayStep
                );
                pacingState.lastRecoveryAt = new Date().toISOString();
            }
            pacingState.penaltyLevel = Math.max(0, pacingState.penaltyLevel - 1);
            return { ...pacingState };
        },
        getPacingState() {
            return { ...pacingState };
        },
        async scheduleRequest<T>(sleep: SleepFn, task: () => Promise<T>): Promise<T> {
            let releaseQueue: (() => void) | undefined;
            const previousRequest = requestQueue;
            requestQueue = new Promise<void>((resolve) => {
                releaseQueue = resolve;
            });
            let startedRequest = false;

            await previousRequest;

            try {
                if (abortedReason) {
                    throw new SendAbortError(abortedReason);
                }

                const waitMs = Math.max(0, nextRequestAt - Date.now());
                if (waitMs > 0) {
                    const completedWait = await sleepWithAbort(waitMs, sleep, coordinator);
                    if (!completedWait) {
                        throw new SendAbortError(abortedReason ?? 'Sending was aborted.');
                    }
                }

                if (abortedReason) {
                    throw new SendAbortError(abortedReason);
                }

                startedRequest = true;
                return await task();
            } finally {
                if (startedRequest) {
                    nextRequestAt = Date.now() + pacingState.currentRequestIntervalMs;
                }
                releaseQueue?.();
            }
        }
    };

    return coordinator;
}
