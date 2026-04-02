import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

export const buttonVariants = cva(
    'inline-flex items-center justify-center rounded-xl border text-sm font-medium transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/50 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
    {
        variants: {
            variant: {
                default:
                    'border-transparent bg-gradient-to-b from-primary/90 to-primary text-primary-foreground shadow-glow-sm hover:from-primary hover:to-primary/90',
                secondary:
                    'border-border/60 bg-accent/50 text-accent-foreground shadow-xs hover:bg-accent/80 hover:border-border hover:shadow-glow-sm',
                ghost: 'border-transparent bg-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                danger: 'border-transparent bg-gradient-to-b from-danger/90 to-danger text-white shadow-glow-sm hover:from-danger hover:to-danger/90',
            },
            size: {
                default: 'h-9 px-4 py-2',
                sm: 'h-8 px-3 text-xs',
                lg: 'h-10 px-6',
            },
        },
        defaultVariants: {
            variant: 'default',
            size: 'default',
        },
    },
);

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, ...props }, ref) => (
        <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    ),
);

Button.displayName = 'Button';
