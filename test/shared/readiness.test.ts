import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveAppReadiness, deriveSetupChecklist } from '../../app/src/shared/readiness';

const secureSetup = {
    tokenPresent: true,
    tokenStorage: 'secure' as const,
    dataDir: 'C:/data',
    secureStorePath: 'C:/data/discord-token.secure',
    envPath: 'C:/data/.env',
    configPath: 'C:/data/config.json',
    statePath: 'C:/data/.sender-state.json',
    logsDir: 'C:/data/logs'
};

test('deriveAppReadiness blocks start when the token is missing', () => {
    const readiness = deriveAppReadiness({
        setup: {
            ...secureSetup,
            tokenPresent: false,
            tokenStorage: 'missing'
        },
        configStatus: 'ready',
        configError: null,
        sidecarStatus: 'ready'
    });

    assert.equal(readiness.canStartSession, false);
    assert.deepEqual(readiness.blockingIssues, ['token_missing']);
});

test('deriveAppReadiness blocks start when the saved config is invalid', () => {
    const readiness = deriveAppReadiness({
        setup: secureSetup,
        configStatus: 'invalid',
        configError: 'channels.0.id: invalid snowflake',
        sidecarStatus: 'ready'
    });

    assert.equal(readiness.canStartSession, false);
    assert.ok(readiness.blockingIssues.includes('config_invalid'));
    assert.ok(readiness.warnings.includes('channels.0.id: invalid snowflake'));
});

test('deriveAppReadiness tracks sidecar failure and recovery states', () => {
    const failed = deriveAppReadiness({
        setup: secureSetup,
        configStatus: 'ready',
        configError: null,
        sidecarStatus: 'failed'
    });
    const recovered = deriveAppReadiness({
        setup: secureSetup,
        configStatus: 'ready',
        configError: null,
        sidecarStatus: 'ready'
    });

    assert.ok(failed.blockingIssues.includes('sidecar_failed'));
    assert.equal(failed.canStartSession, false);
    assert.equal(recovered.blockingIssues.length, 0);
    assert.equal(recovered.canStartSession, true);
});

test('deriveAppReadiness treats unreadable secure-token state as a blocking issue', () => {
    const readiness = deriveAppReadiness({
        setup: {
            ...secureSetup,
            tokenPresent: false,
            tokenStorage: 'missing',
            warning: 'Stored token could not be decrypted.'
        },
        configStatus: 'ready',
        configError: null,
        sidecarStatus: 'ready'
    });

    assert.equal(readiness.token.status, 'corrupted');
    assert.ok(readiness.blockingIssues.includes('token_unreadable'));
});

test('deriveSetupChecklist reflects first-run progress without persisting separate checklist state', () => {
    const checklist = deriveSetupChecklist({
        setup: secureSetup,
        configStatus: 'ready',
        validationErrors: [],
        preflight: {
            ok: true,
            checkedAt: '2026-03-21T10:00:00.000Z',
            configValid: true,
            tokenPresent: true,
            issues: [],
            channels: []
        },
        config: {
            userAgent: 'UA',
            channels: [{
                name: 'general',
                id: '123456789012345678',
                referrer: 'https://discord.com/channels/@me/123456789012345678',
                messageGroup: 'default'
            }],
            messageGroups: {
                default: ['Hello']
            }
        }
    });

    assert.equal(checklist.complete, true);
    assert.equal(checklist.completedCount, checklist.totalCount);
});
