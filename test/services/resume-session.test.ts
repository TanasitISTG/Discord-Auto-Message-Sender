import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultAppConfig } from '../../src/config/schema';
import { canResumeSession, createSessionConfigSignature } from '../../src/services/session';

function createConfig() {
    const config = createDefaultAppConfig();
    config.channels = [
        {
            name: 'general',
            id: '123456789012345678',
            referrer: 'https://discord.com/channels/@me/123456789012345678',
            messageGroup: 'alpha',
        },
    ];
    config.messageGroups = {
        beta: ['second'],
        alpha: ['first'],
    };
    return config;
}

test('createSessionConfigSignature is stable across semantically equivalent object key ordering', () => {
    const config = createConfig();
    const reordered = {
        ...config,
        channels: config.channels.map((channel) => ({
            id: channel.id,
            messageGroup: channel.messageGroup,
            name: channel.name,
            referrer: channel.referrer,
        })),
        messageGroups: Object.fromEntries(
            Object.entries(config.messageGroups)
                .reverse()
                .map(([key, messages]) => [key, [...messages]]),
        ),
    };

    assert.notEqual(JSON.stringify(config), JSON.stringify(reordered));
    assert.equal(createSessionConfigSignature(config), createSessionConfigSignature(reordered));
});

test('canResumeSession accepts a checkpoint created from an equivalent config with different key ordering', () => {
    const config = createConfig();
    const reordered = {
        ...config,
        channels: config.channels.map((channel) => ({
            referrer: channel.referrer,
            name: channel.name,
            id: channel.id,
            messageGroup: channel.messageGroup,
        })),
        messageGroups: Object.fromEntries(
            Object.entries(config.messageGroups)
                .reverse()
                .map(([key, messages]) => [key, [...messages]]),
        ),
    };

    const canResume = canResumeSession(
        {
            sessionId: 'session-1',
            updatedAt: '2026-03-21T09:59:00.000Z',
            runtime: {
                numMessages: 1,
                baseWaitSeconds: 2,
                marginSeconds: 0,
            },
            configSignature: createSessionConfigSignature(reordered),
            state: {
                id: 'session-1',
                status: 'paused',
                updatedAt: '2026-03-21T09:59:00.000Z',
                activeChannels: ['123456789012345678'],
                completedChannels: [],
                failedChannels: [],
                sentMessages: 1,
            },
            recentMessageHistory: {
                '123456789012345678': ['first'],
            },
        },
        config,
        {
            numMessages: 1,
            baseWaitSeconds: 2,
            marginSeconds: 0,
        },
    );

    assert.equal(canResume, true);
});
