const MIN_SUPPRESSION_MS = 30000;
const MAX_SUPPRESSION_MS = 15 * 60 * 1000;

export function getBackoffDelayMs(attempt: number, random: () => number = Math.random): number {
    const baseDelay = 500 * Math.pow(2, attempt - 1);
    const jitter = Math.floor(random() * 250);
    return baseDelay + jitter;
}

export function getSuppressionDelayMs(waitSeconds: number, consecutiveRateLimits: number): number {
    const baseDelay = Math.ceil(waitSeconds * 1000 * Math.max(2, consecutiveRateLimits));
    return Math.min(MAX_SUPPRESSION_MS, Math.max(MIN_SUPPRESSION_MS, baseDelay));
}
