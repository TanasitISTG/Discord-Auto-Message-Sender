import { ChangeEvent } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/shared/components';
import type { ConfigDraftController } from './use-config-draft';

interface MessageGroupsCardProps {
    draft: ConfigDraftController;
}

export function MessageGroupsCard({ draft }: MessageGroupsCardProps) {
    const groupEntries = Object.entries(draft.state.config.messageGroups);
    const hasGroups = groupEntries.length > 0;
    const hasSelectedGroup = Boolean(hasGroups && draft.state.config.messageGroups[draft.state.selectedGroupName]);

    return (
        <Card className="flex flex-col xl:max-h-[calc(100vh-220px)]">
            <CardHeader>
                <CardTitle>Message Groups</CardTitle>
                <CardDescription>Keep group editing in a bounded side panel so it does not dictate the entire page height.</CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
                <div className="flex gap-2">
                    <Input placeholder="New group name" value={draft.state.newGroupName} onChange={(event: ChangeEvent<HTMLInputElement>) => draft.setNewGroupName(event.target.value)} />
                    <Button variant="secondary" onClick={() => draft.addGroup()}>
                        Add
                    </Button>
                </div>

                {hasGroups ? (
                    <>
                        <div className="grid max-h-44 gap-2 overflow-auto pr-1">
                            {groupEntries.map(([groupName, messages]) => (
                                <button
                                    key={groupName}
                                    className={`rounded-xl border p-3 text-left transition-all ${
                                        draft.state.selectedGroupName === groupName
                                            ? 'border-primary/50 bg-primary/10 shadow-glow-sm'
                                            : 'border-border/50 bg-background/50 hover:border-border/80 hover:bg-accent/50'
                                    }`}
                                    onClick={() => draft.setSelectedGroup(groupName)}
                                >
                                    <div className="font-medium text-foreground">{groupName}</div>
                                    <div className="text-[11px] font-semibold tracking-tight text-muted-foreground mt-0.5">{messages.length} messages</div>
                                </button>
                            ))}
                        </div>

                        <div className="space-y-3 rounded-xl border border-border/50 bg-background/50 p-4 shadow-sm">
                            <Field label="Selected group name">
                                <Input value={draft.state.selectedGroupName} onChange={(event: ChangeEvent<HTMLInputElement>) => draft.renameGroup(event.target.value)} />
                            </Field>
                            <div className="flex gap-2">
                                <Input placeholder="Clone name" value={draft.state.cloneGroupName} onChange={(event: ChangeEvent<HTMLInputElement>) => draft.setCloneGroupName(event.target.value)} />
                                <Button variant="secondary" onClick={() => draft.cloneGroup()}>
                                    Clone
                                </Button>
                            </div>
                            <Button variant="ghost" onClick={() => draft.removeGroup(draft.state.selectedGroupName)}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete Group
                            </Button>
                        </div>

                        <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
                            {draft.selectedGroupMessages.map((message, index) => (
                                <div key={`${draft.state.selectedGroupName}-${index}`} className="rounded-xl border border-border/50 bg-background/50 p-3 shadow-sm transition-colors hover:bg-card/60">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Message {index + 1}</span>
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
                    </>
                ) : (
                    <div className="rounded-xl border border-dashed border-border/50 bg-background/50 p-6 text-sm text-center text-muted-foreground">
                        Create a message group before editing reusable message sets.
                    </div>
                )}

                <Button className="w-full" variant="secondary" onClick={() => draft.addMessage(draft.state.selectedGroupName)} disabled={!hasSelectedGroup}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Message
                </Button>
            </CardContent>
        </Card>
    );
}
