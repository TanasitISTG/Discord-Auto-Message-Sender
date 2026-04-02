import { ChangeEvent, ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
    return (
        <Card className="flex flex-col justify-between">
            <CardHeader className="pb-2">
                <CardDescription className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {label}
                </CardDescription>
                <CardTitle className="text-3xl font-bold tracking-tight text-foreground">{value}</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="text-xs text-muted-foreground">{detail}</div>
            </CardContent>
        </Card>
    );
}

export function ActionTile({
    title,
    detail,
    onClick,
}: {
    title: string;
    detail: string;
    onClick: () => void | Promise<void>;
}) {
    return (
        <button
            className="group rounded-md border border-border bg-transparent p-5 text-left transition-colors hover:bg-zinc-900"
            onClick={() => void onClick()}
        >
            <div className="mb-1.5 text-sm font-semibold tracking-tight text-foreground transition-colors group-hover:text-foreground">
                {title}
            </div>
            <div className="text-xs leading-relaxed text-muted-foreground">{detail}</div>
        </button>
    );
}

export function NumberField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: number;
    onChange: (nextValue: string) => void;
}) {
    return (
        <label className="space-y-2 text-sm text-muted-foreground">
            <span>{label}</span>
            <Input
                type="number"
                value={value}
                onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
            />
        </label>
    );
}

export function StateRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-transparent px-3 py-2.5 transition-colors hover:bg-zinc-900">
            <span className="min-w-0 text-xs font-medium text-muted-foreground">{label}</span>
            <span className="min-w-0 wrap-break-word text-right text-sm font-semibold text-foreground">{value}</span>
        </div>
    );
}

export function DetailBlock({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border border-border bg-transparent p-4 transition-colors hover:bg-zinc-900">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
            <div className="mt-2 break-all font-mono text-xs leading-relaxed text-foreground/90">{value}</div>
        </div>
    );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block space-y-2">
            <span className="text-sm text-muted-foreground">{label}</span>
            {children}
        </label>
    );
}

export function InlineNotice({
    tone,
    message,
}: {
    tone: 'neutral' | 'success' | 'warning' | 'danger';
    message: string;
}) {
    const toneClass = {
        neutral: 'border-border bg-transparent text-foreground/80',
        success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100',
        warning: 'border-amber-500/20 bg-amber-500/10 text-amber-100',
        danger: 'border-red-500/20 bg-red-500/10 text-red-100',
    }[tone];

    return <div className={`rounded-md border px-4 py-3 text-sm ${toneClass}`}>{message}</div>;
}
