import type { ReactNode } from 'react';

/** Cabeçalho das páginas, no mesmo estilo do painel: ícone em caixa azul, título 30 px (sm+) e subtítulo. */
export function PageHeader({
  icon,
  title,
  description,
  aside,
}: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary [&_svg]:size-6"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold tracking-tight text-foreground sm:text-[30px] sm:leading-tight">
            {title}
          </h1>
          {description && <p className="mt-0.5 text-[15px] text-muted-foreground sm:text-[17px]">{description}</p>}
        </div>
      </div>
      {aside && <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">{aside}</div>}
    </header>
  );
}
