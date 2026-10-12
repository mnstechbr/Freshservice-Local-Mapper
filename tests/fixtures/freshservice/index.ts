/*
 * Fixtures sintéticas da API do Freshservice. Hosts, IDs, nomes, textos e chaves são inventados.
 * Nada aqui vem de uma instância real.
 */

export const SYNTHETIC_ORIGIN_A = 'https://sintetica-a.freshservice.com';
export const SYNTHETIC_ORIGIN_B = 'https://sintetica-b.freshservice.com';
export const SYNTHETIC_API_KEY = 'chave-sintetica-0000';

/** Página de chamados com `count` itens a partir de `startId`. Cada item tem descrição (conteúdo). */
export function ticketsPage(startId: number, count: number): { tickets: Array<Record<string, unknown>> } {
  return {
    tickets: Array.from({ length: count }, (_, index) => {
      const id = startId + index;
      return {
        id,
        subject: `Chamado sintético ${id}`,
        description: `Descrição sintética ${id}`,
        status: 2,
        priority: 1,
        workspace_id: 1,
        requester_id: 9000 + index,
      };
    }),
  };
}

export function categoriesBody(ids: number[]): { categories: Array<Record<string, unknown>> } {
  return { categories: ids.map((id) => ({ id, name: `Categoria sintética ${id}`, description: `Texto ${id}` })) };
}

export function foldersBody(categoryId: number, ids: number[]): { folders: Array<Record<string, unknown>> } {
  return {
    folders: ids.map((id) => ({
      id,
      name: `Pasta sintética ${id}`,
      description: `Pasta ${id}`,
      category_id: categoryId,
      visibility: 1,
    })),
  };
}

export function articlesBody(folderId: number, ids: number[]): { articles: Array<Record<string, unknown>> } {
  return {
    articles: ids.map((id) => ({
      id,
      title: `Artigo sintético ${id}`,
      status: 2,
      folder_id: folderId,
      description: `Corpo sintético ${id}`,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    })),
  };
}

/** Valor do cabeçalho link com rel="next". */
export function linkNext(url: string): string {
  return `<${url}>; rel="next"`;
}
