import * as React from 'react';
import { cn } from '@/lib/cn';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    ({ className, ...props }, ref) => (
        <input
            ref={ref}
            className={cn(
                'flex h-9 w-full rounded-xl border border-border/60 bg-accent/40 px-3 py-2 text-sm text-foreground outline-hidden transition-all placeholder:text-muted-foreground/60 focus:border-primary/50 focus:bg-accent/60 focus:ring-1 focus:ring-primary/50',
                className,
            )}
            {...props}
        />
    ),
);

Input.displayName = 'Input';
