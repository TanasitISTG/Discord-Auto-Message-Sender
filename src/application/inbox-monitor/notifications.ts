export interface InboxUser {
    id: string;
    username?: string;
    global_name?: string | null;
}

export interface InboxChannel {
    id: string;
    type?: number;
    recipients?: InboxUser[];
    name?: string | null;
    is_message_request?: boolean;
    is_message_request_timestamp?: string | null;
    message_request_timestamp?: string | null;
    spam?: boolean;
    is_spam?: boolean;
}

export interface InboxMessage {
    id: string;
    channel_id?: string;
    content?: string;
    timestamp?: string;
    author?: InboxUser;
}

export function buildChannelName(channel: InboxChannel): string {
    if (typeof channel.name === 'string' && channel.name.trim().length > 0) {
        return channel.name;
    }

    const recipients = channel.recipients ?? [];
    if (recipients.length === 0) {
        return channel.id;
    }

    return recipients
        .map((recipient) => recipient.global_name ?? recipient.username ?? recipient.id)
        .join(', ');
}

export function isMessageRequestChannel(channel: InboxChannel): boolean {
    return channel.is_message_request === true
        || typeof channel.is_message_request_timestamp === 'string'
        || typeof channel.message_request_timestamp === 'string'
        || channel.is_spam === true
        || channel.spam === true;
}

export function compareSnowflakes(left: string, right: string): number {
    try {
        const leftId = BigInt(left);
        const rightId = BigInt(right);
        if (leftId === rightId) {
            return 0;
        }
        return leftId > rightId ? 1 : -1;
    } catch {
        return left.localeCompare(right);
    }
}
