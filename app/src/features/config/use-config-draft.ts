import { useMemo, useReducer, useState } from 'react';
import type { AppConfig } from '@/lib/desktop';
import {
    addChannel as addChannelToConfig,
    addMessageToGroup,
    cloneMessageGroup,
    createMessageGroup,
    deleteMessageGroup,
    importConfig,
    removeChannels,
    removeMessageFromGroup,
    renameMessageGroup,
    reorderGroupMessages,
    updateChannel as updateConfigChannel,
    updateChannelSchedule as updateConfigChannelSchedule,
    updateMessageInGroup,
    updateUserAgent
} from './config-draft-domain';
import { validateAppConfig } from './config-draft-domain';
import { ConfigDraftState, configDraftReducer, createInitialConfigDraftState } from './config-draft-reducer';

function withFallbackGroup(config: AppConfig): string {
    return Object.keys(config.messageGroups)[0] ?? 'default';
}

export interface ConfigDraftController {
    state: ConfigDraftState;
    validationErrors: string[];
    selectedChannel: AppConfig['channels'][number] | null;
    selectedGroupMessages: string[];
    exportConfig: string;
    importPreviewErrors: string[];
    error: string | null;
    clearError(): void;
    hydrate(config: AppConfig): void;
    patchUserAgent(userAgent: string): void;
    addChannel(): void;
    updateChannel(channelId: string, field: 'name' | 'id' | 'referrer' | 'messageGroup', value: string): void;
    updateChannelSchedule(channelId: string, patch: Partial<NonNullable<AppConfig['channels'][number]['schedule']>>): void;
    removeChannel(channelId: string): void;
    setSelectedChannel(channelId: string | null): void;
    setSelectedGroup(groupName: string): void;
    setNewGroupName(value: string): void;
    setCloneGroupName(value: string): void;
    addGroup(): void;
    renameGroup(nextName: string): void;
    cloneGroup(): void;
    removeGroup(groupName: string): void;
    updateMessage(groupName: string, index: number, value: string): void;
    addMessage(groupName: string): void;
    moveMessage(groupName: string, index: number, direction: -1 | 1): void;
    removeMessage(groupName: string, index: number): void;
    setImportDraft(value: string): void;
    previewImport(): void;
    applyImport(): void;
    loadCurrentConfigIntoImport(): void;
}

