import { ChangeEvent } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { StateRow } from '@/shared/components';
import type { ConfigDraftController } from './use-config-draft';

interface AdvancedConfigToolsCardProps {
    draft: ConfigDraftController;
    showAdvancedTools: boolean;
    onToggleAdvancedTools(): void;
}

export function AdvancedConfigToolsCard({
    draft,
    showAdvancedTools,
    onToggleAdvancedTools
}: AdvancedConfigToolsCardProps) {
    return (
        <Card>
            <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <CardTitle>Advanced Config Tools</CardTitle>
                    <CardDescription>Import and export stay tucked away until you need to review or replace a large config draft.</CardDescription>
                </div>
                <Button variant="secondary" size="sm" onClick={onToggleAdvancedTools}>
                    {showAdvancedTools ? (
                        <>
                            <ChevronUp className="mr-2 h-4 w-4" />
                            Hide Import / Export
                        </>
                    ) : (
                        <>
                            <ChevronDown className="mr-2 h-4 w-4" />
                            Show Import / Export
                        </>
                    )}
                </Button>
            </CardHeader>

            {showAdvancedTools ? (
                <CardContent className="space-y-4">
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                        <div className="grid gap-4 xl:grid-cols-2">
                            <div className="space-y-2">
                                <div className="text-sm font-medium">Normalized export</div>
                                <Textarea className="min-h-[360px] font-mono text-xs" readOnly value={draft.exportConfig} />
                            </div>
                            <div className="space-y-2">
                                <div className="text-sm font-medium">Import buffer</div>
                                <Textarea
                                    className="min-h-[360px] font-mono text-xs"
                                    placeholder="Paste a normalized config JSON document here."
                                    value={draft.state.importDraft}
                                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) => draft.setImportDraft(event.target.value)}
                                />
                            </div>
                        </div>

                        <div className="rounded-2xl border border-border bg-background/20 p-4">
                            <div className="mb-3 text-sm font-semibold">Import Review</div>
                            <div className="space-y-3 text-sm">
                                {!draft.state.importPreview ? (
                                    <div className="rounded-xl border border-dashed border-border p-4 text-muted-foreground">
                                        Preview an import to inspect channel and group counts before it replaces the current local draft.
                                    </div>
                                ) : (
                                    <>
                                        <StateRow label="Channels" value={String(draft.state.importPreview.channels.length)} />
                                        <StateRow label="Message groups" value={String(Object.keys(draft.state.importPreview.messageGroups).length)} />
                                        <StateRow label="Messages" value={String(Object.values(draft.state.importPreview.messageGroups).reduce((total, messages) => total + messages.length, 0))} />
                                        <StateRow label="Validation" value={draft.importPreviewErrors.length === 0 ? 'ready' : `${draft.importPreviewErrors.length} issue(s)`} />
                                        {draft.importPreviewErrors.length > 0 ? (
                                            <div className="space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-amber-200">
                                                {draft.importPreviewErrors.map((error) => <div key={error}>{error}</div>)}
                                            </div>
                                        ) : (
                                            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-emerald-200">
                                                Import preview is valid. Apply it locally, then use Save Config to persist it through Tauri.
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <Button variant="secondary" onClick={() => draft.loadCurrentConfigIntoImport()}>
                            Load current config
                        </Button>
                        <Button variant="secondary" onClick={() => draft.previewImport()} disabled={!draft.state.importDraft.trim()}>
                            Preview import
                        </Button>
                        <Button onClick={() => draft.applyImport()} disabled={!draft.state.importPreview || draft.importPreviewErrors.length > 0}>
                            Apply preview locally
                        </Button>
                    </div>
                </CardContent>
            ) : null}
        </Card>
    );
}
