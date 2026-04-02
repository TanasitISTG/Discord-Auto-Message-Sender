import { DesktopCommandMap } from '../contracts';
import { DesktopRuntime } from '../runtime';

export async function handleLoadConfig(
    runtime: DesktopRuntime,
    _payload: DesktopCommandMap['load_config']['request'],
): Promise<DesktopCommandMap['load_config']['response']> {
    return runtime.loadConfig();
}

export async function handleSaveConfig(
    runtime: DesktopRuntime,
    payload: DesktopCommandMap['save_config']['request'],
): Promise<DesktopCommandMap['save_config']['response']> {
    return runtime.saveConfig(payload);
}
