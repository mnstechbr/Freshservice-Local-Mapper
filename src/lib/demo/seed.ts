import { createHash } from 'node:crypto';
import { syncableAdapters } from '@/lib/freshservice/modules';
import { eq, inArray } from 'drizzle-orm';
import type { AppDb } from '@/lib/db/client';
import {
  apiModules,
  appSettings,
  auditEvents,
  changeMatches,
  connections,
  detectedChanges,
  instances,
  resourceRelations,
  resourceVersions,
  resources,
  syncModuleResults,
  syncRuns,
} from '@/lib/db/schema';
import { getActiveInstance, setActiveInstanceId } from '@/lib/queries/instances';
import type { ChangeSeverity, ChangeType } from '@/lib/queries/changes';

/*
 * Modo demonstrativo: uma instância fictícia com dados coerentes (2 execuções, 1.248 itens,
 * 14 diferenças). Tudo marcado com is_demo = 1. Nunca lê nem altera instâncias reais.
 * A semente é idempotente: ativar de novo reaproveita a instância existente.
 */

type Tx = Parameters<Parameters<AppDb['transaction']>[0]>[0];
type RunKey = 'A' | 'B';

/**
 * Versão do conjunto fictício, gravada em app_settings.demo_seed_version. Se a versão gravada
 * for diferente, activateDemo recria a instância demo (a cascata apaga o conjunto antigo).
 * 1 = seed legado (chaves de módulo sem ponto, conexão "connected"); 2 = atual, sem conexão conectada.
 */
export const DEMO_SEED_VERSION = 2;
const SEED_VERSION_KEY = 'demo_seed_version';

export const DEMO_BASE_URL = 'https://demo.freshservice.invalid';
export const DEMO_DISPLAY_NAME = 'Demonstração (dados fictícios)';
const IDENTITY_LABEL = 'Conta fictícia de demonstração';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Módulos com a quantidade de itens da execução B (a atual). Soma: 1.248. */
const GROUP_PREFIX: Record<string, string> = {
  service_catalog: '',
  knowledge_base: 'Artigo: ',
  tickets: 'Chamado: ',
  users_groups: 'Grupo: ',
  assets: 'Ativo: ',
  itsm: 'Mudança: ',
  settings: 'Configuração: ',
  automations: 'Automação: ',
};
/** Itens fictícios por endpoint (soma 1.248, igual à referência). Endpoints fora da lista ficam vazios. */
const ENDPOINT_COUNT: Record<string, number> = {
  'service_catalog.items': 420,
  'knowledge_base.articles': 310,
  'tickets.tickets': 280,
  'users_groups.agents': 96,
  'assets.assets': 92,
  'itsm.changes': 30,
  'settings.workspaces': 12,
  'settings.locations': 8,
};
/** Um endpoint por adaptador consultável do registro, com chave pontuada. */
const MODULE_PLAN = syncableAdapters().map((adapter) => ({
  key: adapter.key,
  name: adapter.name,
  path: adapter.path,
  count: ENDPOINT_COUNT[adapter.key] ?? 0,
  prefix: GROUP_PREFIX[adapter.moduleGroup] ?? '',
  paginated: !adapter.key.startsWith('settings.'),
}));
const SUBJECTS = [
  'Acesso ao ERP financeiro',
  'Instalação de Office',
  'Solicitação de monitor',
  'Renovação de licença',
  'Acesso à VPN de parceiros',
  'Troca de estação de trabalho',
  'Cadastro de impressora',
  'Criação de conta de e-mail',
  'Revisão de permissões',
  'Reset de senha de rede',
  'Acesso à pasta compartilhada',
  'Telefone IP para novo colaborador',
];
const CATEGORIES = ['Acessos', 'Software', 'Hardware', 'Rede', 'Infraestrutura', 'Suporte'];
const OWNERS = ['Equipe de TI', 'Equipe de Redes', 'Equipe de Suporte', 'Financeiro'];

type Data = Record<string, unknown>;

interface ResourceSpec {
  moduleKey: string;
  externalId: string;
  firstRun: RunKey;
  lastRun: RunKey;
  versions: Array<{ run: RunKey; data: Data }>;
}

function synthetic(prefix: string, index: number): Data {
  const subject = SUBJECTS[index % SUBJECTS.length];
  const group = Math.floor(index / SUBJECTS.length) + 1;
  return {
    name: `${prefix}${subject} ${group}`,
    category: CATEGORIES[index % CATEGORIES.length],
    description: `Item fictício ${index + 1} para demonstração.`,
    owner: OWNERS[index % OWNERS.length],
  };
}

