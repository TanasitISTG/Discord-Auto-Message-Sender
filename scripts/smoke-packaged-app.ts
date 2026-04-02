import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';

const rootDir = path.resolve(import.meta.dir, '..');
const executablePath = path.join(
    rootDir,
    'src-tauri',
    'target',
    'release',
    process.platform === 'win32' ? 'discord-auto-message-sender.exe' : 'discord-auto-message-sender',
);
const diagnosticsFlag = '--print-release-diagnostics-json';
const exportSupportBundleFlag = '--export-support-bundle-json';
const resetRuntimeStateFlag = '--reset-runtime-state-json';

interface ReleaseDiagnostics {
    appVersion: string;
    dataDir: string;
    logsDir: string;
    configPath: string;
    statePath: string;
    secureStorePath: string;
    tokenStorage: string;
    sidecarStatus: string;
}

interface SupportBundleResult {
    path: string;
    includedFiles: string[];
    missingFiles: string[];
}

interface ResetRuntimeStateResult {
    ok: true;
    clearedStateFile: boolean;
    deletedLogFiles: number;
}

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
            DISCORD_AUTO_MESSAGE_SENDER_APPDATA_DIR: appDataDir,
        },
        appDataDir,
    };
}

function runJsonCommand<T>(flag: string, env: NodeJS.ProcessEnv, cwd: string) {
    const result = spawnSync(executablePath, [flag], {
        cwd,
        env,
        encoding: 'utf8',
        timeout: 15000,
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        throw new Error(`Packaged command '${flag}' failed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    }

    const line = result.stdout
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .at(-1);
    if (!line) {
        throw new Error(`Packaged command '${flag}' did not print JSON.`);
    }

    return JSON.parse(line) as T;
}

function loadDiagnostics(env: NodeJS.ProcessEnv, cwd: string) {
    return runJsonCommand<ReleaseDiagnostics>(diagnosticsFlag, env, cwd);
}

function exportSupportBundle(env: NodeJS.ProcessEnv, cwd: string) {
    return runJsonCommand<SupportBundleResult>(exportSupportBundleFlag, env, cwd);
}

function resetRuntimeState(env: NodeJS.ProcessEnv, cwd: string) {
    return runJsonCommand<ResetRuntimeStateResult>(resetRuntimeStateFlag, env, cwd);
}

function seedRuntimeFiles(diagnostics: ReleaseDiagnostics) {
    fs.mkdirSync(path.dirname(diagnostics.configPath), { recursive: true });
    fs.mkdirSync(diagnostics.logsDir, { recursive: true });
    fs.writeFileSync(
        diagnostics.configPath,
        JSON.stringify(
            {
                userAgent: 'Smoke UA',
                channels: [],
                messageGroups: {
                    default: ['Hello from smoke'],
                },
            },
            null,
            2,
        ),
    );
    fs.writeFileSync(
        diagnostics.statePath,
        JSON.stringify(
            {
                schemaVersion: 1,
                summaries: [],
                recentFailures: [],
                recentMessageHistory: {},
                channelHealth: {},
            },
            null,
            2,
        ),
    );
    fs.writeFileSync(path.join(diagnostics.logsDir, 'session-a.jsonl'), '{"event":"smoke-a"}\n');
    fs.writeFileSync(path.join(diagnostics.logsDir, 'session-b.jsonl'), '{"event":"smoke-b"}\n');
}

function expandZipArchive(zipPath: string, destinationDir: string) {
    fs.mkdirSync(destinationDir, { recursive: true });
    const result = spawnSync(
        'powershell',
        [
            '-NoProfile',
            '-Command',
            `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destinationDir.replace(/'/g, "''")}' -Force`,
        ],
        {
            encoding: 'utf8',
            timeout: 30000,
            windowsHide: true,
        },
    );

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        throw new Error(`Failed to extract support bundle.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    }
}

function assertPathExists(filePath: string, label: string) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Expected ${label} at '${filePath}'.`);
    }
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
    seedRuntimeFiles(diagnostics);

    if (!diagnostics.dataDir.startsWith(appDataDir)) {
        throw new Error(`Expected diagnostics data dir '${diagnostics.dataDir}' to live under '${appDataDir}'.`);
    }

    if (!diagnostics.secureStorePath.startsWith(diagnostics.dataDir)) {
        throw new Error(
            `Expected secure store path '${diagnostics.secureStorePath}' to live under '${diagnostics.dataDir}'.`,
        );
    }

    const supportBundle = exportSupportBundle(env, tempRoot);
    assertPathExists(supportBundle.path, 'support bundle');
    const extractedSupportDir = path.join(tempRoot, 'support-extracted');
    expandZipArchive(supportBundle.path, extractedSupportDir);
    assertPathExists(path.join(extractedSupportDir, 'diagnostics.json'), 'diagnostics export');
    assertPathExists(path.join(extractedSupportDir, 'setup.json'), 'setup export');
    assertPathExists(path.join(extractedSupportDir, 'config.json'), 'config export');
    assertPathExists(path.join(extractedSupportDir, '.sender-state.json'), 'state export');
    assertPathExists(path.join(extractedSupportDir, 'logs', 'session-a.jsonl'), 'session-a log export');
    assertPathExists(path.join(extractedSupportDir, 'logs', 'session-b.jsonl'), 'session-b log export');

    const resetResult = resetRuntimeState(env, tempRoot);
    if (!resetResult.ok) {
        throw new Error('Runtime reset command did not report success.');
    }
    if (fs.existsSync(diagnostics.statePath)) {
        throw new Error(`Expected sender state '${diagnostics.statePath}' to be removed by runtime reset.`);
    }
    if (!fs.existsSync(diagnostics.configPath)) {
        throw new Error(`Expected config '${diagnostics.configPath}' to remain after runtime reset.`);
    }
    const remainingLogs = fs.readdirSync(diagnostics.logsDir).filter((entry) => entry.endsWith('.jsonl'));
    if (remainingLogs.length !== 0) {
        throw new Error(`Expected runtime reset to clear .jsonl logs, found: ${remainingLogs.join(', ')}`);
    }
    assertPathExists(supportBundle.path, 'preserved support bundle after runtime reset');

    const processHandle = spawn(executablePath, [], {
        cwd: tempRoot,
        env,
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
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
        windowsHide: true,
    });

    console.log(`Smoke passed for ${path.basename(executablePath)} using isolated APPDATA '${appDataDir}'.`);
    console.log(`Diagnostics: ${JSON.stringify(diagnostics)}`);
    console.log(`Support bundle: ${JSON.stringify(supportBundle)}`);
    console.log(`Runtime reset: ${JSON.stringify(resetResult)}`);
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
