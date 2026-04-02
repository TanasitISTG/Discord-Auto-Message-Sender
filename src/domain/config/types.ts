export interface AppChannel {
    name: string;
    id: string;
    referrer: string;
    messageGroup: string;
    schedule?: ChannelSchedule;
}

export interface ChannelQuietHours {
    start: string;
    end: string;
}

export interface ChannelSchedule {
    intervalSeconds: number;
    randomMarginSeconds: number;
    quietHours?: ChannelQuietHours | null;
    timezone?: string | null;
    maxSendsPerDay?: number | null;
    cooldownWindowSize?: number;
}

export type MessageGroups = Record<string, string[]>;

export interface AppConfig {
    userAgent: string;
    channels: AppChannel[];
    messageGroups: MessageGroups;
}

export interface LegacyChannel {
    name: string;
    id: string;
    referrer?: string;
    message_group?: string;
}

export interface LegacyConfig {
    user_agent: string;
    channels: LegacyChannel[];
}

export type LegacyMessages = MessageGroups;

export interface RuntimeOptions {
    numMessages: number;
    baseWaitSeconds: number;
    marginSeconds: number;
}

export interface EnvironmentConfig {
    DISCORD_TOKEN: string;
}

export interface ConfigPaths {
    configFile: string;
    messagesFile: string;
}
