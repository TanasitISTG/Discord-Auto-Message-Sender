import { getChannelDayKey, getQuietHoursDelayMs } from '../../domain/session/quiet-hours';
import { pickNextMessage } from '../../domain/session/message-selection';
import { getSuppressionDelayMs } from '../../domain/session/suppression';
import { renderMessageTemplate } from '../../infrastructure/templates/render-message-template';
import { sendDiscordMessage } from '../../infrastructure/discord/send-discord-message';
import { defaultLogger, emitLog } from '../../utils/logger';
import { sleepWithAbort } from './pacing-coordinator';
import { defaultSleep, type RunChannelOptions } from './sender-types';

const DEFAULT_MAX_RATE_LIMIT_WAITS = 10;

export async function runChannel(options: RunChannelOptions): Promise<void> {
    const {
        target,
        numMessages,
        baseWaitSeconds,
        marginSeconds,
        token,
        userAgent,
        messageGroups,
        fetchImpl,
        sleep = defaultSleep,
        random = Math.random,
        now = () => new Date(),
        logger = defaultLogger,
        coordinator,
        requestTimeoutMs,
        maxRateLimitWaits = DEFAULT_MAX_RATE_LIMIT_WAITS,
        lifecycle,
        resumeProgress
    } = options;

    const exitForAbort = () => {
        const phase = lifecycle?.isStopping() ? 'stopped' : 'failed';
        lifecycle?.onChannelEvent?.(target, phase);
    };

    if (coordinator?.isAborted() || lifecycle?.isStopping()) {
        emitLog(logger, target.name, coordinator?.getAbortReason() ?? lifecycle?.getStopReason() ?? 'Stopping worker because sending was aborted globally.', 'yellow');
        if (!lifecycle?.isStopping()) {
            lifecycle?.onChannelFailure?.(target, coordinator?.getAbortReason() ?? 'aborted');
            exitForAbort();
        }
        return;
    }

    emitLog(logger, target.name, 'Started.', 'green', {
        channelId: target.id,
        event: 'channel_started',
        group: target.messageGroup
    });
    lifecycle?.onChannelEvent?.(target, 'started');

    const messages = messageGroups[target.messageGroup];
    if (!messages || messages.length === 0) {
        emitLog(logger, target.name, 'No messages found for configured group. Skipping channel.', 'red', {
            channelId: target.id,
            event: 'channel_missing_messages',
            group: target.messageGroup
        });
        lifecycle?.onChannelFailure?.(target, 'missing_messages');
        lifecycle?.onChannelEvent?.(target, 'failed');
        return;
    }

    let sentCount = resumeProgress?.sentMessages ?? 0;
    const sentCache = new Set<string>();
    let consecutiveRateLimitWaits = resumeProgress?.consecutiveRateLimits ?? 0;
    let sentToday = resumeProgress?.sentToday ?? 0;
    let sentTodayDayKey = resumeProgress?.sentTodayDayKey;
    if (!sentTodayDayKey && resumeProgress?.lastSentAt) {
        sentTodayDayKey = getChannelDayKey(target, new Date(resumeProgress.lastSentAt));
    }
    const maxSendsPerDay = target.schedule?.maxSendsPerDay ?? null;
    const intervalSeconds = target.schedule?.intervalSeconds ?? baseWaitSeconds;
    const marginForChannel = target.schedule?.randomMarginSeconds ?? marginSeconds;
    const cooldownWindowSize = target.schedule?.cooldownWindowSize ?? 3;
    let recoveringFromSuppression = resumeProgress?.status === 'suppressed';

    if (resumeProgress?.status === 'suppressed' && resumeProgress.suppressedUntil) {
        const resumeAt = Date.parse(resumeProgress.suppressedUntil);
        if (Number.isFinite(resumeAt)) {
            const remainingSuppressionMs = Math.max(0, resumeAt - now().getTime());
            if (remainingSuppressionMs > 0) {
                emitLog(logger, target.name, `Resuming from saved suppression. Waiting ${Math.ceil(remainingSuppressionMs / 1000)}s before retrying.`, 'yellow', {
                    channelId: target.id,
                    event: 'resume_suppression_wait',
                    suppressedUntil: resumeProgress.suppressedUntil
                });
                const completedSavedWait = await sleepWithAbort(remainingSuppressionMs, sleep, coordinator, lifecycle);
                if (!completedSavedWait) {
                    emitLog(logger, target.name, coordinator?.getAbortReason() ?? lifecycle?.getStopReason() ?? 'Stopping worker because sending was aborted globally.', 'yellow');
                    if (!lifecycle?.isStopping()) {
                        lifecycle?.onChannelFailure?.(target, coordinator?.getAbortReason() ?? 'aborted');
                    }
                    exitForAbort();
                    return;
                }
            }
        }
    }

    while (numMessages === 0 || sentCount < numMessages) {
        const currentDayKey = getChannelDayKey(target, now());
        if (sentTodayDayKey !== currentDayKey) {
            sentToday = 0;
            sentTodayDayKey = currentDayKey;
            if (resumeProgress) {
                resumeProgress.sentToday = 0;
                resumeProgress.sentTodayDayKey = currentDayKey;
            }
        }

        if (coordinator?.isAborted() || lifecycle?.isStopping()) {
            emitLog(logger, target.name, coordinator?.getAbortReason() ?? lifecycle?.getStopReason() ?? 'Stopping worker because sending was aborted globally.', 'yellow');
            if (!lifecycle?.isStopping()) {
                lifecycle?.onChannelFailure?.(target, coordinator?.getAbortReason() ?? 'aborted');
            }
            exitForAbort();
            return;
        }

        if (maxSendsPerDay !== null && sentToday >= maxSendsPerDay) {
            emitLog(logger, target.name, `Max sends per day reached (${maxSendsPerDay}). Stopping worker.`, 'yellow', {
                channelId: target.id,
                event: 'channel_daily_cap'
            });
            lifecycle?.onChannelEvent?.(target, 'completed');
            return;
        }

        const quietHoursDelayMs = getQuietHoursDelayMs(target, now());
        if (quietHoursDelayMs > 0) {
            emitLog(logger, target.name, `Inside quiet hours. Waiting ${Math.ceil(quietHoursDelayMs / 60000)} minute(s) before the next send.`, 'yellow', {
                channelId: target.id,
                event: 'quiet_hours_wait',
                waitMinutes: Math.ceil(quietHoursDelayMs / 60000)
            });
            const completedQuietWait = await sleepWithAbort(quietHoursDelayMs, sleep, coordinator, lifecycle);
            if (!completedQuietWait) {
                emitLog(logger, target.name, coordinator?.getAbortReason() ?? lifecycle?.getStopReason() ?? 'Stopping worker because sending was aborted globally.', 'yellow');
                if (!lifecycle?.isStopping()) {
                    lifecycle?.onChannelFailure?.(target, coordinator?.getAbortReason() ?? 'aborted');
                }
                exitForAbort();
                return;
            }
            continue;
        }

        const rawMessage = pickNextMessage(
            messages,
            sentCache,
            random,
            (lifecycle?.getRecentMessages?.(target) ?? []).slice(-cooldownWindowSize)
        );
        const message = renderMessageTemplate(rawMessage, { channel: target });

        while (true) {
            const result = await sendDiscordMessage(target, message, token, userAgent, {
                fetchImpl,
                sleep,
                random,
                coordinator,
                requestTimeoutMs,
                logger,
                lifecycle
            });

            if (result.type === 'success') {
                const dayKeyAtSend = getChannelDayKey(target, now());
                if (sentTodayDayKey !== dayKeyAtSend) {
                    sentToday = 0;
                    sentTodayDayKey = dayKeyAtSend;
                }
                consecutiveRateLimitWaits = 0;
                sentCount += 1;
                sentToday += 1;
                sentTodayDayKey = dayKeyAtSend;
                if (resumeProgress) {
                    resumeProgress.sentToday = sentToday;
                    resumeProgress.sentTodayDayKey = sentTodayDayKey;
                }
                const counter = numMessages === 0 ? 'Infinite' : `${sentCount}/${numMessages}`;
                emitLog(logger, target.name, 'Message sent', 'cyan', {
                    channelId: target.id,
                    event: 'message_sent',
                    counter,
                    pacingMs: coordinator?.getPacingState().currentRequestIntervalMs
                });
                if (recoveringFromSuppression) {
                    lifecycle?.onChannelRecovered?.(target);
                    recoveringFromSuppression = false;
                }
                lifecycle?.onMessageSent?.(target, {
                    template: rawMessage,
                    rendered: message,
                    sentToday,
                    sentTodayDayKey
                });
                break;
            }

            if (result.type === 'wait') {
                consecutiveRateLimitWaits += 1;
                lifecycle?.onRateLimit?.(target, result.waitSeconds, consecutiveRateLimitWaits);
                if (consecutiveRateLimitWaits > maxRateLimitWaits) {
                    const suppressionMs = getSuppressionDelayMs(result.waitSeconds, consecutiveRateLimitWaits);
                    const suppressedUntil = new Date(now().getTime() + suppressionMs).toISOString();
                    emitLog(logger, target.name, `Suppressing channel for ${Math.ceil(suppressionMs / 1000)}s after ${consecutiveRateLimitWaits} consecutive rate limits.`, 'yellow', {
                        channelId: target.id,
                        event: 'channel_suppressed',
                        consecutiveRateLimits: consecutiveRateLimitWaits,
                        suppressedUntil
                    });
                    lifecycle?.onChannelSuppressed?.(target, {
                        waitMs: suppressionMs,
                        suppressedUntil,
                        reason: `Suppressed after ${consecutiveRateLimitWaits} consecutive rate limits.`
                    });
                    const completedSuppressionWait = await sleepWithAbort(suppressionMs, sleep, coordinator, lifecycle);
                    if (!completedSuppressionWait) {
                        emitLog(logger, target.name, coordinator?.getAbortReason() ?? lifecycle?.getStopReason() ?? 'Stopping worker because sending was aborted globally.', 'yellow');
                        if (!lifecycle?.isStopping()) {
                            lifecycle?.onChannelFailure?.(target, coordinator?.getAbortReason() ?? 'aborted');
                        }
                        exitForAbort();
                        return;
                    }
                    consecutiveRateLimitWaits = 0;
                    recoveringFromSuppression = true;
                    continue;
                }

                emitLog(logger, target.name, `Rate Limit! Waiting ${result.waitSeconds}s...`, 'yellow', {
                    channelId: target.id,
                    event: 'rate_limit_wait',
                    consecutiveRateLimits: consecutiveRateLimitWaits
                });
                const completedWait = await sleepWithAbort((result.waitSeconds + 0.5) * 1000, sleep, coordinator, lifecycle);
                if (!completedWait) {
                    emitLog(logger, target.name, coordinator?.getAbortReason() ?? lifecycle?.getStopReason() ?? 'Stopping worker because sending was aborted globally.', 'yellow');
                    if (!lifecycle?.isStopping()) {
                        lifecycle?.onChannelFailure?.(target, coordinator?.getAbortReason() ?? 'aborted');
                    }
                    exitForAbort();
                    return;
                }
                continue;
            }

            if (result.reason === 'aborted') {
                emitLog(logger, target.name, coordinator?.getAbortReason() ?? lifecycle?.getStopReason() ?? 'Stopping worker because sending was aborted globally.', 'yellow');
                if (!lifecycle?.isStopping()) {
                    lifecycle?.onChannelFailure?.(target, coordinator?.getAbortReason() ?? 'aborted');
                }
                exitForAbort();
                return;
            }

            if (result.reason === 'unauthorized') {
                emitLog(logger, target.name, 'Stopping all workers after HTTP 401 indicated an invalid or expired token.', 'red', {
                    channelId: target.id,
                    event: 'channel_failed',
                    reason: 'unauthorized'
                });
                lifecycle?.onChannelFailure?.(target, 'unauthorized');
                lifecycle?.onChannelEvent?.(target, 'failed');
                return;
            }

            emitLog(logger, target.name, 'Stopping worker after repeated or fatal send failures.', 'red', {
                channelId: target.id,
                event: 'channel_failed',
                reason: result.reason
            });
            lifecycle?.onChannelFailure?.(target, result.reason);
            lifecycle?.onChannelEvent?.(target, 'failed');
            return;
        }

        if (numMessages !== 0 && sentCount >= numMessages) {
            break;
        }

        const waitMs = (intervalSeconds + random() * marginForChannel) * 1000;
        const completedWait = await sleepWithAbort(waitMs, sleep, coordinator, lifecycle);
        if (!completedWait) {
            emitLog(logger, target.name, coordinator?.getAbortReason() ?? lifecycle?.getStopReason() ?? 'Stopping worker because sending was aborted globally.', 'yellow');
            if (!lifecycle?.isStopping()) {
                lifecycle?.onChannelFailure?.(target, coordinator?.getAbortReason() ?? 'aborted');
            }
            exitForAbort();
            return;
        }
    }

    emitLog(logger, target.name, 'Finished.', 'green', {
        channelId: target.id,
        event: 'channel_completed',
        sentMessages: sentCount
    });
    lifecycle?.onChannelEvent?.(target, 'completed');
}