export function useConfigDraft(initialConfig: AppConfig): ConfigDraftController {
    const [state, dispatch] = useReducer(configDraftReducer, initialConfig, createInitialConfigDraftState);
    const [error, setError] = useState<string | null>(null);

    const selectedChannel = state.config.channels.find((channel) => channel.id === state.selectedChannelId) ?? state.config.channels[0] ?? null;
    const selectedGroupMessages = state.config.messageGroups[state.selectedGroupName] ?? [];
    const validationErrors = useMemo(() => validateAppConfig(state.config), [state.config]);
    const exportConfig = useMemo(() => JSON.stringify(state.config, null, 2), [state.config]);
    const importPreviewErrors = useMemo(() => state.importPreview ? validateAppConfig(state.importPreview) : [], [state.importPreview]);

    function runConfigUpdate(
        recipe: () => { config: AppConfig; selectedChannelId?: string | null; selectedGroupName?: string }
    ) {
        try {
            const next = recipe();
            dispatch({
                type: 'replace_config',
                config: next.config,
                selectedChannelId: next.selectedChannelId,
                selectedGroupName: next.selectedGroupName
            });
            setError(null);
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
    }

    return {
        state,
        validationErrors,
        selectedChannel,
        selectedGroupMessages,
        exportConfig,
        importPreviewErrors,
        error,
        clearError() {
            setError(null);
        },
        hydrate(config) {
            dispatch({ type: 'hydrate', config });
            setError(null);
        },
        patchUserAgent(userAgent) {
            runConfigUpdate(() => ({
                config: updateUserAgent(state.config, userAgent)
            }));
        },
        addChannel() {
            const fallbackGroup = withFallbackGroup(state.config);
            const channelId = `new-${Date.now()}`;
            runConfigUpdate(() => ({
                config: addChannelToConfig(state.config, {
                    name: 'New channel',
                    id: channelId,
                    referrer: 'https://discord.com/channels/@me/000000000000000000',
                    messageGroup: fallbackGroup,
                    schedule: {
                        intervalSeconds: 5,
                        randomMarginSeconds: 2,
                        timezone: 'UTC',
                        maxSendsPerDay: null,
                        cooldownWindowSize: 3
                    }
                }),
                selectedChannelId: channelId
            }));
        },
        updateChannel(channelId, field, value) {
            runConfigUpdate(() => ({
                config: updateConfigChannel(state.config, channelId, { [field]: value }),
                selectedChannelId: field === 'id' && state.selectedChannelId === channelId ? value : undefined
            }));
        },
        updateChannelSchedule(channelId, patch) {
            runConfigUpdate(() => ({
                config: updateConfigChannelSchedule(state.config, channelId, patch)
            }));
        },
        removeChannel(channelId) {
            runConfigUpdate(() => ({
                config: removeChannels(state.config, [channelId]),
                selectedChannelId: state.config.channels.find((channel) => channel.id !== channelId)?.id ?? null
            }));
        },
        setSelectedChannel(channelId) {
            dispatch({ type: 'set_selected_channel', channelId });
        },
        setSelectedGroup(groupName) {
            dispatch({ type: 'set_selected_group', groupName });
        },
        setNewGroupName(value) {
            dispatch({ type: 'set_new_group_name', value });
        },
        setCloneGroupName(value) {
            dispatch({ type: 'set_clone_group_name', value });
        },
        addGroup() {
            const groupName = state.newGroupName.trim();
            if (!groupName) {
                setError('Enter a group name before adding it.');
                return;
            }

            runConfigUpdate(() => ({
                config: createMessageGroup(state.config, groupName),
                selectedGroupName: groupName
            }));
            dispatch({ type: 'set_new_group_name', value: '' });
        },
        renameGroup(nextName) {
            const normalizedName = nextName.trim();
            if (!normalizedName || normalizedName === state.selectedGroupName) {
                return;
            }

            runConfigUpdate(() => ({
                config: renameMessageGroup(state.config, state.selectedGroupName, normalizedName),
                selectedGroupName: normalizedName
            }));
        },
        cloneGroup() {
            const cloneName = state.cloneGroupName.trim();
            if (!cloneName) {
                setError('Enter a clone name first.');
                return;
            }

            runConfigUpdate(() => ({
                config: cloneMessageGroup(state.config, state.selectedGroupName, cloneName)
            }));
            dispatch({ type: 'set_clone_group_name', value: '' });
        },
        removeGroup(groupName) {
            const nextConfig = deleteMessageGroup(state.config, groupName);
            runConfigUpdate(() => ({
                config: nextConfig,
                selectedGroupName: Object.keys(nextConfig.messageGroups)[0] ?? 'default'
            }));
        },
        updateMessage(groupName, index, value) {
            runConfigUpdate(() => ({
                config: updateMessageInGroup(state.config, groupName, index, value)
            }));
        },
        addMessage(groupName) {
            runConfigUpdate(() => ({
                config: addMessageToGroup(state.config, groupName)
            }));
        },
        moveMessage(groupName, index, direction) {
            const nextIndex = index + direction;
            if (nextIndex < 0 || nextIndex >= (state.config.messageGroups[groupName]?.length ?? 0)) {
                return;
            }

            runConfigUpdate(() => ({
                config: reorderGroupMessages(state.config, groupName, index, nextIndex)
            }));
        },
        removeMessage(groupName, index) {
            runConfigUpdate(() => ({
                config: removeMessageFromGroup(state.config, groupName, index)
            }));
        },
        setImportDraft(value) {
            dispatch({ type: 'set_import_draft', value });
        },
        previewImport() {
            try {
                const nextConfig = importConfig(JSON.parse(state.importDraft));
                dispatch({ type: 'set_import_preview', value: nextConfig });
                setError(null);
            } catch (nextError) {
                dispatch({ type: 'set_import_preview', value: null });
                setError(nextError instanceof Error ? nextError.message : String(nextError));
            }
        },
        applyImport() {
            if (!state.importPreview) {
                setError('Preview an import before applying it.');
                return;
            }

            const previewErrors = validateAppConfig(state.importPreview);
            if (previewErrors.length > 0) {
                setError(previewErrors[0]);
                return;
            }

            dispatch({
                type: 'replace_config',
                config: state.importPreview,
                selectedChannelId: state.importPreview.channels[0]?.id ?? null,
                selectedGroupName: Object.keys(state.importPreview.messageGroups)[0] ?? 'default'
            });
            dispatch({ type: 'set_import_draft', value: JSON.stringify(state.importPreview, null, 2) });
            dispatch({ type: 'set_import_preview', value: null });
            setError(null);
        },
        loadCurrentConfigIntoImport() {
            dispatch({ type: 'set_import_draft', value: JSON.stringify(state.config, null, 2) });
            dispatch({ type: 'set_import_preview', value: null });
            setError(null);
        }
    };
}
