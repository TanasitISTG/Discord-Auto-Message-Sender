import { ChangeEvent } from 'react';
import { Save, Shuffle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { RuntimeOptions } from '@/lib/desktop';
import { Field } from '@/shared/components';
import type { ConfigDraftController } from './use-config-draft';

interface ConfigEditorCardProps {
    draft: ConfigDraftController;
    runtime: RuntimeOptions;
    onSaveConfig(): void | Promise<void>;
    onPreviewDryRun(): void | Promise<void>;
}

export function ConfigEditorCard({
    draft,
    runtime,
    onSaveConfig,
    onPreviewDryRun
}: ConfigEditorCardProps) {
    const selectedChannel = draft.selectedChannel;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Config Editor</CardTitle>
                <CardDescription>Keep the main authoring flow focused on the selected channel instead of fighting the page layout.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <label className="block space-y-2">
                    <span className="text-sm text-muted-foreground">User-Agent</span>
                    <Input value={draft.state.config.userAgent} onChange={(event: ChangeEvent<HTMLInputElement>) => draft.patchUserAgent(event.target.value)} />
                </label>

                {selectedChannel ? (
                    <div className="space-y-4 rounded-xl border border-border/50 bg-background/50 p-5 shadow-sm">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                            <div>
                                <div className="text-sm font-semibold tracking-tight text-foreground">Selected Channel</div>
                                <div className="text-xs leading-relaxed text-muted-foreground mt-0.5">Edit identity, referrer, and group mapping from the main canvas.</div>
                            </div>
                            <Button variant="ghost" onClick={() => draft.removeChannel(selectedChannel.id)}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Remove
                            </Button>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Channel name">
                                <Input value={selectedChannel.name} onChange={(event: ChangeEvent<HTMLInputElement>) => draft.updateChannel(selectedChannel.id, 'name', event.target.value)} />
                            </Field>
                            <Field label="Channel ID">
                                <Input value={selectedChannel.id} onChange={(event: ChangeEvent<HTMLInputElement>) => draft.updateChannel(selectedChannel.id, 'id', event.target.value)} />
                            </Field>
                        </div>

                        <Field label="Referrer URL">
                            <Input value={selectedChannel.referrer} onChange={(event: ChangeEvent<HTMLInputElement>) => draft.updateChannel(selectedChannel.id, 'referrer', event.target.value)} />
                        </Field>

                        <Field label="Message group">
                            <select
                                className="flex h-10 w-full rounded-xl border bg-background/60 px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
                                value={selectedChannel.messageGroup}
                                onChange={(event: ChangeEvent<HTMLSelectElement>) => draft.updateChannel(selectedChannel.id, 'messageGroup', event.target.value)}
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
                                    value={selectedChannel.schedule?.intervalSeconds ?? runtime.baseWaitSeconds}
                                    onChange={(event: ChangeEvent<HTMLInputElement>) => draft.updateChannelSchedule(selectedChannel.id, { intervalSeconds: Number(event.target.value) })}
                                />
                            </Field>
                            <Field label="Random margin (sec)">
                                <Input
                                    type="number"
                                    value={selectedChannel.schedule?.randomMarginSeconds ?? runtime.marginSeconds}
                                    onChange={(event: ChangeEvent<HTMLInputElement>) => draft.updateChannelSchedule(selectedChannel.id, { randomMarginSeconds: Number(event.target.value) })}
                                />
                            </Field>
                            <Field label="Timezone">
                                <Input
                                    value={selectedChannel.schedule?.timezone ?? 'UTC'}
                                    onChange={(event: ChangeEvent<HTMLInputElement>) => draft.updateChannelSchedule(selectedChannel.id, { timezone: event.target.value })}
                                />
                            </Field>
                            <Field label="Max sends / day">
                                <Input
                                    type="number"
                                    value={selectedChannel.schedule?.maxSendsPerDay ?? ''}
                                    onChange={(event: ChangeEvent<HTMLInputElement>) => draft.updateChannelSchedule(selectedChannel.id, { maxSendsPerDay: event.target.value ? Number(event.target.value) : null })}
                                />
                            </Field>
                            <Field label="Quiet hours start">
                                <Input
                                    placeholder="22:00"
                                    value={selectedChannel.schedule?.quietHours?.start ?? ''}
                                    onChange={(event: ChangeEvent<HTMLInputElement>) => draft.updateChannelSchedule(selectedChannel.id, {
                                        quietHours: {
                                            start: event.target.value,
                                            end: selectedChannel.schedule?.quietHours?.end ?? '06:00'
                                        }
                                    })}
                                />
                            </Field>
                            <Field label="Quiet hours end">
                                <Input
                                    placeholder="06:00"
                                    value={selectedChannel.schedule?.quietHours?.end ?? ''}
                                    onChange={(event: ChangeEvent<HTMLInputElement>) => draft.updateChannelSchedule(selectedChannel.id, {
                                        quietHours: {
                                            start: selectedChannel.schedule?.quietHours?.start ?? '22:00',
                                            end: event.target.value
                                        }
                                    })}
                                />
                            </Field>
                        </div>
                    </div>
                ) : (
                    <div className="rounded-xl border border-dashed border-border/50 bg-background/50 p-6 text-sm text-muted-foreground text-center">
                        Select a channel from the left rail or add a new one to start editing send behavior.
                    </div>
                )}

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
    );
}
