import * as React from 'react';
import { cn } from '@/lib/cn';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
    <textarea
        ref={ref}
        className={cn('flex min-h-[160px] w-full rounded-xl border bg-background/60 px-3 py-2 text-sm text-foreground outline-hidden transition focus:border-primary', className)}
        {...props}
    />
));

Textarea.displayName = 'Textarea';
