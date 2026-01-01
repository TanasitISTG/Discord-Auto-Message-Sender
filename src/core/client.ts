import axios from 'axios';
import { Channel, Config } from '../types';
import { log } from '../utils/logger';

const API_BASE = 'https://discord.com/api/v10';

export async function sendMessage(channel: Channel, content: string, config: Config): Promise<{ success: boolean; wait?: number }> {
    try {
        await axios.post(
            `${API_BASE}/channels/${channel.id}/messages`,
            { content, tts: false },
            {
                headers: {
                    'Authorization': config.discord_token,
                    'User-Agent': config.user_agent,
                    'Content-Type': 'application/json',
                    'Referer': channel.referrer
                }
            }
        );
        return { success: true };
    } catch (error: any) {
        if (axios.isAxiosError(error) && error.response) {
            if (error.response.status === 429) {
                const retryAfter = error.response.data.retry_after || 5;
                return { success: false, wait: retryAfter };
            }
            log(channel.name, `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`, 'red');
        } else {
            log(channel.name, `Error: ${error.message}`, 'red');
        }
        return { success: false };
    }
}
