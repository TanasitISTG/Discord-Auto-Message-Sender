import * as React from 'react';
import { cn } from '@/lib/cn';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
    <input
        ref={ref}
        className={cn('flex h-10 w-full rounded-xl border bg-background/60 px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary', className)}
        {...props}
    />
));

Input.displayName = 'Input';
