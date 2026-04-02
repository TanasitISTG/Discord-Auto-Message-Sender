import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { AppReadiness } from '@/shared/readiness';
import { describeBlockingIssue } from '@/shared/readiness';

interface DashboardReadinessCardProps {
    appReadiness: AppReadiness;
    runtimeMessage?: string | null;
    onOpenConfig(): void;
}

export function DashboardReadinessCard({ appReadiness, runtimeMessage, onOpenConfig }: DashboardReadinessCardProps) {
    if (appReadiness.blockingIssues.length === 0 && appReadiness.warnings.length === 0 && !runtimeMessage) {
        return null;
    }

    return (
        <Card className="md:col-span-2 xl:col-span-4">
            <CardHeader>
                <CardTitle>Release Readiness</CardTitle>
                <CardDescription>
                    Packaged-app prerequisites and runtime recovery are surfaced here before you start a session.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {appReadiness.blockingIssues.map((issue) => (
                    <div
                        key={issue}
                        className="rounded-md border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100"
                    >
                        <div className="font-medium">{describeBlockingIssue(issue)}</div>
                        {issue === 'token_missing' || issue === 'config_missing' || issue === 'config_invalid' ? (
                            <Button size="sm" variant="secondary" className="mt-3" onClick={onOpenConfig}>
                                Open Config
                            </Button>
                        ) : null}
                    </div>
                ))}
                {runtimeMessage ? (
                    <div className="rounded-md border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">
                        {runtimeMessage}
                    </div>
                ) : null}
                {appReadiness.warnings
                    .filter((warning) => warning !== runtimeMessage)
                    .map((warning) => (
                        <div
                            key={warning}
                            className="rounded-md border border-border bg-transparent p-4 text-sm text-muted-foreground"
                        >
                            {warning}
                        </div>
                    ))}
            </CardContent>
        </Card>
    );
}
