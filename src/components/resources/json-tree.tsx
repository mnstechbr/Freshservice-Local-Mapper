const MAX_DEPTH = 6;
const MAX_KEYS = 100;

function scalarText(value: unknown): string {
  if (typeof value === 'string') return value === '' ? '""' : value;
  return String(value);
}

/**
 * Árvore legível de um valor JSON. Todo texto entra como nó de texto do React (escapado).
 * Não usa dangerouslySetInnerHTML. Profundidade e número de chaves são limitados.
 */
export function JsonTree({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined || typeof value !== 'object') {
    return <span className="break-all text-foreground">{value === null || value === undefined ? '—' : scalarText(value)}</span>;
  }

  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = isArray
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);

  if (entries.length === 0) {
    return <span className="text-muted-foreground">{isArray ? '[ ]' : '{ }'}</span>;
  }
  if (depth >= MAX_DEPTH) {
    return <span className="text-muted-foreground">(conteúdo aninhado omitido)</span>;
  }

  return (
    <ul className="ml-1 min-w-0 space-y-1 border-l border-border pl-3">
      {entries.slice(0, MAX_KEYS).map(([key, item]) => (
        <li key={key} className="min-w-0 break-words text-sm">
          <span className="font-medium text-muted-foreground">{isArray ? `[${key}]` : key}: </span>
          <JsonTree value={item} depth={depth + 1} />
        </li>
      ))}
      {entries.length > MAX_KEYS && (
        <li className="text-xs text-muted-foreground">+{entries.length - MAX_KEYS} itens omitidos</li>
      )}
    </ul>
  );
}
