import { useState } from 'react';
import type { DesktopSetupState, RuntimeOptions } from '@/lib/desktop';
import { AdvancedConfigToolsCard } from './advanced-config-tools-card';
import { ChannelsCard } from './channels-card';
import { ConfigEditorCard } from './config-editor-card';
import { DesktopSetupCard } from './desktop-setup-card';
import { MessageGroupsCard } from './message-groups-card';
import type { ConfigDraftController } from './use-config-draft';

interface ConfigScreenProps {
    draft: ConfigDraftController;
    setup: DesktopSetupState | null;
    environmentDraft: string;
    runtime: RuntimeOptions;
    onEnvironmentDraftChange(nextValue: string): void;
    onSaveEnvironment(): void | Promise<void>;
    onClearSecureToken(): void | Promise<void>;
    onOpenDataDirectory(): void | Promise<void>;
    onSaveConfig(): void | Promise<void>;
    onPreviewDryRun(): void | Promise<void>;
}

export function ConfigScreen({
    draft,
    setup,
    environmentDraft,
    runtime,
    onEnvironmentDraftChange,
    onSaveEnvironment,
    onClearSecureToken,
    onOpenDataDirectory,
    onSaveConfig,
    onPreviewDryRun
}: ConfigScreenProps) {
    const [showToken, setShowToken] = useState(false);
    const [showRuntimePaths, setShowRuntimePaths] = useState(false);
    const [showAdvancedTools, setShowAdvancedTools] = useState(false);

    return (
        <section className="grid items-start gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-4">
                <DesktopSetupCard
                    setup={setup}
                    environmentDraft={environmentDraft}
                    showToken={showToken}
                    showRuntimePaths={showRuntimePaths}
                    onToggleToken={() => setShowToken((current) => !current)}
                    onToggleRuntimePaths={() => setShowRuntimePaths((current) => !current)}
                    onEnvironmentDraftChange={onEnvironmentDraftChange}
                    onSaveEnvironment={onSaveEnvironment}
                    onClearSecureToken={onClearSecureToken}
                    onOpenDataDirectory={onOpenDataDirectory}
                />

                <ChannelsCard
                    channels={draft.state.config.channels}
                    selectedChannelId={draft.selectedChannel?.id ?? draft.state.selectedChannelId}
                    onAddChannel={() => draft.addChannel()}
                    onSelectChannel={(channelId) => draft.setSelectedChannel(channelId)}
                />
            </div>

            <div className="space-y-4">
                <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <ConfigEditorCard
                        draft={draft}
                        runtime={runtime}
                        onSaveConfig={onSaveConfig}
                        onPreviewDryRun={onPreviewDryRun}
                    />

                    <MessageGroupsCard draft={draft} />
                </div>

                <AdvancedConfigToolsCard
                    draft={draft}
                    showAdvancedTools={showAdvancedTools}
                    onToggleAdvancedTools={() => setShowAdvancedTools((current) => !current)}
                />
            </div>
        </section>
    );
}
