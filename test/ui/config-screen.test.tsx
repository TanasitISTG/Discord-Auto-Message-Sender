import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ConfigScreen } from '../../app/src/features/config/config-screen';
import type { AppConfig, DesktopSetupState, RuntimeOptions } from '../../app/src/lib/desktop';
import type { ConfigDraftController } from '../../app/src/features/config/use-config-draft';

const baseConfig: AppConfig = {
    userAgent: 'Mozilla/5.0',
    channels: [
        {
            name: 'General',
            id: 'channel-1',
            referrer: 'https://discord.com/channels/@me/channel-1',
            messageGroup: 'default',
            schedule: {
                intervalSeconds: 1800,
                randomMarginSeconds: 2,
                timezone: 'UTC',
                maxSendsPerDay: null,
                cooldownWindowSize: 3
            }
        },
        {
            name: 'Black Market',
            id: 'channel-2',
            referrer: 'https://discord.com/channels/@me/channel-2',
            messageGroup: 'default',
            schedule: {
                intervalSeconds: 1800,
                randomMarginSeconds: 2,
                timezone: 'UTC',
                maxSendsPerDay: null,
                cooldownWindowSize: 3
            }
        }
    ],
    messageGroups: {
        default: ['Hello from config test']
    }
};

const setup: DesktopSetupState = {
    tokenPresent: true,
    tokenStorage: 'secure',
    dataDir: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender',
    secureStorePath: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/discord-token.secure',
    envPath: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/.env',
    configPath: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/config.json',
    statePath: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/.sender-state.json',
    logsDir: 'C:/Users/Test/AppData/Roaming/com.local.discord-auto-message-sender/logs'
};

const runtime: RuntimeOptions = {
    numMessages: 1,
    baseWaitSeconds: 1800,
    marginSeconds: 2
};

function createDraft(overrides: Partial<ConfigDraftController> = {}): ConfigDraftController {
    const selectedChannel = overrides.selectedChannel === undefined ? baseConfig.channels[0] : overrides.selectedChannel;

    return {
        state: {
            config: baseConfig,
            selectedChannelId: selectedChannel?.id ?? null,
            selectedGroupName: 'default',
            newGroupName: '',
            cloneGroupName: '',
            importDraft: '',
            importPreview: null
        },
        validationErrors: [],
        selectedChannel,
        selectedGroupMessages: ['Hello from config test'],
        exportConfig: JSON.stringify(baseConfig, null, 2),
        importPreviewErrors: [],
        error: null,
        clearError: vi.fn(),
        hydrate: vi.fn(),
        patchUserAgent: vi.fn(),
        addChannel: vi.fn(),
        updateChannel: vi.fn(),
        updateChannelSchedule: vi.fn(),
        removeChannel: vi.fn(),
        setSelectedChannel: vi.fn(),
        setSelectedGroup: vi.fn(),
        setNewGroupName: vi.fn(),
        setCloneGroupName: vi.fn(),
        addGroup: vi.fn(),
        renameGroup: vi.fn(),
        cloneGroup: vi.fn(),
        removeGroup: vi.fn(),
        updateMessage: vi.fn(),
        addMessage: vi.fn(),
        moveMessage: vi.fn(),
        removeMessage: vi.fn(),
        setImportDraft: vi.fn(),
        previewImport: vi.fn(),
        applyImport: vi.fn(),
        loadCurrentConfigIntoImport: vi.fn(),
        ...overrides
    };
}

function renderConfigScreen(draft: ConfigDraftController) {
    return render(
        <ConfigScreen
            draft={draft}
            setup={setup}
            environmentDraft=""
            runtime={runtime}
            onEnvironmentDraftChange={() => undefined}
            onSaveEnvironment={() => undefined}
            onClearSecureToken={() => undefined}
            onOpenDataDirectory={() => undefined}
            onSaveConfig={() => undefined}
            onPreviewDryRun={() => undefined}
        />
    );
}

test('ConfigScreen keeps runtime paths and import tools collapsed by default, then expands them on demand', async () => {
    const user = userEvent.setup();
    renderConfigScreen(createDraft());

    expect(screen.getByText('Runtime Paths')).toBeTruthy();
    expect(screen.queryByText('App data')).toBeNull();
    expect(screen.getByRole('button', { name: /Show Import \/ Export/i })).toBeTruthy();
    expect(screen.queryByPlaceholderText('Paste a normalized config JSON document here.')).toBeNull();

    await user.click(screen.getByText('Runtime Paths').closest('button')!);
    expect(screen.getByText('App data')).toBeTruthy();
    expect(screen.getByText(setup.dataDir)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Show Import \/ Export/i }));
    expect(screen.getByRole('button', { name: /Hide Import \/ Export/i })).toBeTruthy();
    expect(screen.getByPlaceholderText('Paste a normalized config JSON document here.')).toBeTruthy();
    expect(screen.getByText('Import Review')).toBeTruthy();
});

test('ConfigScreen shows an explicit empty state when no channel is selected', () => {
    renderConfigScreen(createDraft({ selectedChannel: null }));

    expect(screen.getByText('Select a channel from the left rail or add a new one to start editing send behavior.')).toBeTruthy();
});

test('ConfigScreen keeps the selected channel highlighted in the left rail', () => {
    renderConfigScreen(createDraft());

    const selectedButton = screen.getByText('General').closest('button');
    const secondaryButton = screen.getByText('Black Market').closest('button');

    expect(selectedButton?.className).toContain('border-primary/40');
    expect(secondaryButton?.className).toContain('border-border');
});