/** Histórias fixas (aparecem no painel e nas comparações) e itens sintéticos. */
function buildResourceSpecs(): ResourceSpec[] {
  const specs: ResourceSpec[] = [
    {
      moduleKey: 'service_catalog.items',
      externalId: '25',
      firstRun: 'A',
      lastRun: 'B',
      versions: [
        { run: 'A', data: { name: 'Instalação de software', category: 'Software', description: 'Instalação padrão de aplicativos homologados.', owner: 'Equipe de TI' } },
        { run: 'B', data: { name: 'Instalação de software', category: 'Software', description: 'Instalação padrão de aplicativos homologados pelo time de TI.', owner: 'Equipe de TI' } },
      ],
    },
    {
      moduleKey: 'service_catalog.items',
      externalId: '41',
      firstRun: 'A',
      lastRun: 'B',
      versions: [{ run: 'A', data: { name: 'Acesso VPN', category: 'Acessos', description: 'Solicitação de acesso remoto à rede corporativa.', owner: 'Equipe de Redes' } }],
    },
    {
      moduleKey: 'service_catalog.items',
      externalId: '78',
      firstRun: 'B',
      lastRun: 'B',
      versions: [{ run: 'B', data: { name: 'Solicitação de notebook', category: 'Hardware', description: 'Pedido de equipamento para novos colaboradores.', owner: 'Equipe de Suporte' } }],
    },
    {
      moduleKey: 'service_catalog.items',
      externalId: '19',
      firstRun: 'A',
      lastRun: 'A',
      versions: [{ run: 'A', data: { name: 'Criação de e-mail', category: 'Acessos', description: 'Criação de conta de e-mail corporativo.', owner: 'Equipe de TI' } }],
    },
    {
      moduleKey: 'service_catalog.items',
      externalId: '32',
      firstRun: 'A',
      lastRun: 'A',
      versions: [{ run: 'A', data: { name: 'Instalação de software', category: 'Software', description: 'Versão anterior do catálogo de instalação.', owner: 'Equipe de TI' } }],
    },
    {
      moduleKey: 'knowledge_base.articles',
      externalId: '32',
      firstRun: 'A',
      lastRun: 'B',
      versions: [
        { run: 'A', data: { name: 'Instalação de software', category: 'Procedimentos', description: 'Passo a passo para instalar software.', owner: 'Equipe de TI' } },
        { run: 'B', data: { name: 'Instalação de Software homologado', category: 'Procedimentos', description: 'Passo a passo para instalar software.', owner: 'Equipe de TI' } },
      ],
    },
    {
      moduleKey: 'assets.assets',
      externalId: '9001',
      firstRun: 'A',
      lastRun: 'A',
      versions: [{ run: 'A', data: { name: 'Ativo: notebook antigo 9001', category: 'Hardware', description: 'Equipamento devolvido ao estoque.', owner: 'Equipe de Suporte' } }],
    },
  ];

  for (const plan of MODULE_PLAN) {
    const fixedInB = specs.filter((s) => s.moduleKey === plan.key && s.lastRun === 'B').length;
    const syntheticInB = plan.count - fixedInB;
    const addedInB = plan.key === 'service_catalog.items' ? 5 : 0;

    for (let index = 0; index < syntheticInB; index += 1) {
      const externalId = String(1000 + index);
      const isAddedInB = index >= syntheticInB - addedInB;
      const data = synthetic(plan.prefix, index);
      const versions: ResourceSpec['versions'] = [];

      if (isAddedInB) {
        versions.push({ run: 'B', data });
      } else {
        versions.push({ run: 'A', data });
      }

      // Alterações de conteúdo entre A e B (para "Campos alterados" e "Nome alterado").
      if (!isAddedInB && plan.key === 'knowledge_base.articles' && index < 2) {
        versions.push({ run: 'B', data: { ...data, description: `Item fictício ${index + 1}, revisado para a nova versão.` } });
      }
      if (!isAddedInB && plan.key === 'users_groups.agents' && index === 0) {
        versions[0] = { run: 'A', data: { ...data, name: 'Grupo: Infra' } };
        versions.push({ run: 'B', data: { ...data, name: 'Grupo: Infraestrutura' } });
      }

      specs.push({
        moduleKey: plan.key,
        externalId,
        firstRun: isAddedInB ? 'B' : 'A',
        lastRun: 'B',
        versions,
      });
    }
  }

  return specs;
}

interface ChangeSpec {
  moduleKey: string;
  type: ChangeType;
  severity: ChangeSeverity;
  reviewStatus: 'pending' | 'confirmed' | 'not_applicable';
  previousKey?: string;
  currentKey?: string;
  previousExternalId?: string;
  currentExternalId?: string;
  previousName?: string;
  currentName?: string;
}

