import fs from 'fs';
import path from 'path';

const rootDir = path.resolve(import.meta.dir, '..');
const outputDir = path.join(rootDir, 'src-tauri', 'resources', 'sidecar');
const outputFile = path.join(outputDir, process.platform === 'win32' ? 'desktop-sidecar.exe' : 'desktop-sidecar');

const targetMap: Record<string, string> = {
    win32: 'bun-windows-x64-modern',
    darwin: 'bun-darwin-x64-modern',
    linux: 'bun-linux-x64-modern'
};

const target = process.env.SIDECAR_BUN_TARGET ?? targetMap[process.platform];

if (!target) {
    throw new Error(`Unsupported platform '${process.platform}' for sidecar compilation.`);
}

fs.mkdirSync(outputDir, { recursive: true });

const result = Bun.spawnSync([
    'bun',
    'build',
    './src/desktop/server.ts',
    '--compile',
    `--target=${target}`,
    `--outfile=${outputFile}`
], {
    cwd: rootDir,
    stdout: 'inherit',
    stderr: 'inherit'
});

if (result.exitCode !== 0) {
    throw new Error(`Failed to compile desktop sidecar (exit ${result.exitCode}).`);
}
