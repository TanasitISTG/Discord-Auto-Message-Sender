import * as React from 'react';
import { cn } from '@/lib/cn';

const badgeTone = {
    neutral: 'border-border/60 bg-accent/40 text-foreground/80 shadow-[0_0_8px_rgba(255,255,255,0.02)]',
    success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.1)]',
    warning: 'border-amber-500/20 bg-amber-500/10 text-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.1)]',
    danger: 'border-red-500/20 bg-red-500/10 text-red-400 shadow-[0_0_8px_rgba(239,68,68,0.1)]'
} as const;

export function Badge({
    className,
    tone = 'neutral',
    ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof badgeTone }) {
    const resolvedTone: keyof typeof badgeTone = tone;
    return (
        <div
            className={cn('inline-flex items-center rounded-[6px] border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] backdrop-blur-sm', badgeTone[resolvedTone], className)}
            {...props}
        />
    );
}
