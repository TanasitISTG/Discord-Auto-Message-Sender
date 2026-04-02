import type { AppChannel } from '../config/types';

interface ZonedDateParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
}

function parseClockTime(value: string): { hour: number; minute: number } | null {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) {
        return null;
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) {
        return null;
    }

    return { hour, minute };
}

function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    });
    const parts = formatter.formatToParts(date);
    const values = Object.fromEntries(parts
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]));

    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
        hour: Number(values.hour),
        minute: Number(values.minute)
    };
}

export function getChannelDayKey(target: AppChannel, date: Date): string {
    const timeZone = target.schedule?.timezone ?? 'UTC';

    try {
        const parts = getZonedDateParts(date, timeZone);
        return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
    } catch {
        return date.toISOString().slice(0, 10);
    }
}

function zonedTimeToUtcMillis(parts: ZonedDateParts, timeZone: string): number {
    const desiredUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    let guess = desiredUtc;

    for (let iteration = 0; iteration < 3; iteration += 1) {
        const actual = getZonedDateParts(new Date(guess), timeZone);
        const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0, 0);
        const delta = desiredUtc - actualUtc;
        guess += delta;

        if (delta === 0) {
            break;
        }
    }

    return guess;
}

function addDays(parts: ZonedDateParts, days: number): ZonedDateParts {
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    date.setUTCDate(date.getUTCDate() + days);

    return {
        ...parts,
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate()
    };
}

function isWithinQuietHours(currentMinutes: number, startMinutes: number, endMinutes: number): boolean {
    if (startMinutes === endMinutes) {
        return true;
    }

    if (startMinutes < endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }

    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

export function getQuietHoursDelayMs(target: AppChannel, now: Date = new Date()): number {
    const quietHours = target.schedule?.quietHours;
    if (!quietHours) {
        return 0;
    }

    const start = parseClockTime(quietHours.start);
    const end = parseClockTime(quietHours.end);
    if (!start || !end) {
        return 0;
    }

    const timeZone = target.schedule?.timezone ?? 'UTC';

    try {
        const zonedNow = getZonedDateParts(now, timeZone);
        const currentMinutes = (zonedNow.hour * 60) + zonedNow.minute;
        const startMinutes = (start.hour * 60) + start.minute;
        const endMinutes = (end.hour * 60) + end.minute;

        if (!isWithinQuietHours(currentMinutes, startMinutes, endMinutes)) {
            return 0;
        }

        const resumeDate = startMinutes < endMinutes
            ? zonedNow
            : currentMinutes >= startMinutes
                ? addDays(zonedNow, 1)
                : zonedNow;
        const resumeAt = zonedTimeToUtcMillis({
            ...resumeDate,
            hour: end.hour,
            minute: end.minute
        }, timeZone);

        return Math.max(0, resumeAt - now.getTime());
    } catch {
        return 0;
    }
}
