import { AppConfig, DryRunChannelPreview, DryRunResult, RuntimeOptions } from '../types';
import { renderMessageTemplate } from './message-template';

function buildChannelPreview(config: AppConfig, runtime: RuntimeOptions): DryRunChannelPreview[] {
    return config.channels.map((channel) => {
        const groupMessages = config.messageGroups[channel.messageGroup] ?? [];
        const skipReasons: string[] = [];

        if (groupMessages.length === 0) {
            skipReasons.push('Configured message group has no messages.');
        }

        return {
            channelId: channel.id,
            channelName: channel.name,
            groupName: channel.messageGroup,
            enabled: skipReasons.length === 0,
            sampleMessages: groupMessages
                .slice(0, Math.max(1, Math.min(runtime.numMessages || 3, 3)))
                .map((message) => renderMessageTemplate(message, { channel })),
            cadence: {
                numMessages: runtime.numMessages,
                baseWaitSeconds: channel.schedule?.intervalSeconds ?? runtime.baseWaitSeconds,
                marginSeconds: channel.schedule?.randomMarginSeconds ?? runtime.marginSeconds
            },
            skipReasons
        };
    });
}

export function createDryRun(config: AppConfig, runtime: RuntimeOptions): DryRunResult {
    const channels = buildChannelPreview(config, runtime);
    const skippedChannels = channels.filter((channel) => channel.skipReasons.length > 0).length;
    const totalSampleMessages = channels.reduce((total, channel) => total + channel.sampleMessages.length, 0);

    return {
        generatedAt: new Date().toISOString(),
        willSendMessages: channels.some((channel) => channel.skipReasons.length === 0),
        channels,
        summary: {
            selectedChannels: channels.length,
            skippedChannels,
            totalSampleMessages
        }
    };
}
