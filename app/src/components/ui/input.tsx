import * as React from 'react';
import { cn } from '@/lib/cn';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    ({ className, ...props }, ref) => (
        <input
            ref={ref}
            className={cn(
                'flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-hidden transition-colors placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-zinc-300',
                className,
            )}
            {...props}
        />
    ),
);

Input.displayName = 'Input';
