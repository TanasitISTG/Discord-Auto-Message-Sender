import { DesktopCommandMap } from '../contracts';
import { DesktopRuntime } from '../runtime';

export async function handleLoadLogs(
    runtime: DesktopRuntime,
    payload: DesktopCommandMap['load_logs']['request']
): Promise<DesktopCommandMap['load_logs']['response']> {
    return runtime.loadLogs(payload);
}

export async function handleLoadState(
    runtime: DesktopRuntime,
    _payload: DesktopCommandMap['load_state']['request']
): Promise<DesktopCommandMap['load_state']['response']> {
    return runtime.loadState();
}

export async function handleDiscardResumeSession(
    runtime: DesktopRuntime,
    _payload: DesktopCommandMap['discard_resume_session']['request']
): Promise<DesktopCommandMap['discard_resume_session']['response']> {
    return runtime.discardResumeSession();
}
