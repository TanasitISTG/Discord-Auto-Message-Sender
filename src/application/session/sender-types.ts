import type { AppChannel, MessageGroups } from '../../domain/config/types';
import type { AdaptivePacingState, ChannelProgressRecord } from '../../domain/session/types';
import type { StructuredLogger } from '../../utils/logger';

export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type SleepFn = (ms: number) => Promise<void>;
export type RandomFn = () => number;
export type NowFn = () => Date;

export const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export type SendOutcome =
    | { type: 'success' }
    | { type: 'wait'; waitSeconds: number }
    | { type: 'fatal'; reason: 'aborted' | 'unauthorized' | 'forbidden' | 'not_found' | 'exhausted' };

export interface SenderCoordinator {
    abort(reason: string): void;
    isAborted(): boolean;
    getAbortReason(): string | null;
    getAbortSignal(): AbortSignal;
    scheduleRequest<T>(sleep: SleepFn, task: () => Promise<T>): Promise<T>;
    recordRateLimit(waitSeconds: number): AdaptivePacingState;
    recordSuccess(): AdaptivePacingState;
    getPacingState(): AdaptivePacingState;
}

export interface SenderLifecycle {
    isPaused(): boolean;
    waitUntilResumed(sleep: SleepFn): Promise<boolean>;
    isStopping(): boolean;
    getStopReason(): string | null;
    onChannelEvent?(target: AppChannel, phase: 'started' | 'stopped' | 'completed' | 'failed'): void;
    onMessageSent?(
        target: AppChannel,
        details: {
            template: string;
            rendered: string;
            sentToday: number;
            sentTodayDayKey: string;
        },
    ): void;
    getRecentMessages?(target: AppChannel): string[];
    onRateLimit?(target: AppChannel, waitSeconds: number, consecutiveRateLimits: number): void;
    onChannelSuppressed?(
        target: AppChannel,
        details: { waitMs: number; suppressedUntil: string; reason: string },
    ): void;
    onChannelRecovered?(target: AppChannel): void;
    onChannelFailure?(target: AppChannel, reason: string): void;
}

export interface SenderDependencies {
    fetchImpl?: FetchImpl;
    sleep?: SleepFn;
    random?: RandomFn;
    now?: NowFn;
    logger?: StructuredLogger;
    coordinator?: SenderCoordinator;
    requestTimeoutMs?: number;
    lifecycle?: SenderLifecycle;
}

export interface RunChannelOptions extends SenderDependencies {
    target: AppChannel;
    numMessages: number;
    baseWaitSeconds: number;
    marginSeconds: number;
    token: string;
    userAgent: string;
    messageGroups: MessageGroups;
    maxRateLimitWaits?: number;
    resumeProgress?: ChannelProgressRecord;
}

export class SendAbortError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SendAbortError';
    }
}

export class RequestTimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`Request timed out after ${timeoutMs}ms`);
        this.name = 'RequestTimeoutError';
    }
}
