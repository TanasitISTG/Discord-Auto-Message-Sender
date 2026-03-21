import type { DesktopSetupState, SidecarStatus } from '../lib/desktop';

export type ConfigReadinessStatus = 'loading' | 'ready' | 'missing' | 'invalid';
export type TokenReadinessStatus = 'ready' | 'warning' | 'missing';
export type BlockingIssue =
    | 'token_missing'
    | 'config_missing'
    | 'config_invalid'
    | 'sidecar_connecting'
    | 'sidecar_restarting'
    | 'sidecar_failed';

export interface AppReadiness {
    token: {
        status: TokenReadinessStatus;
        detail: string;
    };
    config: {
        status: Exclude<ConfigReadinessStatus, 'loading'> | 'loading';
        detail: string;
    };
    sidecar: SidecarStatus;
    blockingIssues: BlockingIssue[];
    warnings: string[];
    canStartSession: boolean;
}

interface DeriveAppReadinessOptions {
    setup: DesktopSetupState | null;
    configStatus: ConfigReadinessStatus;
    configError?: string | null;
    sidecarStatus: SidecarStatus;
}

export function describeBlockingIssue(issue: BlockingIssue): string {
    switch (issue) {
        case 'token_missing':
            return 'Save a Discord token securely before starting a session.';
        case 'config_missing':
            return 'Save a desktop config before starting a session.';
        case 'config_invalid':
            return 'Fix the current config issues before starting a session.';
        case 'sidecar_connecting':
            return 'The desktop runtime is still connecting.';
        case 'sidecar_restarting':
            return 'The desktop runtime is restarting after an interruption.';
        case 'sidecar_failed':
            return 'The desktop runtime is unavailable.';
        default:
            return 'Desktop readiness is blocked.';
    }
}

export function deriveAppReadiness({
    setup,
    configStatus,
    configError,
    sidecarStatus
}: DeriveAppReadinessOptions): AppReadiness {
    const warnings: string[] = [];
    const blockingIssues: BlockingIssue[] = [];

    let tokenStatus: TokenReadinessStatus = 'missing';
    let tokenDetail = 'No Discord token is configured.';
    if (setup?.tokenPresent) {
        tokenStatus = setup.warning || setup.tokenStorage === 'environment' ? 'warning' : 'ready';
        tokenDetail = setup.tokenStorage === 'environment'
            ? 'Using an environment fallback instead of the secure store.'
            : 'Secure token storage is configured.';
    }

    if (setup?.warning) {
        warnings.push(setup.warning);
        tokenDetail = setup.warning;
    } else if (setup?.tokenStorage === 'environment') {
        warnings.push('Discord token is currently using an environment fallback instead of the secure store.');
    }

    if (!setup?.tokenPresent) {
        blockingIssues.push('token_missing');
    }

    let configDetail = 'Desktop config is ready.';
    if (configStatus === 'missing') {
        blockingIssues.push('config_missing');
        configDetail = 'No saved config was found yet.';
    } else if (configStatus === 'invalid') {
        blockingIssues.push('config_invalid');
        configDetail = configError ?? 'The saved config is invalid.';
        if (configError) {
            warnings.push(configError);
        }
    } else if (configStatus === 'loading') {
        configDetail = 'Loading desktop config.';
    }

    if (sidecarStatus === 'connecting') {
        blockingIssues.push('sidecar_connecting');
    } else if (sidecarStatus === 'restarting') {
        blockingIssues.push('sidecar_restarting');
    } else if (sidecarStatus === 'failed') {
        blockingIssues.push('sidecar_failed');
    }

    return {
        token: {
            status: tokenStatus,
            detail: tokenDetail
        },
        config: {
            status: configStatus,
            detail: configDetail
        },
        sidecar: sidecarStatus,
        blockingIssues,
        warnings,
        canStartSession: blockingIssues.length === 0
    };
}
