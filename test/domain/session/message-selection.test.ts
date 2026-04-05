import test from 'node:test';
import assert from 'node:assert/strict';
import { pickNextMessage } from '../../../src/domain/session/message-selection';

test('pickNextMessage avoids repeats until the group is exhausted', () => {
    const sentCache = new Set<string>();
    const sequence = [0.0, 0.5, 0.9];
    let index = 0;

    const first = pickNextMessage(['A', 'B', 'C'], sentCache, () => sequence[index++]);
    const second = pickNextMessage(['A', 'B', 'C'], sentCache, () => sequence[index++]);
    const third = pickNextMessage(['A', 'B', 'C'], sentCache, () => sequence[index++]);

    assert.equal(new Set([first, second, third]).size, 3);
});

test('pickNextMessage supports single-message groups', () => {
    const sentCache = new Set<string>();

    const first = pickNextMessage(['Only'], sentCache, () => 0);
    const second = pickNextMessage(['Only'], sentCache, () => 0);

    assert.equal(first, 'Only');
    assert.equal(second, 'Only');
});

test('pickNextMessage terminates with deterministic random when one option remains', () => {
    const sentCache = new Set<string>(['A']);

    const next = pickNextMessage(['A', 'B'], sentCache, () => 0);

    assert.equal(next, 'B');
});

test('pickNextMessage handles duplicate message content without looping', () => {
    const sentCache = new Set<string>();

    const first = pickNextMessage(['A', 'A'], sentCache, () => 0);
    const second = pickNextMessage(['A', 'A'], sentCache, () => 0);

    assert.equal(first, 'A');
    assert.equal(second, 'A');
});

test('pickNextMessage preserves duplicate weighting among remaining unsent messages', () => {
    const sentCache = new Set<string>();

    const weightedPick = pickNextMessage(['A', 'A', 'B'], sentCache, () => 0.5);
    const forcedRemainingPick = pickNextMessage(['A', 'A', 'B'], sentCache, () => 0);

    assert.equal(weightedPick, 'A');
    assert.equal(forcedRemainingPick, 'B');
});

test('pickNextMessage filters recent history using raw template keys', () => {
    const sentCache = new Set<string>();

    const next = pickNextMessage(['Hello {channel}', 'Backup'], sentCache, () => 0, ['Hello {channel}']);

    assert.equal(next, 'Backup');
});
