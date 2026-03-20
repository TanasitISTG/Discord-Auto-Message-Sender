export interface Channel {
    name: string;
    id: string;
    message_group?: string;
}

export interface Config {
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
