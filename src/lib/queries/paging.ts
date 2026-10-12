export interface Paging {
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * Normaliza página e tamanho pedidos. Página fora do intervalo cai na última página existente.
 * `minSize` padrão 5 (listas comuns); o painel inicial pede 3 linhas, como na referência.
 */
export function resolvePaging(
  total: number,
  requestedPage = 1,
  requestedSize = 20,
  maxSize = 100,
  minSize = 5,
): Paging {
  const pageSize = Math.min(Math.max(Math.floor(requestedSize) || 20, minSize), maxSize);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(Math.floor(requestedPage) || 1, 1), pageCount);
  return { page, pageSize, pageCount };
}

export function offsetFor(paging: Paging): number {
  return (paging.page - 1) * paging.pageSize;
}
