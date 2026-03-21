import test from 'node:test';
import assert from 'node:assert/strict';
import { createDryRun } from '../../src/services/dry-run';
import { createDefaultAppConfig } from '../../src/config/schema';
import { addChannel } from '../../src/services/config-editor';

test('dry run reports sendable channels and sample messages', () => {
    const config = addChannel(createDefaultAppConfig(), {
        name: 'general',
        id: '123456789012345678',
        messageGroup: 'default'
    });

    const result = createDryRun(config, {
        numMessages: 2,
        baseWaitSeconds: 5,
        marginSeconds: 2
    });

    assert.equal(result.willSendMessages, true);
    assert.equal(result.summary.selectedChannels, 1);
    assert.deepEqual(result.channels[0].sampleMessages, ['Hello from your Discord bot!']);
});

test('dry run marks channels with missing groups as skipped', () => {
    const base = createDefaultAppConfig();
    const config = {
        ...base,
        channels: [
            {
                name: 'broken',
                id: '123456789012345678',
                referrer: 'https://discord.com/channels/@me/123456789012345678',
                messageGroup: 'missing'
            }
        ]
    };

    const result = createDryRun(config, {
        numMessages: 1,
        baseWaitSeconds: 5,
        marginSeconds: 2
    });

    assert.equal(result.willSendMessages, false);
    assert.match(result.channels[0].skipReasons[0], /no messages/i);
});
