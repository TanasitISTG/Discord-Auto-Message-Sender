import test from 'node:test';
import assert from 'node:assert/strict';
import {
    addChannel,
    cloneMessageGroup,
    renameMessageGroup,
    reorderGroupMessages,
} from '../../src/domain/config-editor';
import { createDefaultAppConfig } from '../../src/config/schema';

test('config editor can add channels with a default referrer', () => {
    const config = addChannel(createDefaultAppConfig(), {
        name: 'general',
        id: '123456789012345678',
        messageGroup: 'default',
    });

    assert.equal(config.channels[0].referrer, 'https://discord.com/channels/@me/123456789012345678');
});

test('config editor can rename and clone message groups while preserving channel references', () => {
    const withChannel = addChannel(createDefaultAppConfig(), {
        name: 'general',
        id: '123456789012345678',
        messageGroup: 'default',
    });

    const renamed = renameMessageGroup(withChannel, 'default', 'announcements');
    const cloned = cloneMessageGroup(renamed, 'announcements', 'announcements-copy');

    assert.equal(cloned.channels[0].messageGroup, 'announcements');
    assert.deepEqual(cloned.messageGroups['announcements-copy'], cloned.messageGroups.announcements);
});

test('config editor can reorder messages inside a group', () => {
    const reordered = reorderGroupMessages(createDefaultAppConfig(), 'default', 0, 0);
    assert.deepEqual(reordered.messageGroups.default, ['Hello from your Discord bot!']);
});

test('config editor rejects out-of-range message reorder indices', () => {
    assert.throws(() => reorderGroupMessages(createDefaultAppConfig(), 'default', 0, 1), /Message index out of range/);
});
