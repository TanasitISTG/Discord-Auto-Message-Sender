import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLegacyConfig, parseAppConfig } from '../../src/config/schema';
import { ZodError } from 'zod';

test('parseAppConfig accepts canonical config and preserves camelCase shape', () => {
    const config = parseAppConfig({
        userAgent: 'UA',
        channels: [
            {
                name: 'general',
                id: '123456789012345678',
                referrer: 'https://discord.com/channels/@me/123456789012345678',
                messageGroup: 'default'
            }
        ],
        messageGroups: {
            default: ['Hello!']
        }
    });

    assert.equal(config.userAgent, 'UA');
    assert.equal(config.channels[0].messageGroup, 'default');
    assert.deepEqual(config.messageGroups.default, ['Hello!']);
});

test('normalizeLegacyConfig converts snake_case config and external messages into canonical config', () => {
    const config = normalizeLegacyConfig(
        {
            user_agent: 'UA',
            channels: [
                {
                    name: 'general',
                    id: '123456789012345678'
                }
            ]
        },
        {
            default: ['Hello!']
        }
    );

    assert.deepEqual(config, {
        userAgent: 'UA',
        channels: [
            {
                name: 'general',
                id: '123456789012345678',
                referrer: 'https://discord.com/channels/@me/123456789012345678',
                messageGroup: 'default'
            }
        ],
        messageGroups: {
            default: ['Hello!']
        }
    });
});

test('parseAppConfig rejects duplicate channel IDs', () => {
    assert.throws(() => parseAppConfig({
        userAgent: 'UA',
        channels: [
            {
                name: 'general-1',
                id: '123456789012345678',
                messageGroup: 'default'
            },
            {
                name: 'general-2',
                id: '123456789012345678',
                messageGroup: 'default'
            }
        ],
        messageGroups: {
            default: ['Hello!']
        }
    }), (error) => error instanceof ZodError && error.issues.some((issue) => issue.message.includes('Duplicate channel ID')));
});
