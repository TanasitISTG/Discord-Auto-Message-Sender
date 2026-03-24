const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

export interface VersionManifest {
    packageVersion: string;
    tauriVersion: string;
    cargoVersion: string;
}

export function readVersionManifest(rootDir: string): VersionManifest {
    const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { version: string };
    const tauriConfig = JSON.parse(fs.readFileSync(path.join(rootDir, 'src-tauri', 'tauri.conf.json'), 'utf8')) as { version: string };
    const cargoToml = fs.readFileSync(path.join(rootDir, 'src-tauri', 'Cargo.toml'), 'utf8');
    const cargoVersionMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);

    if (!cargoVersionMatch) {
        throw new Error('Could not find [package] version in src-tauri/Cargo.toml.');
    }

    return {
        packageVersion: packageJson.version,
        tauriVersion: tauriConfig.version,
        cargoVersion: cargoVersionMatch[1]
    };
}

export function assertMatchingVersions(manifest: VersionManifest) {
    const versions = [manifest.packageVersion, manifest.tauriVersion, manifest.cargoVersion];
    const mismatched = versions.some((version) => version !== manifest.packageVersion);

    if (mismatched) {
        throw new Error(
            `Version mismatch detected.\npackage.json: ${manifest.packageVersion}\nsrc-tauri/tauri.conf.json: ${manifest.tauriVersion}\nsrc-tauri/Cargo.toml: ${manifest.cargoVersion}`
        );
    }
}

if (require.main === module) {
    const rootDir = path.resolve(__dirname, '..');
    const manifest = readVersionManifest(rootDir);
    assertMatchingVersions(manifest);
    console.log(`Version metadata is aligned at ${manifest.packageVersion}.`);
}
