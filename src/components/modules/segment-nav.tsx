import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface SegmentOption {
  value: string;
  label: string;
}

/** Segmentos com links (funcionam sem JavaScript). O primeiro valor é a rota base, sem parâmetro. */
export function SegmentNav({
  basePath,
  param,
  options,
  active,
}: {
  basePath: string;
  param: string;
  options: readonly SegmentOption[];
  active: string;
}) {
  return (
    <nav aria-label="Segmentos" className="flex w-full flex-wrap gap-1 rounded-lg border border-border bg-card p-1 sm:w-auto">
      {options.map((option, index) => {
        const isActive = option.value === active;
        const href = index === 0 ? basePath : `${basePath}?${new URLSearchParams({ [param]: option.value })}`;
        return (
          <Link
            key={option.value}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors',
              isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
