import { Messages } from '../types';
import { ChannelTarget, sendMessage } from './client';
import { log } from '../utils/logger';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function startChannelWorker(
    target: ChannelTarget,
    numMessages: number,
    baseWait: number,
    margin: number,
    token: string,
    userAgent: string,
    allMessages: Messages
) {
    log(target.name, 'Started.', 'green', { group: target.messageGroup });

    const msgs = allMessages[target.messageGroup];

    if (!msgs || msgs.length === 0) {
        log(target.name, 'No messages found for configured group. Skipping channel.', 'red', { group: target.messageGroup });
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
            const result = await sendMessage(target, msg, token, userAgent);

            if (result.success) {
                const counter = numMessages === 0 ? 'Infinite' : `${sentCount + 1}/${numMessages}`;
                log(target.name, 'Message sent', 'cyan', { counter });
                break;
            } else if (result.wait) {
                log(target.name, `Rate Limit! Waiting ${result.wait}s...`, 'yellow');
                await sleep((result.wait + 0.5) * 1000);
            } else {
                log(target.name, 'Stopping worker after repeated or fatal send failures.', 'red');
                return;
            }
        }

        const waitTime = (baseWait + Math.random() * margin) * 1000;
        await sleep(waitTime);
        sentCount++;
    }
    log(target.name, 'Finished.', 'green');
}
