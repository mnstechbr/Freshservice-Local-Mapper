/**
 * Servidor Freshservice sintético em memória (dados fictícios). Não abre socket: é um substituto
 * de fetch com estado mutável. Qualquer host diferente do sintético lança erro, para que nenhuma
 * requisição real saia da máquina durante os testes e2e.
 */
export const SYNTHETIC_HOST = 'https://acme-test.freshservice.com';

export const FAKE_PATHS = {
  items: '/api/v2/service_catalog/items',
  categories: '/api/v2/service_catalog/categories',
  assets: '/api/v2/assets',
} as const;

export interface FakeItem {
  id: number;
  name: string;
  description: string;
  category_id: number;
  visibility: number;
}

export interface FakeCategory {
  id: number;
  name: string;
  description: string;
}

export interface FakeRequestLog {
  method: string;
  path: string;
  query: string;
  authorization: string | null;
}

const SEED_CATEGORIES: FakeCategory[] = [
  { id: 1, name: 'Contas e acessos', description: 'Identidade e acesso de usuários' },
  { id: 2, name: 'Software', description: 'Licenças e instalações homologadas' },
  { id: 3, name: 'Rede', description: 'Conectividade corporativa' },
];

const SEED_ITEMS: FakeItem[] = [
  { id: 19, name: 'Criar conta de e-mail', description: 'Conta corporativa padrão', category_id: 1, visibility: 1 },
  { id: 27, name: 'Solicitar licença de software', description: 'Licença para uso aprovado', category_id: 2, visibility: 1 },
  { id: 32, name: 'Instalação de software', description: 'Instalação de aplicativo homologado', category_id: 2, visibility: 1 },
  { id: 40, name: 'Acesso VPN', description: 'Conexão segura à rede interna', category_id: 3, visibility: 1 },
  { id: 55, name: 'Redefinição de senha', description: 'Redefinição de senha do usuário', category_id: 1, visibility: 1 },
];

/** Mesmo conteúdo do item 40, com outro ID: candidato a possível troca de ID. */
export const VPN_ITEM_NEW_ID: FakeItem = { ...SEED_ITEMS[3], id: 45 };
/** Item novo, sem parecença com nenhum item removido. */
export const NEW_ITEM: FakeItem = {
  id: 78,
  name: 'Solicitação de ramal',
  description: 'Ramal telefônico corporativo',
  category_id: 1,
  visibility: 1,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export class FakeFreshservice {
  readonly items = new Map<number, FakeItem>();
  readonly categories = new Map<number, FakeCategory>();
  /** Todas as requisições recebidas (sem corpo). */
  readonly log: FakeRequestLog[] = [];
  /** Status HTTP forçado por caminho (ex.: 403 em assets; 500 persistente no catálogo). */
  private readonly forced = new Map<string, number>();

  constructor() {
    for (const category of SEED_CATEGORIES) this.categories.set(category.id, { ...category });
    for (const item of SEED_ITEMS) this.items.set(item.id, { ...item });
    this.forced.set(FAKE_PATHS.assets, 403);
  }

  /** Substitui o fetch global e o fetchImpl de AuthDeps. */
  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.origin !== SYNTHETIC_HOST) {
      throw new Error(`Rede real bloqueada nos testes e2e: ${url.origin}`);
    }
    const authorization = new Headers(init?.headers).get('authorization');
    this.log.push({ method, path: url.pathname, query: url.search, authorization });
    if (method !== 'GET') return json({ errors: [{ message: 'método não sintético' }] }, 405);
    const forcedStatus = this.forced.get(url.pathname);
    if (forcedStatus !== undefined) return json({ errors: [{ message: 'erro sintético' }] }, forcedStatus);
    return this.route(url);
  };

  force(path: string, status: number | null): void {
    if (status === null) this.forced.delete(path);
    else this.forced.set(path, status);
  }

  rename(id: number, name: string): void {
    this.mustItem(id).name = name;
  }

  setVisibility(id: number, visibility: number): void {
    this.mustItem(id).visibility = visibility;
  }

  add(item: FakeItem): void {
    this.items.set(item.id, { ...item });
  }

  remove(id: number): void {
    this.mustItem(id);
    this.items.delete(id);
  }

  private mustItem(id: number): FakeItem {
    const item = this.items.get(id);
    if (!item) throw new Error(`item sintético ${id} inexistente`);
    return item;
  }

  private route(url: URL): Response {
    const page = Number(url.searchParams.get('page') ?? '1');
    const firstPage = page <= 1;
    if (url.pathname === FAKE_PATHS.items) {
      const list = firstPage ? [...this.items.values()].sort((a, b) => a.id - b.id) : [];
      return json({ service_items: list });
    }
    if (url.pathname === FAKE_PATHS.categories) {
      const list = firstPage ? [...this.categories.values()].sort((a, b) => a.id - b.id) : [];
      return json({ service_categories: list });
    }
    // Demais caminhos (validação de chave, módulos sem interesse no fluxo): acessíveis e vazios.
    return json({});
  }
}
