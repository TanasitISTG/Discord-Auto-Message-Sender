import { AppChannel } from '../types';

export interface TemplateRenderContext {
    channel: AppChannel;
    now?: Date;
}

function formatTime(date: Date): string {
    return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });
}

export function renderMessageTemplate(message: string, context: TemplateRenderContext): string {
    const now = context.now ?? new Date();

    return message
        .replace(/\{date\}/g, now.toLocaleDateString())
        .replace(/\{time\}/g, formatTime(now))
        .replace(/\{channel\}/g, context.channel.name);
}
