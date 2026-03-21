import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';

const rootDir = path.resolve(import.meta.dir, '..');
const executablePath = path.join(rootDir, 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'discord-auto-message-sender.exe' : 'discord-auto-message-sender');
const diagnosticsFlag = '--print-release-diagnostics-json';

function assertWindows() {
    if (process.platform !== 'win32') {
        throw new Error('Packaged desktop smoke is only supported on Windows.');
    }
}

function assertExecutableExists() {
    if (!fs.existsSync(executablePath)) {
        throw new Error(`Packaged executable not found at '${executablePath}'. Run 'bun run desktop:build' first.`);
    }
}

function isolatedEnvironment(tempRoot: string) {
    const appDataDir = path.join(tempRoot, 'AppData', 'Roaming', 'com.local.discord-auto-message-sender-smoke');
    fs.mkdirSync(appDataDir, { recursive: true });
    return {
        env: {
            ...process.env,
            DISCORD_AUTO_MESSAGE_SENDER_APPDATA_DIR: appDataDir
        },
        appDataDir
    };
}

function loadDiagnostics(env: NodeJS.ProcessEnv, cwd: string) {
    const result = spawnSync(executablePath, [diagnosticsFlag], {
        cwd,
        env,
        encoding: 'utf8',
        timeout: 15000
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        throw new Error(`Diagnostics command failed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    }

    const line = result.stdout
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .at(-1);
    if (!line) {
        throw new Error('Diagnostics command did not print JSON.');
    }

    return JSON.parse(line) as {
        appVersion: string;
        dataDir: string;
        logsDir: string;
        configPath: string;
        statePath: string;
        secureStorePath: string;
        tokenStorage: string;
        sidecarStatus: string;
    };
}

async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    assertWindows();
    assertExecutableExists();

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-auto-smoke-'));
    const { env, appDataDir } = isolatedEnvironment(tempRoot);
    const diagnostics = loadDiagnostics(env, tempRoot);

    if (!diagnostics.dataDir.startsWith(appDataDir)) {
        throw new Error(`Expected diagnostics data dir '${diagnostics.dataDir}' to live under '${appDataDir}'.`);
    }

    if (!diagnostics.secureStorePath.startsWith(diagnostics.dataDir)) {
        throw new Error(`Expected secure store path '${diagnostics.secureStorePath}' to live under '${diagnostics.dataDir}'.`);
    }

    const processHandle = spawn(executablePath, [], {
        cwd: tempRoot,
        env,
        detached: false,
        stdio: 'ignore',
        windowsHide: true
    });

    await sleep(8000);

    if (processHandle.exitCode !== null) {
        throw new Error(`Packaged app exited too early with code ${processHandle.exitCode}.`);
    }

    if (!fs.existsSync(diagnostics.dataDir)) {
        throw new Error(`Expected app data dir '${diagnostics.dataDir}' to be created during launch.`);
    }

    spawnSync('taskkill', ['/PID', String(processHandle.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
    });

    console.log(`Smoke passed for ${path.basename(executablePath)} using isolated APPDATA '${appDataDir}'.`);
    console.log(`Diagnostics: ${JSON.stringify(diagnostics)}`);
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