const CHANGE_SPECS: ChangeSpec[] = [
  { moduleKey: 'service_catalog.items', type: 'possible_id_change', severity: 'high', reviewStatus: 'pending', previousKey: 'service_catalog.items:32', currentKey: 'service_catalog.items:25', previousExternalId: '32', currentExternalId: '25', previousName: 'Instalação de software', currentName: 'Instalação de software' },
  { moduleKey: 'knowledge_base.articles', type: 'name_changed', severity: 'medium', reviewStatus: 'confirmed', previousKey: 'knowledge_base.articles:32', currentKey: 'knowledge_base.articles:32', previousExternalId: '32', currentExternalId: '32', previousName: 'Instalação de software', currentName: 'Instalação de Software homologado' },
  { moduleKey: 'service_catalog.items', type: 'added', severity: 'low', reviewStatus: 'pending', currentKey: 'service_catalog.items:78', currentExternalId: '78', currentName: 'Solicitação de notebook' },
  { moduleKey: 'service_catalog.items', type: 'removed', severity: 'high', reviewStatus: 'pending', previousKey: 'service_catalog.items:19', previousExternalId: '19', previousName: 'Criação de e-mail' },
  { moduleKey: 'service_catalog.items', type: 'fields_changed', severity: 'medium', reviewStatus: 'pending', previousKey: 'service_catalog.items:25', currentKey: 'service_catalog.items:25', previousExternalId: '25', currentExternalId: '25', previousName: 'Instalação de software', currentName: 'Instalação de software' },
  ...[412, 413, 414, 415, 416].map((index): ChangeSpec => ({ moduleKey: 'service_catalog.items', type: 'added', severity: 'low', reviewStatus: 'pending', currentKey: `service_catalog.items:${1000 + index}`, currentExternalId: String(1000 + index), currentName: `${SUBJECTS[index % SUBJECTS.length]} ${Math.floor(index / SUBJECTS.length) + 1}` })),
  ...[0, 1].map((index): ChangeSpec => ({ moduleKey: 'knowledge_base.articles', type: 'fields_changed', severity: 'low', reviewStatus: 'pending', previousKey: `knowledge_base.articles:${1000 + index}`, currentKey: `knowledge_base.articles:${1000 + index}`, previousExternalId: String(1000 + index), currentExternalId: String(1000 + index), previousName: `Artigo: ${SUBJECTS[index]} 1`, currentName: `Artigo: ${SUBJECTS[index]} 1` })),
  { moduleKey: 'users_groups.agents', type: 'name_changed', severity: 'medium', reviewStatus: 'pending', previousKey: 'users_groups.agents:1000', currentKey: 'users_groups.agents:1000', previousExternalId: '1000', currentExternalId: '1000', previousName: 'Grupo: Infra', currentName: 'Grupo: Infraestrutura' },
  { moduleKey: 'assets.assets', type: 'removed', severity: 'high', reviewStatus: 'not_applicable', previousKey: 'assets.assets:9001', previousExternalId: '9001', previousName: 'Ativo: notebook antigo 9001' },
];

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Cria a instância fictícia e todo o conjunto de dados. Chamada dentro de transação. */
function insertDemoDataset(tx: Tx, now: number): number {
  const instance = tx
    .insert(instances)
    .values({ baseUrl: DEMO_BASE_URL, displayName: DEMO_DISPLAY_NAME, isDemo: true, createdAt: now, updatedAt: now })
    .returning({ id: instances.id })
    .get();
  const instanceId = instance.id;

  // Nenhuma conexão "connected": a demo não autentica. getStatus devolve "demo" para is_demo = 1.
  // A linha existe só porque sync_runs.connection_id é NOT NULL; fica "disconnected", sem conta e sem segredo.
  const connection = tx
    .insert(connections)
    .values({ instanceId, authMode: 'oauth', status: 'disconnected', accountLabel: null, createdAt: now, updatedAt: now })
    .returning({ id: connections.id })
    .get();
  tx.insert(appSettings)
    .values({ key: SEED_VERSION_KEY, value: DEMO_SEED_VERSION })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: DEMO_SEED_VERSION } })
    .run();

  for (const plan of MODULE_PLAN) {
    tx.insert(apiModules)
      .values({ instanceId, moduleKey: plan.key, name: plan.name, method: 'GET', path: plan.path, paginated: plan.paginated, accessStatus: 'accessible', httpStatus: 200, lastAttemptAt: now - 6 * MINUTE })
      .run();
  }

  const specs = buildResourceSpecs();
  const countFor = (run: RunKey, moduleKey: string) =>
    specs.filter((s) => s.moduleKey === moduleKey && (run === 'A' ? s.firstRun === 'A' : s.lastRun === 'B')).length;
  const totalFor = (run: RunKey) =>
    MODULE_PLAN.reduce((sum, plan) => sum + countFor(run, plan.key), 0);

  const runAStart = now - 26 * HOUR;
  const runAEnd = runAStart + 9 * MINUTE;
  const runBStart = now - 12 * MINUTE;
  const runBEnd = now - 5 * MINUTE;
  const modulesRequested = MODULE_PLAN.map((plan) => plan.key);

  const runA = tx
    .insert(syncRuns)
    .values({ instanceId, connectionId: connection.id, identityLabel: IDENTITY_LABEL, kind: 'full', status: 'completed', startedAt: runAStart, finishedAt: runAEnd, modulesRequested, modulesProcessed: MODULE_PLAN.length, recordsCount: totalFor('A'), failuresCount: 0, changesCount: 0 })
    .returning({ id: syncRuns.id })
    .get().id;
  const runB = tx
    .insert(syncRuns)
    .values({ instanceId, connectionId: connection.id, identityLabel: IDENTITY_LABEL, kind: 'full', status: 'completed', startedAt: runBStart, finishedAt: runBEnd, modulesRequested, modulesProcessed: MODULE_PLAN.length, recordsCount: totalFor('B'), failuresCount: 0, changesCount: CHANGE_SPECS.length, comparedToRunId: runA })
    .returning({ id: syncRuns.id })
    .get().id;

  for (const plan of MODULE_PLAN) {
    for (const [run, runId, start, end] of [['A', runA, runAStart, runAEnd], ['B', runB, runBStart, runBEnd]] as const) {
      const records = countFor(run, plan.key);
      tx.insert(syncModuleResults)
        .values({ runId, moduleKey: plan.key, status: 'completed', complete: true, recordsCount: records, pagesFetched: Math.ceil(records / 100), httpStatus: 200, startedAt: start, finishedAt: end })
        .run();
    }
  }

  const runIds: Record<RunKey, number> = { A: runA, B: runB };
  const runCaptured: Record<RunKey, number> = { A: runAEnd, B: runBEnd };
  const resourceIds = new Map<string, number>();

  for (const spec of specs) {
    const key = `${spec.moduleKey}:${spec.externalId}`;
    const resource = tx
      .insert(resources)
      .values({ instanceId, moduleKey: spec.moduleKey, externalId: spec.externalId, firstSeenRunId: runIds[spec.firstRun], lastSeenRunId: runIds[spec.lastRun] })
      .returning({ id: resources.id })
      .get();
    resourceIds.set(key, resource.id);

    let currentVersionId: number | null = null;
    let current: Data = {};
    for (const version of spec.versions) {
      const inserted = tx
        .insert(resourceVersions)
        .values({ resourceId: resource.id, runId: runIds[version.run], contentHash: sha256(version.data), name: String(version.data.name ?? ''), category: String(version.data.category ?? ''), normalizedJson: version.data, sourceEndpoint: `${MODULE_PLAN.find((p) => p.key === spec.moduleKey)?.path ?? ''}/${spec.externalId}`, capturedAt: runCaptured[version.run] })
        .returning({ id: resourceVersions.id })
        .get();
      currentVersionId = inserted.id;
      current = version.data;
    }
    tx.update(resources)
      .set({ currentVersionId, currentName: String(current.name ?? ''), currentCategory: String(current.category ?? '') })
      .where(eq(resources.id, resource.id))
      .run();
  }

  const id = (key: string | undefined) => (key === undefined ? null : (resourceIds.get(key) ?? null));

  const changeIds: number[] = [];
  for (const spec of CHANGE_SPECS) {
    const previousResourceId = id(spec.previousKey);
    const resourceId = id(spec.currentKey);
    const change = tx
      .insert(detectedChanges)
      .values({ instanceId, runId: runB, baseRunId: runA, moduleKey: spec.moduleKey, changeType: spec.type, severity: spec.severity, resourceId, previousResourceId, previousExternalId: spec.previousExternalId ?? null, currentExternalId: spec.currentExternalId ?? null, previousName: spec.previousName ?? null, currentName: spec.currentName ?? null, evidence: { origem: 'demonstração', regra: spec.type }, reviewStatus: spec.reviewStatus, detectedAt: runBEnd })
      .returning({ id: detectedChanges.id })
      .get();
    changeIds.push(change.id);
  }

  // Possível troca de ID: ID 32 saiu e ID 25 apareceu com o mesmo nome.
  const oldId = id('service_catalog.items:32');
  const newId = id('service_catalog.items:25');
  if (oldId !== null && newId !== null) {
    tx.insert(changeMatches)
      .values({ instanceId, changeId: changeIds[0], oldResourceId: oldId, newResourceId: newId, score: 0.92, scoreBreakdown: { nome: 1, categoria: 1, descricao: 0.74 }, status: 'suggested' })
      .run();
  }

  const fromId = id('service_catalog.items:25');
  const toId = id('knowledge_base.articles:32');
  if (fromId !== null && toId !== null) {
    tx.insert(resourceRelations)
      .values({ instanceId, fromResourceId: fromId, toResourceId: toId, toExternalRef: '32', relationType: 'artigo_relacionado', runId: runB })
      .run();
  }

  const events: Array<{ level: 'info' | 'warn'; eventType: string; message: string; runId: number | null; createdAt: number }> = [
    { level: 'info', eventType: 'demo.ativada', message: 'Modo demonstrativo ativado. Dados fictícios, não coletados do Freshservice.', runId: null, createdAt: now },
    { level: 'info', eventType: 'sync.iniciada', message: 'Mapeamento iniciado: 8 módulos.', runId: runA, createdAt: runAStart },
    { level: 'info', eventType: 'sync.concluida', message: `Mapeamento concluído: ${totalFor('A').toLocaleString('pt-BR')} itens, 0 falhas.`, runId: runA, createdAt: runAEnd },
    { level: 'info', eventType: 'sync.iniciada', message: 'Mapeamento iniciado: 8 módulos.', runId: runB, createdAt: runBStart },
    { level: 'warn', eventType: 'api.limite', message: 'Limite de requisições atingido no módulo Catálogo de serviços. Nova tentativa em 2 s.', runId: runB, createdAt: runBStart + 3 * MINUTE },
    { level: 'info', eventType: 'sync.concluida', message: `Mapeamento concluído: ${totalFor('B').toLocaleString('pt-BR')} itens, ${CHANGE_SPECS.length} mudanças.`, runId: runB, createdAt: runBEnd },
  ];
  for (const event of events) {
    tx.insert(auditEvents).values({ instanceId, ...event, context: null }).run();
  }

  return instanceId;
}

