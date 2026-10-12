import 'server-only';
import { MODULE_GET_SCOPES, OFFICIAL_SCOPES } from '../freshservice/official-scopes';

/* Tipos do estado do simulador. Todos os dados são sintéticos (domínios .invalid, nomes fictícios). */

export interface SimApp {
  name: string;
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  allowedScopes: string[];
}

export interface SimUser {
  id: string;
  name: string;
  email: string;
  password: string;
  mfa: boolean;
  mfaCode: string;
  apiKey: string | null;
  /** Permissão por módulo (primeiro segmento do caminho). Ausente = negado. */
  permissions: Record<string, boolean>;
}

export interface AuthorizeParams {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string | null;
}

export interface SimFlow {
  id: string;
  params: AuthorizeParams;
  step: 'login' | 'mfa' | 'consent';
  userId: string | null;
  error: string | null;
  expiresAt: number;
}

export interface SimCode {
  clientId: string;
  redirectUri: string;
  userId: string;
  scopes: string[];
  expiresAt: number;
  used: boolean;
}

export interface SimAccessToken {
  clientId: string;
  userId: string;
  scopes: string[];
  expiresAt: number;
}

export interface SimRefreshToken {
  clientId: string;
  userId: string;
  scopes: string[];
  revoked: boolean;
  expiresAt: number;
}

export interface SimSession {
  userId: string;
  expiresAt: number;
}

export interface SimScenario {
  accessTokenTtlSeconds: number;
  codeTtlSeconds: number;
  /** 'none': sem falha. 'all': toda chamada falha de rede. Lista: só os caminhos listados falham. */
  network: 'none' | 'all' | string[];
}

export interface SimState {
  apps: Map<string, SimApp>;
  users: SimUser[];
  sessions: Map<string, SimSession>;
  flows: Map<string, SimFlow>;
  codes: Map<string, SimCode>;
  access: Map<string, SimAccessToken>;
  refresh: Map<string, SimRefreshToken>;
  dataset: Map<string, Record<string, unknown>[]>;
  scenario: SimScenario;
}

export interface SimResource {
  /** Caminho sob /api/v2 (sem barra inicial). Use {id} para caminhos filhos. */
  path: string;
  /** Chave do array na resposta. */
  listKey: string;
  paginated: boolean;
  count: number;
  make: (id: number) => Record<string, unknown>;
}

const named = (label: string) => (id: number) => ({ id, name: `${label} ${id}` });

/** Catálogo sintético: os caminhos e chaves seguem src/lib/freshservice/modules/*.ts. */
export const SIM_RESOURCES: readonly SimResource[] = [
  { path: 'tickets', listKey: 'tickets', paginated: true, count: 120,
    make: (id) => ({ id, subject: `Ticket sintético ${id}`, status: 2, priority: 1, requester_id: 1 + (id % 5) }) },
  { path: 'ticket_form_fields', listKey: 'ticket_fields', paginated: false, count: 3,
    make: (id) => ({ id, name: `campo_${id}`, label: `Campo ${id}` }) },
  { path: 'assets', listKey: 'assets', paginated: true, count: 3, make: named('Ativo') },
  { path: 'asset_types', listKey: 'asset_types', paginated: true, count: 2, make: named('Tipo de ativo') },
  { path: 'agents', listKey: 'agents', paginated: true, count: 4,
    make: (id) => ({ id, first_name: `Agente ${id}`, email: `agente${id}@simulador.invalid` }) },
  { path: 'requesters', listKey: 'requesters', paginated: true, count: 5,
    make: (id) => ({ id, first_name: `Solicitante ${id}`, email: `solicitante${id}@simulador.invalid` }) },
  { path: 'groups', listKey: 'groups', paginated: true, count: 3, make: named('Grupo') },
  { path: 'departments', listKey: 'departments', paginated: true, count: 2, make: named('Departamento') },
  { path: 'requester_groups', listKey: 'requester_groups', paginated: true, count: 2, make: named('Grupo de solicitantes') },
  { path: 'locations', listKey: 'locations', paginated: true, count: 3, make: named('Local') },
  { path: 'products', listKey: 'products', paginated: true, count: 2, make: named('Produto') },
  { path: 'vendors', listKey: 'vendors', paginated: true, count: 2, make: named('Fornecedor') },
  { path: 'sla_policies', listKey: 'sla_policies', paginated: true, count: 2, make: named('SLA') },
  { path: 'problems', listKey: 'problems', paginated: true, count: 2, make: named('Problema') },
  { path: 'changes', listKey: 'changes', paginated: true, count: 2, make: named('Mudança') },
  { path: 'releases', listKey: 'releases', paginated: true, count: 2, make: named('Release') },
  { path: 'workspaces', listKey: 'workspaces', paginated: true, count: 1, make: named('Workspace') },
  { path: 'solutions/categories', listKey: 'categories', paginated: true, count: 2, make: named('Categoria') },
  { path: 'solutions/folders', listKey: 'folders', paginated: true, count: 2, make: named('Pasta') },
  { path: 'solutions/articles', listKey: 'articles', paginated: true, count: 2, make: named('Artigo') },
  { path: 'service_catalog/categories', listKey: 'service_categories', paginated: true, count: 2, make: named('Categoria de serviço') },
  { path: 'service_catalog/items', listKey: 'service_items', paginated: true, count: 3, make: named('Item de serviço') },
];

