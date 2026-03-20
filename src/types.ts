export interface Channel {
    name: string;
    id: string;
    referrer?: string;
    message_group?: string;
}

export interface Config {
    user_agent: string;
    channels: Channel[];
}

export interface Messages {
    [group: string]: string[];
}

export interface RuntimeOptions {
    numMessages: number;
    baseWaitSeconds: number;
    marginSeconds: number;
}
