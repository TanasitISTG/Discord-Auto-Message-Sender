import { Messages } from '../types';
import { ResolvedChannelTarget, sendMessage } from './client';
import { log } from '../utils/logger';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function startChannelWorker(
    target: ResolvedChannelTarget,
    numMessages: number,
    baseWait: number,
    margin: number,
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

        const result = await sendMessage(target, msg);

        if (!result.success) {
            log(target.name, 'Stopping worker after repeated or fatal send failures.', 'red');
            return;
        }

        const counter = numMessages === 0 ? 'Infinite' : `${sentCount + 1}/${numMessages}`;
        log(target.name, 'Message sent', 'cyan', { counter });

        const waitTime = (baseWait + Math.random() * margin) * 1000;
        await sleep(waitTime);
        sentCount++;
    }
    log(target.name, 'Finished.', 'green');
}
