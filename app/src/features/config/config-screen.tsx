import { useState } from 'react';
import type { SurfaceNotice } from '@/controllers/desktop/types';
import type { DesktopSetupState, RuntimeOptions } from '@/lib/desktop';
import type { SetupChecklist, TokenReadiness } from '@/shared/readiness';
import { InlineNotice } from '@/shared/components';
import { SetupChecklistCard } from '@/shared/setup-checklist-card';
import { AdvancedConfigToolsCard } from './advanced-config-tools-card';
import { ChannelsCard } from './channels-card';
import { ConfigEditorCard } from './config-editor-card';
import { DesktopSetupCard } from './desktop-setup-card';
import { MessageGroupsCard } from './message-groups-card';
import type { ConfigDraftController } from './use-config-draft';

interface ConfigScreenProps {
    draft: ConfigDraftController;
    setup: DesktopSetupState | null;
    tokenStatus: TokenReadiness;
    setupChecklist: SetupChecklist;
    notice?: SurfaceNotice;
    environmentDraft: string;
    runtime: RuntimeOptions;
    onEnvironmentDraftChange(nextValue: string): void;
    onSaveEnvironment(): void | Promise<void>;
    onClearSecureToken(): void | Promise<void>;
    onOpenDataDirectory(): void | Promise<void>;
    onOpenConfig(): void;
    onRunPreflight(): void | Promise<void>;
    onOpenSession(): void;
    onSaveConfig(): void | Promise<void>;
    onPreviewDryRun(): void | Promise<void>;
}

export function ConfigScreen({
    draft,
    setup,
    tokenStatus,
    setupChecklist,
    notice,
    environmentDraft,
    runtime,
    onEnvironmentDraftChange,
    onSaveEnvironment,
    onClearSecureToken,
    onOpenDataDirectory,
    onOpenConfig,
    onRunPreflight,
    onOpenSession,
    onSaveConfig,
    onPreviewDryRun
}: ConfigScreenProps) {
    const [showToken, setShowToken] = useState(false);
    const [showRuntimePaths, setShowRuntimePaths] = useState(false);
    const [showAdvancedTools, setShowAdvancedTools] = useState(false);

    return (
        <section className="space-y-4">
            <SetupChecklistCard
                checklist={setupChecklist}
                currentScreen="config"
                onOpenConfig={onOpenConfig}
                onRunPreflight={onRunPreflight}
                onOpenSession={onOpenSession}
            />

            {notice ? <InlineNotice tone={notice.tone} message={notice.message} /> : null}

            <div className="grid items-start gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                <div className="space-y-4">
                <DesktopSetupCard
                    setup={setup}
                    tokenStatus={tokenStatus}
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
            </div>
        </section>
    );
}
