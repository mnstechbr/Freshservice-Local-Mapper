import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncableAdapters } from '@/lib/freshservice/modules';
import { activateDemo } from '@/lib/demo/seed';
import { getActiveInstance, setActiveInstanceId } from '@/lib/queries/instances';
import { getLatestFinishedRun, listSyncRuns } from '@/lib/queries/runs';
import { loadRunComparison } from '@/lib/queries/history';
import { getResourceDetail, listResources } from '@/lib/queries/resources';
import { getDashboardStats } from '@/lib/queries/dashboard';
import { getChangeDetail, listChanges, listChangesForRun } from '@/lib/queries/changes';
import { listAuditEvents } from '@/lib/queries/audit';
import { createAppTestDb, insertRealInstance, type AppTestDb } from '../helpers/app-db';

let ctx: AppTestDb;
let instanceId: number;
/**
 * Grupos com pelo menos um endpoint acessível na demonstração. São 7 de 8: 'automations' não tem
 * endpoint consultável (docStatus unsupported). A referência visual mostra 8; divergência reportada.
 */
const DEMO_ACCESSIBLE_GROUPS = 7;

beforeAll(() => {
  ctx = createAppTestDb();
  activateDemo(ctx.db);
  instanceId = getActiveInstance(ctx.db)!.id;
});

afterAll(() => ctx.close());

describe('painel (demonstração)', () => {
  it('indicadores batem com a execução atual: 1.248 itens, 14 mudanças, grupos e endpoints acessíveis', () => {
    const stats = getDashboardStats(ctx.db, instanceId);
    expect(stats.itemsCollected).toBe(1248);
    expect(stats.changesDetected).toBe(14);
    // 23 = 22 anteriores + service_catalog.item_details (detalhe do item, recuperação etapa 4).
    expect(stats.accessibleEndpoints).toBe(23);
    expect(stats.accessibleModules).toBe(DEMO_ACCESSIBLE_GROUPS);
    expect(stats.totalEndpoints).toBe(syncableAdapters().length);
    expect(stats.lastRun?.status).toBe('completed');
  });

  it('as três primeiras linhas do catálogo são 25, 41 e 78, com status atualizado, sem alteração e novo', () => {
    const page = listResources(ctx.db, { instanceId, module: 'service_catalog', pageSize: 20 });
    expect(page.total).toBe(420);
    expect(page.rows.slice(0, 3).map((r) => r.externalId)).toEqual(['25', '41', '78']);
    expect(page.rows.slice(0, 3).map((r) => r.status)).toEqual(['updated', 'unchanged', 'new']);
    expect(page.pageCount).toBe(21);
  });

  it('recentes do painel vêm da última execução, na ordem de detecção', () => {
    const run = getLatestFinishedRun(ctx.db, instanceId)!;
    const changes = listChangesForRun(ctx.db, run.id, 4);
    expect(changes.map((c) => c.changeType)).toEqual(['possible_id_change', 'name_changed', 'added', 'removed']);
  });
});

describe('recursos: filtros, busca, ordenação e paginação', () => {
  it('filtra por status "new" (78 e os 5 adicionados)', () => {
    const page = listResources(ctx.db, { instanceId, module: 'service_catalog', status: 'new', pageSize: 20 });
    expect(page.total).toBe(6);
    expect(page.rows.every((r) => r.status === 'new')).toBe(true);
  });

  it('busca por nome e por ID', () => {
    const byName = listResources(ctx.db, { instanceId, module: 'service_catalog', search: 'vpn' });
    expect(byName.rows.map((r) => r.externalId)).toContain('41');
    expect(byName.rows.every((r) => /vpn/i.test(r.name ?? ''))).toBe(true);
    const byId = listResources(ctx.db, { instanceId, module: 'service_catalog', search: '1416' });
    expect(byId.rows.map((r) => r.externalId)).toEqual(['1416']);
  });

  it('ordena por ID numérico em ordem decrescente', () => {
    const page = listResources(ctx.db, { instanceId, module: 'service_catalog', sort: 'id', dir: 'desc', pageSize: 5 });
    expect(page.rows[0].externalId).toBe('1416');
  });

  it('página fora do intervalo cai na última; última página tem o resto', () => {
    const page = listResources(ctx.db, { instanceId, module: 'service_catalog', page: 999, pageSize: 20 });
    expect(page.page).toBe(21);
    expect(page.rows).toHaveLength(20);
  });

  it('instância sem execução concluída retorna lista vazia real', () => {
    const realId = insertRealInstance(ctx.db);
    const page = listResources(ctx.db, { instanceId: realId });
    expect(page).toMatchObject({ total: 0, rows: [], runId: null });
    expect(getDashboardStats(ctx.db, realId)).toMatchObject({ lastRun: null, itemsCollected: 0, changesDetected: 0, accessibleModules: 0 });
  });
});

