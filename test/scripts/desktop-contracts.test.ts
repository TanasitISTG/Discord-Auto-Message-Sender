import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateDesktopContracts } from '../../scripts/generate-desktop-contracts';

const rootDir = path.resolve(__dirname, '..', '..');

test('desktop contract outputs stay in sync with the schema manifests', () => {
    const { ts, rust } = generateDesktopContracts();

    const generatedTs = fs.readFileSync(path.join(rootDir, 'src', 'desktop', 'contracts.ts'), 'utf8');
    const generatedRust = fs.readFileSync(path.join(rootDir, 'src-tauri', 'src', 'contracts.rs'), 'utf8');

    assert.equal(generatedTs, ts);
    assert.equal(generatedRust, rust);
});
