import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSenderState, resolveStateFile, saveSenderState } from '../../src/services/state-store';

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'discord-auto-state-'));
}

test('loadSenderState returns a warning and resets when the state file is corrupted', () => {
    const tempDir = createTempDir();
    fs.writeFileSync(resolveStateFile(tempDir), '{ invalid json', 'utf8');

    const state = loadSenderState(tempDir);

    assert.equal(state.summaries.length, 0);
    assert.equal(state.recentFailures.length, 0);
    assert.match(state.warning ?? '', /corrupted/i);
});

test('saveSenderState clears transient warning metadata before persisting', () => {
    const tempDir = createTempDir();

    saveSenderState(tempDir, {
        summaries: [],
        recentFailures: [],
        warning: 'should not persist'
    });

    const raw = JSON.parse(fs.readFileSync(resolveStateFile(tempDir), 'utf8')) as { warning?: string };
    assert.equal(raw.warning, undefined);
});
