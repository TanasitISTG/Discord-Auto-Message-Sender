import type { AppConfig } from '@/lib/desktop';

export interface ConfigDraftState {
    config: AppConfig;
    selectedChannelId: string | null;
    selectedGroupName: string;
    newGroupName: string;
    cloneGroupName: string;
    importDraft: string;
    importPreview: AppConfig | null;
}

export type ConfigDraftAction =
    | { type: 'hydrate'; config: AppConfig }
    | { type: 'replace_config'; config: AppConfig; selectedChannelId?: string | null; selectedGroupName?: string }
    | { type: 'set_selected_channel'; channelId: string | null }
    | { type: 'set_selected_group'; groupName: string }
    | { type: 'set_new_group_name'; value: string }
    | { type: 'set_clone_group_name'; value: string }
    | { type: 'set_import_draft'; value: string }
    | { type: 'set_import_preview'; value: AppConfig | null };

function syncSelection(
    state: Omit<ConfigDraftState, 'config'>,
    config: AppConfig,
    selectedChannelId?: string | null,
    selectedGroupName?: string,
): ConfigDraftState {
    const nextChannelId =
        selectedChannelId === undefined
            ? (config.channels.find((channel) => channel.id === state.selectedChannelId)?.id ??
              config.channels[0]?.id ??
              null)
            : (config.channels.find((channel) => channel.id === selectedChannelId)?.id ??
              config.channels[0]?.id ??
              null);
    const nextGroupName =
        selectedGroupName === undefined
            ? config.messageGroups[state.selectedGroupName]
                ? state.selectedGroupName
                : (Object.keys(config.messageGroups)[0] ?? 'default')
            : config.messageGroups[selectedGroupName]
              ? selectedGroupName
              : (Object.keys(config.messageGroups)[0] ?? 'default');

    return {
        ...state,
        config,
        selectedChannelId: nextChannelId,
        selectedGroupName: nextGroupName,
    };
}

export function createInitialConfigDraftState(config: AppConfig): ConfigDraftState {
    return {
        config,
        selectedChannelId: config.channels[0]?.id ?? null,
        selectedGroupName: Object.keys(config.messageGroups)[0] ?? 'default',
        newGroupName: '',
        cloneGroupName: '',
        importDraft: '',
        importPreview: null,
    };
}

export function configDraftReducer(state: ConfigDraftState, action: ConfigDraftAction): ConfigDraftState {
    switch (action.type) {
        case 'hydrate':
            return {
                ...createInitialConfigDraftState(action.config),
                importDraft: state.importDraft,
            };
        case 'replace_config':
            return syncSelection(
                {
                    ...state,
                    importPreview: null,
                },
                action.config,
                action.selectedChannelId,
                action.selectedGroupName,
            );
        case 'set_selected_channel':
            return {
                ...state,
                selectedChannelId: action.channelId,
            };
        case 'set_selected_group':
            return {
                ...state,
                selectedGroupName: action.groupName,
            };
        case 'set_new_group_name':
            return {
                ...state,
                newGroupName: action.value,
            };
        case 'set_clone_group_name':
            return {
                ...state,
                cloneGroupName: action.value,
            };
        case 'set_import_draft':
            return {
                ...state,
                importDraft: action.value,
            };
        case 'set_import_preview':
            return {
                ...state,
                importPreview: action.value,
            };
        default:
            return state;
    }
}
