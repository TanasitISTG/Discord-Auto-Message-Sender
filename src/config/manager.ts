import fs from 'fs';
import { Config, Messages } from '../types';
import { parseConfig, parseMessages } from './schema';
import { log } from '../utils/logger';

export const CONFIG_FILE = 'config.json';
export const MESSAGES_FILE = 'messages.json';
const DEFAULT_MESSAGES: Messages = { default: ['Hello from your Discord bot!'] };

export function loadConfig(): Config | null {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    try {
        return parseConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')));
    } catch (e) {
        log('System', `Error loading config: ${e}`, 'red');
        return null;
    }
}

export function saveConfig(cfg: Config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(parseConfig(cfg), null, 4));
}

export function loadMessages(): Messages {
    if (!fs.existsSync(MESSAGES_FILE)) {
        const defaultMsgs = DEFAULT_MESSAGES;
        try {
            fs.writeFileSync(MESSAGES_FILE, JSON.stringify(defaultMsgs, null, 4));
            return defaultMsgs;
        } catch (e) {
            return {};
        }
    }
    try {
        const data = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'));
        return parseMessages(Array.isArray(data) ? { default: data } : data);
    } catch (e) {
        log('System', `Error loading messages: ${e}`, 'red');
        return {};
    }
}

export function saveMessages(msgs: Messages) {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(parseMessages(msgs), null, 4));
}