describe('execuções e comparação', () => {
  it('lista as duas execuções, da mais recente para a mais antiga', () => {
    const runs = listSyncRuns(ctx.db, instanceId);
    expect(runs).toHaveLength(2);
    expect(runs[0].changesCount).toBe(14);
    expect(runs[0].comparedToRunId).toBe(runs[1].id);
  });

  it('compara A e B pelo motor de diferenças: contagens por tipo batem com a lista de mudanças', () => {
    const [b, a] = listSyncRuns(ctx.db, instanceId);
    const view = loadRunComparison(ctx.db, instanceId, a.id, b.id);
    expect(view).not.toBeNull();
    const counted = Object.values(view!.result.counts).reduce((sum, n) => sum + n, 0);
    expect(counted).toBe(view!.result.changes.length);
  });
});

describe('diferenças e detalhe', () => {
  it('lista as 14 diferenças e filtra por tipo, módulo e revisão', () => {
    expect(listChanges(ctx.db, { instanceId }).total).toBe(14);
    expect(listChanges(ctx.db, { instanceId, type: 'removed' }).total).toBe(2);
    expect(listChanges(ctx.db, { instanceId, type: 'possible_id_change' }).total).toBe(1);
    expect(listChanges(ctx.db, { instanceId, module: 'assets' }).total).toBe(1);
    expect(listChanges(ctx.db, { instanceId, review: 'confirmed' }).total).toBe(1);
  });

  it('detalhe de campos alterados mostra a diferença calculada entre versões', () => {
    const change = listChanges(ctx.db, { instanceId, type: 'fields_changed', module: 'service_catalog' }).rows[0];
    const detail = getChangeDetail(ctx.db, change.id);
    expect(detail?.fieldDiffs).toEqual([
      expect.objectContaining({ path: 'description', kind: 'changed' }),
    ]);
  });

  it('detalhe de possível troca de ID traz a pontuação da correspondência', () => {
    const change = listChanges(ctx.db, { instanceId, type: 'possible_id_change' }).rows[0];
    const detail = getChangeDetail(ctx.db, change.id);
    expect(detail?.matches[0]).toMatchObject({ score: 0.92, oldExternalId: '32', newExternalId: '25' });
  });

  it('recurso 25 tem duas versões, relação para o artigo 32 e origem do endpoint', () => {
    const [row] = listResources(ctx.db, { instanceId, module: 'service_catalog', search: 'Instalação de software' }).rows.filter((r) => r.externalId === '25');
    const detail = getResourceDetail(ctx.db, row.id);
    expect(detail?.versions).toHaveLength(2);
    expect(detail?.relations.outgoing).toEqual([expect.objectContaining({ otherExternalRef: '32', relationType: 'artigo_relacionado' })]);
    expect(detail?.origin.sourceEndpoint).toBe('/api/v2/service_catalog/items/25');
    expect(detail?.instance.isDemo).toBe(true);
  });

  it('auditoria da instância demonstrativa tem 6 eventos', () => {
    expect(listAuditEvents(ctx.db, { instanceId }).total).toBe(6);
  });
});


describe('isolamento dos detalhes pela instância ativa (A-09)', () => {
  it('recursos e diferenças de outra instância ficam inacessíveis; trocar de volta preserva o histórico', () => {
    const resource = listResources(ctx.db, { instanceId }).rows[0];
    const change = listChanges(ctx.db, { instanceId }).rows[0];
    const original = getResourceDetail(ctx.db, resource.id)!;
    const other = insertRealInstance(ctx.db, 'https://outra.freshservice.com');
    try {
      setActiveInstanceId(ctx.db, other);
      expect(getResourceDetail(ctx.db, resource.id)).toBeNull();
      expect(getChangeDetail(ctx.db, change.id)).toBeNull();
      setActiveInstanceId(ctx.db, null);
      expect(getResourceDetail(ctx.db, resource.id)).toBeNull();
      expect(getChangeDetail(ctx.db, change.id)).toBeNull();
    } finally {
      setActiveInstanceId(ctx.db, instanceId);
    }
    expect(getResourceDetail(ctx.db, resource.id)?.versions).toEqual(original.versions);
    expect(getChangeDetail(ctx.db, change.id)?.change.id).toBe(change.id);
  });
});
