import fs from 'fs';
import { Config, Messages } from '../types';
import { log } from '../utils/logger';

export const CONFIG_FILE = 'config.json';
export const MESSAGES_FILE = 'messages.json';

export function loadConfig(): Config | null {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } catch (e) {
        log('System', `Error loading config: ${e}`, 'red');
        return null;
    }
}

export function saveConfig(cfg: Config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 4));
}

export function loadMessages(): Messages {
    if (!fs.existsSync(MESSAGES_FILE)) {
        const defaultMsgs = { "default": ["Hello from Node.js Bot!"] };
        try {
            fs.writeFileSync(MESSAGES_FILE, JSON.stringify(defaultMsgs, null, 4));
            return defaultMsgs;
        } catch (e) {
            return {};
        }
    }
    try {
        const data = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'));
        if (Array.isArray(data)) return { "default": data };
        return data;
    } catch (e) {
        log('System', `Error loading messages: ${e}`, 'red');
        return {};
    }
}

export function saveMessages(msgs: Messages) {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(msgs, null, 4));
}
