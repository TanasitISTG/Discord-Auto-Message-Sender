import { Channel, Config, Messages } from '../types';
import { sendMessage } from './client';
import { log } from '../utils/logger';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function startChannelWorker(
    channel: Channel,
    numMessages: number,
    baseWait: number,
    margin: number,
    config: Config,
    allMessages: Messages
) {
    log(channel.name, 'Started.', 'green');

    const group = channel.message_group || 'default';
    const msgs = allMessages[group] || allMessages['default'];

    if (!msgs || msgs.length === 0) {
        log(channel.name, `No messages found for group '${group}'. Skipping.`, 'red');
        return;
    }

    let sentCount = 0;
    const sentCache = new Set<string>();

    while (numMessages === 0 || sentCount < numMessages) {
        if (sentCache.size >= msgs.length) sentCache.clear();

        let msg = '';
        while (true) {
            msg = msgs[Math.floor(Math.random() * msgs.length)];
            if (!sentCache.has(msg)) {
                sentCache.add(msg);
                break;
            }
        }

        while (true) {
            const result = await sendMessage(channel, msg, config);

            if (result.success) {
                const counter = numMessages === 0 ? `Infinite` : `${sentCount + 1}/${numMessages}`;
                log(channel.name, `Message Sent (${counter})`, 'cyan');
                break;
            } else if (result.wait) {
                log(channel.name, `Rate Limit! Waiting ${result.wait}s...`, 'yellow');
                await sleep((result.wait + 0.5) * 1000);
            } else {
                break; // Fatal error, skip message
            }
        }

        const waitTime = (baseWait + Math.random() * margin) * 1000;
        await sleep(waitTime);
        sentCount++;
    }
    log(channel.name, 'Finished.', 'green');
}
