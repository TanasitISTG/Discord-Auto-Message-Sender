export interface Channel {
    name: string;
    id: string;
    referrer: string;
    message_group?: string;
}

export interface Config {
    user_agent: string;
    discord_token: string;
    channels: Channel[];
}

export interface Messages {
    [group: string]: string[];
}
