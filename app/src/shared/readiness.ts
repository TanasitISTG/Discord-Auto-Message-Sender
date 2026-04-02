import type { AppConfig, DesktopSetupState, PreflightResult, SidecarStatus } from '../lib/desktop';

export type ConfigReadinessStatus = 'loading' | 'ready' | 'missing' | 'invalid';
export type TokenReadinessStatus = 'loading' | 'secure' | 'missing' | 'corrupted';
export type BlockingIssue =
    | 'token_missing'
    | 'token_unreadable'
    | 'config_missing'
    | 'config_invalid'
    | 'sidecar_connecting'
    | 'sidecar_restarting'
    | 'sidecar_failed';
export type SetupChecklistAction = 'config' | 'preflight' | 'session';

export interface TokenReadiness {
    status: TokenReadinessStatus;
    label: string;
    detail: string;
    blocking: boolean;
}

export interface AppReadiness {
    token: TokenReadiness;
    config: {
        status: Exclude<ConfigReadinessStatus, 'loading'> | 'loading';
        detail: string;
    };
    sidecar: SidecarStatus;
    blockingIssues: BlockingIssue[];
    warnings: string[];
    canStartSession: boolean;
}

export interface SetupChecklistItem {
    id: 'secure_token' | 'channel' | 'message_group' | 'save_config' | 'preflight';
    label: string;
    detail: string;
    done: boolean;
    action: SetupChecklistAction;
    actionLabel: string;
}

export interface SetupChecklist {
    items: SetupChecklistItem[];
    completedCount: number;
    totalCount: number;
    complete: boolean;
}

interface DeriveAppReadinessOptions {
    setup: DesktopSetupState | null;
    configStatus: ConfigReadinessStatus;
    configError?: string | null;
    sidecarStatus: SidecarStatus;
}

interface DeriveSetupChecklistOptions {
    setup: DesktopSetupState | null;
    config: AppConfig;
    configStatus: ConfigReadinessStatus;
    validationErrors: string[];
    preflight: PreflightResult | null;
}

function isCorruptedTokenState(setup: DesktopSetupState | null): boolean {
    if (!setup?.warning) {
        return false;
    }

    return /decrypt|secure|token|readable|corrupt/i.test(setup.warning);
}

export function deriveTokenReadiness(setup: DesktopSetupState | null): TokenReadiness {
    if (!setup) {
        return {
            status: 'loading',
            label: 'loading',
            detail: 'Loading desktop token state.',
            blocking: true,
        };
    }

    if (isCorruptedTokenState(setup)) {
        return {
            status: 'corrupted',
            label: 'unreadable',
            detail: setup.warning ?? 'Stored token could not be read.',
            blocking: true,
        };
    }

    if (setup.tokenPresent && setup.tokenStorage === 'secure') {
        return {
            status: 'secure',
            label: 'secure',
            detail: 'Stored securely for this Windows user.',
            blocking: false,
        };
    }

    return {
        status: 'missing',
        label: 'missing',
        detail: 'No Discord token is configured yet.',
        blocking: true,
    };
}

export function describeBlockingIssue(issue: BlockingIssue): string {
    switch (issue) {
        case 'token_missing':
            return 'Save a Discord token securely before starting a session.';
        case 'token_unreadable':
            return 'The stored Discord token could not be read. Save it again before starting a session.';
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
    sidecarStatus,
}: DeriveAppReadinessOptions): AppReadiness {
    const warnings: string[] = [];
    const blockingIssues: BlockingIssue[] = [];
    const token = deriveTokenReadiness(setup);

    if (setup?.warning && token.status !== 'corrupted') {
        warnings.push(setup.warning);
    }

    if (token.status === 'missing' || token.status === 'loading') {
        blockingIssues.push('token_missing');
    } else if (token.status === 'corrupted') {
        blockingIssues.push('token_unreadable');
        warnings.push(token.detail);
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
        token,
        config: {
            status: configStatus,
            detail: configDetail,
        },
        sidecar: sidecarStatus,
        blockingIssues,
        warnings,
        canStartSession: blockingIssues.length === 0,
    };
}

export function deriveSetupChecklist({
    setup,
    config,
    configStatus,
    validationErrors,
    preflight,
}: DeriveSetupChecklistOptions): SetupChecklist {
    const token = deriveTokenReadiness(setup);
    const nonEmptyGroups = Object.entries(config.messageGroups).filter(([, messages]) =>
        messages.some((message) => message.trim().length > 0),
    );
    const hasValidGroups = nonEmptyGroups.length > 0;
    const hasChannels = config.channels.length > 0;
    const hasSavedConfig = configStatus === 'ready' && validationErrors.length === 0;
    const preflightPassed = Boolean(preflight?.ok);

    const items: SetupChecklistItem[] = [
        {
            id: 'secure_token',
            label: 'Save Discord token securely',
            detail:
                token.status === 'secure'
                    ? 'Secure token storage is configured.'
                    : token.status === 'corrupted'
                      ? 'Stored token could not be read.'
                      : 'Token storage still needs setup.',
            done: token.status === 'secure',
            action: 'config',
            actionLabel: 'Open Config',
        },
        {
            id: 'channel',
            label: 'Create at least one channel',
            detail: hasChannels
                ? `${config.channels.length} channel${config.channels.length === 1 ? '' : 's'} configured.`
                : 'No channels configured yet.',
            done: hasChannels,
            action: 'config',
            actionLabel: 'Open Config',
        },
        {
            id: 'message_group',
            label: 'Create at least one non-empty message group',
            detail: hasValidGroups
                ? `${nonEmptyGroups.length} usable group${nonEmptyGroups.length === 1 ? '' : 's'} configured.`
                : 'No usable message groups yet.',
            done: hasValidGroups,
            action: 'config',
            actionLabel: 'Open Config',
        },
        {
            id: 'save_config',
            label: 'Save config',
            detail: hasSavedConfig
                ? 'A valid config is saved locally.'
                : 'Save the current draft before starting sessions.',
            done: hasSavedConfig,
            action: 'config',
            actionLabel: 'Open Config',
        },
        {
            id: 'preflight',
            label: 'Run preflight successfully',
            detail: preflightPassed
                ? 'Preflight passed in this app session.'
                : 'Run preflight once to confirm access and validation.',
            done: preflightPassed,
            action: 'preflight',
            actionLabel: 'Run Preflight',
        },
    ];

    const completedCount = items.filter((item) => item.done).length;
    return {
        items,
        completedCount,
        totalCount: items.length,
        complete: completedCount === items.length,
    };
}