/** Chave de papel: primeiro segmento do caminho (ex.: 'tickets' para tickets/5/conversations). */
export function roleKeyFor(path: string): string {
  return path.split('/')[0] ?? path;
}

/** Chave oficial: IDs de tickets são placeholders; detalhes de catálogo usam escopo da lista. */
export function scopeKeyFor(path: string): string {
  if (/^tickets\/\d+\/(conversations|activities)$/.test(path)) return path.replace(/\/\d+\//, '/{id}/');
  return path.split('/').filter((segment) => !/^\d+$/.test(segment)).join('/');
}

/** Escopo exigido pelo caminho, conforme MODULE_GET_SCOPES. Caminho sem mapeamento não exige escopo. */
export function requiredScopesFor(path: string): readonly string[] {
  return MODULE_GET_SCOPES[scopeKeyFor(path)] ?? [];
}

const ROLE_KEYS = [...new Set(SIM_RESOURCES.map((r) => roleKeyFor(r.path)))];
export const ANALYST_PERMISSIONS: Record<string, boolean> = Object.fromEntries(
  ROLE_KEYS.map((key) => [key, key !== 'agents']),
);

export const FIXTURE = {
  clientId: 'sim-client-fslm',
  clientSecret: 'sim-secret-ficticio-fslm',
  restrictedClientId: 'sim-client-restrito',
  restrictedClientSecret: 'sim-secret-ficticio-restrito',
  userEmail: 'analista.ficticio@simulador.invalid',
  userPassword: 'SenhaFicticia-2026',
  mfaUserEmail: 'analista.mfa@simulador.invalid',
  mfaUserPassword: 'SenhaFicticia-MFA',
  mfaCode: '135790',
  apiKey: 'chave-ficticia-simulador-0001',
} as const;

const BASE_DATE_MS = Date.UTC(2026, 0, 1);

function isoDay(offset: number): string {
  return new Date(BASE_DATE_MS + offset * 86_400_000).toISOString();
}

function seedRecords(resource: SimResource): Record<string, unknown>[] {
  return Array.from({ length: resource.count }, (_, index) => {
    const id = index + 1;
    return { ...resource.make(id), created_at: isoDay(id), updated_at: isoDay(id) };
  });
}

/** Portas usadas pelo app (dev 3111, prod 3110, simulador 3112). O redirect_uri segue o PORT do processo. */
function callbackUris(): string[] {
  const port = Number(process.env.PORT) || 3000;
  return [`http://localhost:${port}/api/auth/oauth/callback`, `http://127.0.0.1:${port}/api/auth/oauth/callback`];
}

/** Estado inicial. Função pura de fixtures: chamada na primeira vez e em cada reset. */
export function fixtureState(): SimState {
  const apps = new Map<string, SimApp>([
    [FIXTURE.clientId, {
      name: 'FSLM (simulado)',
      clientId: FIXTURE.clientId,
      clientSecret: FIXTURE.clientSecret,
      redirectUris: callbackUris(),
      allowedScopes: [...OFFICIAL_SCOPES],
    }],
    [FIXTURE.restrictedClientId, {
      name: 'App restrito (simulado)',
      clientId: FIXTURE.restrictedClientId,
      clientSecret: FIXTURE.restrictedClientSecret,
      redirectUris: callbackUris(),
      allowedScopes: ['freshservice.tickets.view'],
    }],
  ]);
  const users: SimUser[] = [
    {
      id: 'analista-ficticio', name: 'Analista Fictício', email: FIXTURE.userEmail,
      password: FIXTURE.userPassword, mfa: false, mfaCode: FIXTURE.mfaCode, apiKey: FIXTURE.apiKey,
      permissions: { ...ANALYST_PERMISSIONS },
    },
    {
      id: 'analista-mfa', name: 'Analista com MFA (fictício)', email: FIXTURE.mfaUserEmail,
      password: FIXTURE.mfaUserPassword, mfa: true, mfaCode: FIXTURE.mfaCode, apiKey: null,
      permissions: { ...ANALYST_PERMISSIONS },
    },
  ];
  const dataset = new Map<string, Record<string, unknown>[]>(
    SIM_RESOURCES.map((resource) => [resource.path, seedRecords(resource)]),
  );
  return {
    apps,
    users,
    sessions: new Map(),
    flows: new Map(),
    codes: new Map(),
    access: new Map(),
    refresh: new Map(),
    dataset,
    scenario: { accessTokenTtlSeconds: 1800, codeTtlSeconds: 60, network: 'none' },
  };
}
