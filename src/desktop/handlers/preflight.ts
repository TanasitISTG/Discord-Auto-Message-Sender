import { DesktopCommandMap } from '../contracts';
import { DesktopRuntime } from '../runtime';

export async function handleRunPreflight(
    runtime: DesktopRuntime,
    payload: DesktopCommandMap['run_preflight']['request']
): Promise<DesktopCommandMap['run_preflight']['response']> {
    return runtime.runPreflight(payload);
}

export async function handleRunDryRun(
    runtime: DesktopRuntime,
    payload: DesktopCommandMap['run_dry_run']['request']
): Promise<DesktopCommandMap['run_dry_run']['response']> {
    return runtime.runDryRun(payload);
}
