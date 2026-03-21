import { ChangeEvent } from 'react';
import { ChevronDown, ChevronUp, FolderOpen, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { DesktopSetupState } from '@/lib/desktop';
import { DetailBlock, Field, StateRow } from '@/shared/components';

interface DesktopSetupCardProps {
    setup: DesktopSetupState | null;
    environmentDraft: string;
    showToken: boolean;
    showRuntimePaths: boolean;
    onToggleToken(): void;
    onToggleRuntimePaths(): void;
    onEnvironmentDraftChange(nextValue: string): void;
    onSaveEnvironment(): void | Promise<void>;
    onClearSecureToken(): void | Promise<void>;
    onOpenDataDirectory(): void | Promise<void>;
}

export function DesktopSetupCard({
    setup,
    environmentDraft,
    showToken,
    showRuntimePaths,
    onToggleToken,
    onToggleRuntimePaths,
    onEnvironmentDraftChange,
    onSaveEnvironment,
    onClearSecureToken,
    onOpenDataDirectory
}: DesktopSetupCardProps) {
    const tokenSourceLabel = setup
        ? {
            secure: 'Secure store',
            environment: 'Environment fallback',
            missing: 'Missing'
        }[setup.tokenStorage]
        : 'Loading';

    return (
        <Card>
            <CardHeader>
                <CardTitle>Desktop Setup</CardTitle>
                <CardDescription>Store the Discord token securely for this Windows user profile without turning config editing into a diagnostics wall.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <StateRow label="Discord token" value={setup?.tokenPresent ? 'configured' : 'missing'} />
                <StateRow label="Token source" value={tokenSourceLabel} />

                <Field label="DISCORD_TOKEN">
                    <div className="flex gap-2">
                        <Input
                            className="min-w-0 flex-1"
                            type={showToken ? 'text' : 'password'}
                            value={environmentDraft}
                            placeholder={setup?.tokenPresent ? 'Paste a new token to replace the stored one' : 'Paste your personal Discord token'}
                            onChange={(event: ChangeEvent<HTMLInputElement>) => onEnvironmentDraftChange(event.target.value)}
                        />
                        <Button variant="secondary" onClick={onToggleToken}>
                            {showToken ? 'Hide' : 'Show'}
                        </Button>
                    </div>
                </Field>

                <div className="grid gap-3">
                    <Button className="w-full" onClick={onSaveEnvironment} disabled={!environmentDraft.trim()}>
                        <Save className="mr-2 h-4 w-4" />
                        Save Token Securely
                    </Button>
                    {setup?.tokenPresent ? (
                        <Button className="w-full" variant="secondary" onClick={onClearSecureToken}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Remove Token
                        </Button>
                    ) : null}
                    <Button className="w-full" variant="secondary" onClick={onOpenDataDirectory}>
                        <FolderOpen className="mr-2 h-4 w-4" />
                        Open Data Folder
                    </Button>
                </div>

                <div className="text-xs leading-relaxed text-muted-foreground">
                    The token field stays blank after save. The packaged app stores the token outside `config.json` and does not echo it back into the UI.
                </div>

                {setup?.warning ? (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
                        {setup.warning}
                    </div>
                ) : null}

                <div className="rounded-2xl border border-border bg-background/30 p-4">
                    <button
                        className="flex w-full items-center justify-between gap-3 text-left"
                        onClick={onToggleRuntimePaths}
                    >
                        <div>
                            <div className="text-sm font-semibold text-foreground">Runtime Paths</div>
                            <div className="text-xs text-muted-foreground">App-data locations stay available here, but collapsed until you need them.</div>
                        </div>
                        <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            {showRuntimePaths ? 'Hide' : 'View'}
                            {showRuntimePaths ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </span>
                    </button>

                    {showRuntimePaths ? (
                        <div className="mt-4 space-y-3">
                            {setup ? (
                                <>
                                    <DetailBlock label="App data" value={setup.dataDir} />
                                    <DetailBlock label="Secure token store" value={setup.secureStorePath} />
                                    <DetailBlock label=".env path" value={setup.envPath} />
                                    <DetailBlock label="Config path" value={setup.configPath} />
                                    <DetailBlock label="State path" value={setup.statePath} />
                                    <DetailBlock label="Logs dir" value={setup.logsDir} />
                                </>
                            ) : (
                                <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                                    Loading desktop setup details...
                                </div>
                            )}
                        </div>
                    ) : null}
                </div>
            </CardContent>
        </Card>
    );
}
