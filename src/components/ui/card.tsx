import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Cartão branco do painel: borda, raio 10 px e sombra leve (medidas da referência). */
export function Card({ className, ...props }: ComponentProps<'section'>) {
  return <section className={cn('rounded-card border border-border bg-card p-4 shadow-card', className)} {...props} />;
}

/** Título do cartão com ícone em caixa azul clara. `aside` fica à direita (botões, busca, contagem). */
export function CardTitle({ icon, children, aside }: { icon: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary [&_svg]:size-[18px]"
        >
          {icon}
        </span>
        <h2 className="min-w-0 text-lg font-semibold text-foreground">{children}</h2>
      </div>
      {aside}
    </div>
  );
}