export class DemoConflictError extends Error {}

export interface ActivateDemoResult {
  instanceId: number;
  /** false se a instância demonstrativa já existia (nada foi duplicado). */
  created: boolean;
}

/** Cria (se preciso) e ativa a instância demonstrativa. Idempotente. */
export function activateDemo(db: AppDb, now = Date.now()): ActivateDemoResult {
  const result = db.transaction((tx): ActivateDemoResult => {
    const existing = tx
      .select({ id: instances.id, isDemo: instances.isDemo })
      .from(instances)
      .where(eq(instances.baseUrl, DEMO_BASE_URL))
      .get();
    if (existing && !existing.isDemo) {
      throw new DemoConflictError('Já existe uma instância real com o endereço de demonstração.');
    }
    if (existing && readSeedVersion(tx) === DEMO_SEED_VERSION) return { instanceId: existing.id, created: false };
    // Sem versão ou com versão antiga: recria. A instância antiga sai com o histórico dela.
    if (existing) deleteDemoInstances(tx, [existing.id]);
    return { instanceId: insertDemoDataset(tx, now), created: true };
  });

  setActiveInstanceId(db, result.instanceId);
  return result;
}

/** Remove apenas instâncias com is_demo = 1: o histórico de auditoria e a cascata levam o conjunto junto. */
export function removeDemo(db: AppDb): { removed: number } {
  const demoRows = db.select({ id: instances.id }).from(instances).where(eq(instances.isDemo, true)).all();
  if (demoRows.length === 0) return { removed: 0 };

  const active = getActiveInstance(db);
  db.transaction((tx) => {
    deleteDemoInstances(tx, demoRows.map((row) => row.id));
    tx.delete(appSettings).where(eq(appSettings.key, SEED_VERSION_KEY)).run();
  });
  if (active?.isDemo) setActiveInstanceId(db, null);
  return { removed: demoRows.length };
}

function readSeedVersion(tx: Tx): unknown {
  return tx
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, SEED_VERSION_KEY))
    .get()?.value;
}

/** Apaga instâncias demo e a auditoria delas (auditEvents.instance_id é SET NULL; sem isto ficariam órfãs). */
function deleteDemoInstances(tx: Tx, ids: number[]): void {
  if (ids.length === 0) return;
  tx.delete(auditEvents).where(inArray(auditEvents.instanceId, ids)).run();
  tx.delete(instances).where(inArray(instances.id, ids)).run();
}
