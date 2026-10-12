/** Esqueleto leve para loading.tsx das páginas de lista. Não mostra dados, só blocos neutros. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="flex min-w-0 animate-pulse flex-col gap-[15px]">
      <div className="flex items-start gap-3">
        <div className="size-11 shrink-0 rounded-lg bg-secondary" />
        <div className="flex flex-col gap-2">
          <div className="h-7 w-64 max-w-[70vw] rounded bg-secondary" />
          <div className="h-4 w-80 max-w-[80vw] rounded bg-secondary" />
        </div>
      </div>
      <div className="grid min-w-0 gap-[15px] lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-2 rounded-card border border-border bg-card p-4">
          <div className="h-9 w-48 rounded-lg bg-secondary" />
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="h-10 rounded bg-background" />
          ))}
        </div>
        <div className="h-64 rounded-card border border-border bg-card" />
      </div>
    </div>
  );
}
