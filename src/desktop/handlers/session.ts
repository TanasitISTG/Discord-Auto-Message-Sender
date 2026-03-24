import { DesktopCommandMap } from '../contracts';
import { DesktopRuntime } from '../runtime';

export async function handleStartSession(
    runtime: DesktopRuntime,
    payload: DesktopCommandMap['start_session']['request']
): Promise<DesktopCommandMap['start_session']['response']> {
    return runtime.startSession(payload);
}

export async function handlePauseSession(
    runtime: DesktopRuntime,
    _payload: DesktopCommandMap['pause_session']['request']
): Promise<DesktopCommandMap['pause_session']['response']> {
    return runtime.pauseSession();
}

export async function handleResumeSession(
    runtime: DesktopRuntime,
    _payload: DesktopCommandMap['resume_session']['request']
): Promise<DesktopCommandMap['resume_session']['response']> {
    return runtime.resumeSession();
}

export async function handleStopSession(
    runtime: DesktopRuntime,
    _payload: DesktopCommandMap['stop_session']['request']
): Promise<DesktopCommandMap['stop_session']['response']> {
    return runtime.stopSession();
}

export async function handleGetSessionState(
    runtime: DesktopRuntime,
    _payload: DesktopCommandMap['get_session_state']['request']
): Promise<DesktopCommandMap['get_session_state']['response']> {
    return runtime.getSessionState();
}
