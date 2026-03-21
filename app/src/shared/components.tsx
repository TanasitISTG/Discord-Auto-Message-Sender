import { ChangeEvent, ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
    return (
        <Card>
            <CardHeader>
                <CardDescription>{label}</CardDescription>
                <CardTitle className="text-3xl">{value}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{detail}</CardContent>
        </Card>
    );
}

export function ActionTile({ title, detail, onClick }: { title: string; detail: string; onClick: () => void | Promise<void> }) {
    return (
        <button className="rounded-2xl border border-border bg-background/40 p-4 text-left transition hover:border-primary/30 hover:bg-accent" onClick={() => void onClick()}>
            <div className="mb-2 text-sm font-semibold">{title}</div>
            <div className="text-sm text-muted-foreground">{detail}</div>
        </button>
    );
}

export function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (nextValue: string) => void }) {
    return (
        <label className="space-y-2 text-sm text-muted-foreground">
            <span>{label}</span>
            <Input type="number" value={value} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} />
        </label>
    );
}

export function StateRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium text-foreground">{value}</span>
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
