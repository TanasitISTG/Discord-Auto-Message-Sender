import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMessageTemplate } from '../../src/services/message-template';

test('renderMessageTemplate resolves built-in placeholders', () => {
    const result = renderMessageTemplate('Hi {channel} at {time} on {date}', {
        channel: {
            name: 'general',
            id: '123456789012345678',
            referrer: 'https://discord.com/channels/@me/123456789012345678',
            messageGroup: 'default'
        },
        now: new Date('2026-03-21T10:30:00Z')
    });

    assert.match(result, /general/);
    assert.doesNotMatch(result, /\{channel\}|\{time\}|\{date\}/);
});
