import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertMatchingVersions, readVersionManifest } from '../../scripts/check-versions';

function writeVersionFiles(rootDir: string, versions: { packageVersion: string; tauriVersion: string; cargoVersion: string }) {
    fs.mkdirSync(path.join(rootDir, 'src-tauri'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ version: versions.packageVersion }, null, 2));
    fs.writeFileSync(path.join(rootDir, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ version: versions.tauriVersion }, null, 2));
    fs.writeFileSync(path.join(rootDir, 'src-tauri', 'Cargo.toml'), `[package]\nname = "discord-auto-message-sender"\nversion = "${versions.cargoVersion}"\n`);
}

test('readVersionManifest reads version metadata from all public release files', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-version-manifest-'));
    writeVersionFiles(rootDir, {
        packageVersion: '1.2.3',
        tauriVersion: '1.2.3',
        cargoVersion: '1.2.3'
    });

    const manifest = readVersionManifest(rootDir);

    assert.deepEqual(manifest, {
        packageVersion: '1.2.3',
        tauriVersion: '1.2.3',
        cargoVersion: '1.2.3'
    });
});

test('assertMatchingVersions throws when package, Tauri, and Cargo versions diverge', () => {
    assert.throws(() => {
        assertMatchingVersions({
            packageVersion: '1.0.0',
            tauriVersion: '0.9.0',
            cargoVersion: '1.0.0'
        });
    }, /Version mismatch detected/);
});
