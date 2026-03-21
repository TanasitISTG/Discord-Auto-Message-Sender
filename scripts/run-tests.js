const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function collectTestFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            files.push(...collectTestFiles(fullPath));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.test.ts')) {
            files.push(fullPath);
        }
    }

    return files;
}

const rootDir = path.resolve(__dirname, '..');
const testDir = path.join(rootDir, 'test');
const testFiles = fs.existsSync(testDir) ? collectTestFiles(testDir).sort() : [];

if (testFiles.length === 0) {
    console.error('No test files found under test/.');
    process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', '-r', 'ts-node/register', ...testFiles], {
    cwd: rootDir,
    stdio: 'inherit'
});

if (result.error) {
    throw result.error;
}

process.exit(result.status ?? 1);
