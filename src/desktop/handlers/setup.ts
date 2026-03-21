import { DesktopCommandMap } from '../contracts';
import { DesktopRuntime } from '../runtime';

export async function handleLoadSetupState(
    runtime: DesktopRuntime,
    _payload: DesktopCommandMap['load_setup_state']['request']
): Promise<DesktopCommandMap['load_setup_state']['response']> {
    return runtime.loadSetupState();
}

export async function handleSaveEnvironment(
    runtime: DesktopRuntime,
    payload: DesktopCommandMap['save_environment']['request']
): Promise<DesktopCommandMap['save_environment']['response']> {
    return runtime.saveEnvironment(payload);
}
