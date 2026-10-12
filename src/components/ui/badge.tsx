import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/* Pílulas com cor por tom (ver tone em lib/ui/status.ts). Cores vêm dos tokens de globals.css. */
export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-neutral-soft text-muted-foreground',
        info: 'bg-info-soft text-primary',
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
        orange: 'bg-orange-soft text-orange-text',
      },
      size: {
        sm: '',
        lg: 'h-[42px] rounded-lg px-4 text-[15px] font-semibold',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'sm' },
  },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}
