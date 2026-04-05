import test from 'node:test';
import assert from 'node:assert/strict';
import { getQuietHoursDelayMs } from '../../../src/domain/session/quiet-hours';
import { AppChannel } from '../../../src/types';

const channel: AppChannel = {
    name: 'general',
    id: '123456789012345678',
    referrer: 'https://discord.com/channels/@me/123456789012345678',
    messageGroup: 'default',
};

test('getQuietHoursDelayMs returns remaining quiet-time for same-day windows', () => {
    const delayMs = getQuietHoursDelayMs(
        {
            ...channel,
            schedule: {
                intervalSeconds: 5,
                randomMarginSeconds: 0,
                timezone: 'UTC',
                quietHours: {
                    start: '09:00',
                    end: '17:00',
                },
            },
        },
        new Date('2026-03-21T10:15:00.000Z'),
    );

    assert.equal(delayMs, 24_300_000);
});

test('getQuietHoursDelayMs returns remaining quiet-time for overnight windows', () => {
    const delayMs = getQuietHoursDelayMs(
        {
            ...channel,
            schedule: {
                intervalSeconds: 5,
                randomMarginSeconds: 0,
                timezone: 'UTC',
                quietHours: {
                    start: '22:00',
                    end: '06:00',
                },
            },
        },
        new Date('2026-03-21T23:30:00.000Z'),
    );

    assert.equal(delayMs, 23_400_000);
});
