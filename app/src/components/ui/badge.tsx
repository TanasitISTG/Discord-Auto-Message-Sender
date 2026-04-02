import * as React from 'react';
import { cn } from '@/lib/cn';

const badgeTone = {
    neutral: 'border-zinc-500/20 bg-zinc-500/10 text-zinc-400',
    success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
    warning: 'border-amber-500/20 bg-amber-500/10 text-amber-400',
    danger: 'border-red-500/20 bg-red-500/10 text-red-400',
} as const;

export function Badge({
    className,
    tone = 'neutral',
    ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof badgeTone }) {
    const resolvedTone: keyof typeof badgeTone = tone;
    return (
        <div
            className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]',
                badgeTone[resolvedTone],
                className,
            )}
            {...props}
        />
    );
}
