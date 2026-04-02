import * as React from 'react';
import { cn } from '@/lib/cn';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
    ({ className, ...props }, ref) => (
        <textarea
            ref={ref}
            className={cn(
                'flex min-h-[160px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-hidden transition-colors placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-zinc-300',
                className,
            )}
            {...props}
        />
    ),
);

Textarea.displayName = 'Textarea';
