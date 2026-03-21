import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultAppConfig, normalizeLegacyConfig, parseAppConfig, parseRuntimeOptions } from '../../src/config/schema';
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

test('parseAppConfig rejects message group names that collide after trimming whitespace', () => {
    assert.throws(() => parseAppConfig({
        userAgent: 'UA',
        channels: [],
        messageGroups: {
            default: ['Hello!'],
            ' default ': ['Hello again!']
        }
    }), (error) => error instanceof ZodError && error.issues.some((issue) => issue.message.includes('Duplicate message group name')));
});

test('parseRuntimeOptions rejects blank string inputs instead of coercing them to zero', () => {
    assert.throws(() => parseRuntimeOptions({
        numMessages: ' ',
        baseWaitSeconds: ' ',
        marginSeconds: ' '
    }), (error) => error instanceof ZodError && error.issues.some((issue) => issue.message.includes('is required')));
});

test('parseAppConfig accepts message group names that overlap with Object prototype properties', () => {
    const config = parseAppConfig({
        userAgent: 'UA',
        channels: [],
        messageGroups: JSON.parse('{"toString":["Alpha"],"constructor":["Beta"],"__proto__":["Gamma"]}')
    });

    assert.deepEqual(Object.keys(config.messageGroups).sort(), ['__proto__', 'constructor', 'toString']);
    assert.equal(Object.prototype.hasOwnProperty.call(config.messageGroups, 'toString'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(config.messageGroups, 'constructor'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(config.messageGroups, '__proto__'), true);
    assert.deepEqual(config.messageGroups.toString, ['Alpha']);
    assert.deepEqual(config.messageGroups.constructor, ['Beta']);
    assert.deepEqual(config.messageGroups['__proto__'], ['Gamma']);
});

test('createDefaultAppConfig returns a null-prototype messageGroups object safe for special group names', () => {
    const config = createDefaultAppConfig();

    assert.equal(Object.getPrototypeOf(config.messageGroups), null);

    config.messageGroups['__proto__'] = ['Injected'];

    assert.equal(Object.prototype.hasOwnProperty.call(config.messageGroups, '__proto__'), true);
    assert.deepEqual(config.messageGroups['__proto__'], ['Injected']);
    assert.deepEqual(config.messageGroups.default, ['Hello from your Discord bot!']);
});
