import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Par rótulo/valor dentro de um <dl>. Textos longos quebram em vez de vazar do cartão. */
export function DetailItem({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 min-w-0 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** Caminhos, versões e nomes técnicos em fonte mono. Quebram em qualquer ponto se não couberem. */
export function MonoText({ children }: { children: ReactNode }) {
  return <span className="break-all font-mono text-xs text-foreground">{children}</span>;
}
