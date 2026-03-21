import { ChangeEvent } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Shuffle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { RuntimeOptions } from '@/lib/desktop';
import { Field, StateRow } from '@/shared/components';
import type { ConfigDraftController } from './use-config-draft';

interface ConfigScreenProps {
    draft: ConfigDraftController;
    runtime: RuntimeOptions;
    onSaveConfig(): void | Promise<void>;
    onPreviewDryRun(): void | Promise<void>;
}

export function ConfigScreen({ draft, runtime, onSaveConfig, onPreviewDryRun }: ConfigScreenProps) {
    return (
        <>
            <section className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)_380px]">
                <Card>
                    <CardHeader>
                        <CardTitle>Channels</CardTitle>
                        <CardDescription>Assign each channel to a message group and keep the send path editable without raw JSON.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <Button className="w-full" variant="secondary" onClick={() => draft.addChannel()}>
                            <Plus className="mr-2 h-4 w-4" />
                            Add Channel
                        </Button>
                        <div className="space-y-2">
                            {draft.state.config.channels.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No channels configured yet.</div>
                            ) : draft.state.config.channels.map((channel) => (
                                <button
                                    key={channel.id}
                                    className={`w-full rounded-xl border p-3 text-left ${
                                        draft.selectedChannel?.id === channel.id ? 'border-primary/40 bg-primary/10' : 'border-border bg-background/30'
                                    }`}
                                    onClick={() => draft.setSelectedChannel(channel.id)}
                                >
                                    <div className="font-medium">{channel.name || 'Unnamed channel'}</div>
                                    <div className="mt-1 font-mono text-xs text-muted-foreground">{channel.id}</div>
                                    <div className="mt-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">{channel.messageGroup}</div>
                                </button>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Config Editor</CardTitle>
                        <CardDescription>Inline validation blocks invalid saves, and every edit stays local until you hit save.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <label className="block space-y-2">
                            <span className="text-sm text-muted-foreground">User-Agent</span>
                            <Input value={draft.state.config.userAgent} onChange={(event: ChangeEvent<HTMLInputElement>) => draft.patchUserAgent(event.target.value)} />
                        </label>

                        {draft.selectedChannel ? (
                            <div className="space-y-4 rounded-2xl border border-border bg-background/30 p-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm font-semibold">Selected Channel</div>
                                        <div className="text-xs text-muted-foreground">Edit identity, referrer, and group mapping.</div>
                                    </div>
                                    <Button variant="ghost" onClick={() => draft.removeChannel(draft.selectedChannel!.id)}>
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Remove
                                    </Button>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <Field label="Channel name">
                                        <Input value={draft.selectedChannel.name} onChange={(event: ChangeEvent<HTMLInputElement>) => draft.updateChannel(draft.selectedChannel!.id, 'name', event.target.value)} />
                                    </Field>
                                    <Field label="Channel ID">
                                        <Input value={draft.selectedChannel.id} onChange={(event: ChangeEvent<HTMLInputElement>) => draft.updateChannel(draft.selectedChannel!.id, 'id', event.target.value)} />
                                    </Field>
                                </div>

                                <Field label="Referrer URL">
                                    <Input value={draft.selectedChannel.referrer} onChange={(event: ChangeEvent<HTMLInputElement>) => draft.updateChannel(draft.selectedChannel!.id, 'referrer', event.target.value)} />
                                </Field>

                                <Field label="Message group">
                                    <select
                                        className="flex h-10 w-full rounded-xl border bg-background/60 px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
                                        value={draft.selectedChannel.messageGroup}
                                        onChange={(event: ChangeEvent<HTMLSelectElement>) => draft.updateChannel(draft.selectedChannel!.id, 'messageGroup', event.target.value)}
                                    >
                                        {Object.keys(draft.state.config.messageGroups).map((groupName) => (
                                            <option key={groupName} value={groupName}>{groupName}</option>
                                        ))}
                                    </select>
                                </Field>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <Field label="Saved interval (sec)">
                                        <Input
                                            type="number"
                                            value={draft.selectedChannel.schedule?.intervalSeconds ?? runtime.baseWaitSeconds}
                                            onChange={(event: ChangeEvent<HTMLInputElement>) => draft.updateChannelSchedule(draft.selectedChannel!.id, { intervalSeconds: Number(event.target.value) })}
                                        />
                                    </Field>
                                    <Field label="Random margin (sec)">
                                        <Input
                                            type="number"
                                            value={draft.selectedChannel.schedule?.randomMarginSeconds ?? runtime.marginSeconds}
                                            onChange={(event: ChangeEvent<HTMLInputElement>) => draft.updateChannelSchedule(draft.selectedChannel!.id, { randomMarginSeconds: Number(event.target.value) })}
                                        />
                                    </Field>
                                    <Field label="Timezone">
                                        <Input
                                            value={draft.selectedChannel.schedule?.timezone ?? 'UTC'}
                                            onChange={(event: ChangeEvent<HTMLInputElement>) => draft.updateChannelSchedule(draft.selectedChannel!.id, { timezone: event.target.value })}
                                        />
                                    </Field>
                                    <Field label="Max sends / day">
                                        <Input
                                            type="number"
                                            value={draft.selectedChannel.schedule?.maxSendsPerDay ?? ''}
                                            onChange={(event: ChangeEvent<HTMLInputElement>) => draft.updateChannelSchedule(draft.selectedChannel!.id, { maxSendsPerDay: event.target.value ? Number(event.target.value) : null })}
                                        />
                                    </Field>
                                    <Field label="Quiet hours start">
                                        <Input
                                            placeholder="22:00"
                                            value={draft.selectedChannel.schedule?.quietHours?.start ?? ''}
                                            onChange={(event: ChangeEvent<HTMLInputElement>) => draft.updateChannelSchedule(draft.selectedChannel!.id, {
                                                quietHours: {
                                                    start: event.target.value,
                                                    end: draft.selectedChannel?.schedule?.quietHours?.end ?? '06:00'
                                                }
                                            })}
                                        />
                                    </Field>
                                    <Field label="Quiet hours end">
                                        <Input
                                            placeholder="06:00"
                                            value={draft.selectedChannel.schedule?.quietHours?.end ?? ''}
                                            onChange={(event: ChangeEvent<HTMLInputElement>) => draft.updateChannelSchedule(draft.selectedChannel!.id, {
                                                quietHours: {
                                                    start: draft.selectedChannel?.schedule?.quietHours?.start ?? '22:00',
                                                    end: event.target.value
                                                }
                                            })}
                                        />
                                    </Field>
                                </div>
                            </div>
                        ) : null}

                        <div className="flex flex-wrap gap-3">
                            <Button onClick={onSaveConfig} disabled={draft.validationErrors.length > 0}>
                                <Save className="mr-2 h-4 w-4" />
                                Save Config
                            </Button>
                            <Button variant="secondary" onClick={onPreviewDryRun}>
                                <Shuffle className="mr-2 h-4 w-4" />
                                Preview Dry Run
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Message Groups</CardTitle>
                        <CardDescription>Rename, clone, reorder, and edit messages from one place.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex gap-2">
                            <Input placeholder="New group name" value={draft.state.newGroupName} onChange={(event: ChangeEvent<HTMLInputElement>) => draft.setNewGroupName(event.target.value)} />
                            <Button variant="secondary" onClick={() => draft.addGroup()}>Add</Button>
                        </div>

                        <div className="grid gap-2">
                            {Object.entries(draft.state.config.messageGroups).map(([groupName, messages]) => (
                                <button
                                    key={groupName}
                                    className={`rounded-xl border p-3 text-left ${draft.state.selectedGroupName === groupName ? 'border-primary/40 bg-primary/10' : 'border-border bg-background/30'}`}
                                    onClick={() => draft.setSelectedGroup(groupName)}
                                >
                                    <div className="font-medium">{groupName}</div>
                                    <div className="text-xs text-muted-foreground">{messages.length} messages</div>
                                </button>
                            ))}
                        </div>

                        <div className="space-y-3 rounded-2xl border border-border bg-background/30 p-4">
                            <Field label="Selected group name">
                                <Input value={draft.state.selectedGroupName} onChange={(event: ChangeEvent<HTMLInputElement>) => draft.renameGroup(event.target.value)} />
                            </Field>
                            <div className="flex gap-2">
                                <Input placeholder="Clone name" value={draft.state.cloneGroupName} onChange={(event: ChangeEvent<HTMLInputElement>) => draft.setCloneGroupName(event.target.value)} />
                                <Button variant="secondary" onClick={() => draft.cloneGroup()}>Clone</Button>
                            </div>
                            <Button variant="ghost" onClick={() => draft.removeGroup(draft.state.selectedGroupName)}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete Group
                            </Button>
                        </div>

                        <div className="space-y-3">
                            {draft.selectedGroupMessages.map((message, index) => (
                                <div key={`${draft.state.selectedGroupName}-${index}`} className="rounded-2xl border border-border bg-background/30 p-3">
                                    <div className="mb-2 flex items-center justify-between">
                                        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Message {index + 1}</span>
                                        <div className="flex gap-2">
                                            <Button variant="ghost" onClick={() => draft.moveMessage(draft.state.selectedGroupName, index, -1)} disabled={index === 0}>
                                                <ArrowUp className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" onClick={() => draft.moveMessage(draft.state.selectedGroupName, index, 1)} disabled={index === draft.selectedGroupMessages.length - 1}>
                                                <ArrowDown className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" onClick={() => draft.removeMessage(draft.state.selectedGroupName, index)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                    <Textarea value={message} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => draft.updateMessage(draft.state.selectedGroupName, index, event.target.value)} />
                                </div>
                            ))}
                        </div>

                        <Button className="w-full" variant="secondary" onClick={() => draft.addMessage(draft.state.selectedGroupName)}>
                            <Plus className="mr-2 h-4 w-4" />
                            Add Message
                        </Button>
                    </CardContent>
                </Card>
            </section>

            <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <Card>
                    <CardHeader>
                        <CardTitle>Import / Export</CardTitle>
                        <CardDescription>Export normalized JSON, preview imports before applying them, and keep high-impact config changes reviewable.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
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
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Import Review</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
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
                    </CardContent>
                </Card>
            </section>
        </>
    );
}
