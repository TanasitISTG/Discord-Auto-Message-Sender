import * as React from 'react';
import { cn } from '@/lib/cn';

const badgeTone = {
    neutral: 'border-border bg-accent text-foreground',
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    danger: 'border-red-500/30 bg-red-500/10 text-red-300'
} as const;

export function Badge({
    className,
    tone = 'neutral',
    ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof badgeTone }) {
    const resolvedTone: keyof typeof badgeTone = tone;
    return (
        <div
            className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium uppercase tracking-[0.18em]', badgeTone[resolvedTone], className)}
            {...props}
        />
    );
}
