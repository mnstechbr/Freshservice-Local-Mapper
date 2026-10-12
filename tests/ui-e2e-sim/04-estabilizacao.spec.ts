/** Fluxo com API key e dados inteiramente sintéticos; não homologa uma conta Freshservice real. */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { collectErrors, expect, test } from '../ui-e2e/fixtures';
import {
  ANALYST, SIM_ORIGIN, controle, desconectar, esperarStatus, executarSincronizacao,
  expectSemSegredos, instanciaHost, instanciaUrl, nomeUnico, resetSimulador,
} from './helpers';

const API_KEY = 'chave-ficticia-simulador-0001';
const HEADERS = { origin: SIM_ORIGIN, 'content-type': 'application/json' };
const MODULE_KEYS = [
  'service_catalog.categories', 'service_catalog.items', 'service_catalog.item_details',
  'knowledge_base.categories', 'knowledge_base.folders', 'knowledge_base.articles',
  'tickets.tickets', 'tickets.form_fields', 'users_groups.agents', 'users_groups.requesters',
  'users_groups.departments', 'users_groups.agent_groups', 'users_groups.requester_groups',
  'assets.assets', 'assets.asset_types', 'itsm.problems', 'itsm.changes', 'itsm.releases',
  'settings.workspaces', 'settings.sla_policies', 'settings.locations', 'settings.products', 'settings.vendors',
] as const;

/** Abre somente o banco isolado da rodada, em modo de leitura. Nunca usa FSLM_DATA_DIR/padrão do SO. */
function readSqlite<T>(read: (db: Database.Database) => T): T {
  const root = path.resolve(process.cwd(), '.e2e-data');
  const supplied = process.env.FSLM_E2E_DATA_DIR;
  if (!supplied) throw new Error('FSLM_E2E_DATA_DIR não foi definido pelo Playwright.');
  const dataDir = path.resolve(supplied);
  if (!dataDir.startsWith(`${root}${path.sep}`)) throw new Error('Banco fora do diretório isolado de E2E.');
  const db = new Database(path.join(dataDir, 'fslm.db'), { readonly: true, fileMustExist: true, timeout: 5000 });
  try { return read(db); } finally { db.close(); }
}

interface RunRow {
  id: number; status: string; records_count: number; modules_processed: number; failures_count: number;
  started_at: number; finished_at: number;
}
interface ModuleRow {
  module_key: string; status: string; complete: number; records_count: number; pages_fetched: number;
}
interface ResourceRow { id: number; module_key: string; external_id: string; current_name: string | null }

test('[SIMULADOR] cadastro sem OAuth, API key, 23 módulos, versões persistidas e consulta offline', async ({ page, request }, testInfo) => {
  test.setTimeout(420_000);
  const errors = collectErrors(page);
  const instanceName = nomeUnico('estabilizacao');
  const popups: string[] = [];
  const authRequests: string[] = [];
  page.context().on('page', (popup) => popups.push(popup.url()));
  page.on('request', (req) => {
    // Preflight GET só consulta configuração; início/troca de autenticação nunca devem ocorrer.
    if (/\/api\/auth\/oauth\/(launch|start|callback)$/.test(new URL(req.url()).pathname)) authRequests.push(req.url());
  });
  await resetSimulador(request);
  let instanceId = 0;
  let firstRun!: RunRow;
  let secondRun!: RunRow;
  let ticketId = 0;
  let firstTicketVersion = '';
  const timings: Record<string, number> = {};

  const latestRun = () => readSqlite((db) => db.prepare(
    'SELECT id, status, records_count, modules_processed, failures_count, started_at, finished_at FROM sync_runs WHERE instance_id = ? ORDER BY id DESC LIMIT 1',
  ).get(instanceId) as RunRow);
  const modulesFor = (id: number) => readSqlite((db) => db.prepare(
    'SELECT module_key, status, complete, records_count, pages_fetched FROM sync_module_results WHERE run_id = ? ORDER BY module_key',
  ).all(id) as ModuleRow[]);

  await test.step('A-15: salvar URL em Configurações não exige perfil nem abre autenticação', async () => {
    const profilesResponse = await request.get(`${SIM_ORIGIN}/api/admin/integration-profiles`);
    expect(profilesResponse.ok()).toBe(true);
    const profilesBefore = await profilesResponse.json();
    await page.goto('/configuracoes');
    await page.locator('#instance-url').fill(instanciaUrl(instanceName));
    const saved = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/instances' && res.request().method() === 'POST');
    await page.getByRole('button', { name: 'Salvar instância', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    instanceId = (await response.json()).active_instance_id as number;
    expect(instanceId).toBeGreaterThan(0);
    await expect(page.getByTestId('instance-save-form').getByRole('status')).toContainText('Instância salva');
    const status = await (await request.get(`${SIM_ORIGIN}/api/connection/status`)).json();
    expect(status.instance.origin).toBe(instanciaUrl(instanceName));
    expect(status.oauth_configured).toBe(false);
    expect(status.status).not.toBe('connected');
    const profilesAfter = await (await request.get(`${SIM_ORIGIN}/api/admin/integration-profiles`)).json();
    expect(profilesAfter).toEqual(profilesBefore);
    expect(popups).toEqual([]);
    expect(authRequests).toEqual([]);
  });

  await test.step('API key inválida não é salva; chave fictícia válida conecta e é apagada do campo', async () => {
    const form = page.getByRole('form', { name: 'Configurar chave de API' });
    await page.getByTestId('advanced-api-key-section').locator('summary').click();
    await form.locator('input[name="api_key"]').fill('chave-invalida-sintetica');
    const rejected = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/connection/api-key');
    await form.getByRole('button', { name: 'Salvar chave', exact: true }).click();
    expect((await (await rejected).json()).status).not.toBe('connected');
    await expect(form.getByRole('alert')).toContainText('Nada foi salvo');
    expect(readSqlite((db) => db.prepare('SELECT count(*) AS n FROM connections WHERE instance_id = ?').get(instanceId))).toEqual({ n: 0 });
    await controle(request, { action: 'set_user', name: 'Analista Fictício', email: ANALYST.email,
      password: ANALYST.password, mfa: false, permissions: { agents: true } });
    await form.locator('input[name="api_key"]').fill(API_KEY);
    const connected = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/connection/api-key');
    await form.getByRole('button', { name: 'Salvar chave', exact: true }).click();
    expect((await (await connected).json()).status).toBe('connected');
    await expect(form.getByRole('status')).toContainText('Chave salva');
    await expect(form.locator('input[name="api_key"]')).toHaveValue('');
    await page.goto('/');
    await esperarStatus(page, /Conectado/);
    expect(popups).toEqual([]);
    expect(authRequests).toEqual([]);
  });

  await test.step('fixture inclui display_id, formulário e relações para todos os módulos filhos', async () => {
    for (let id = 1; id <= 3; id++) {
      await controle(request, { action: 'upsert_record', resource: 'service_catalog/items', record: {
        id, display_id: id, category_id: 1, custom_fields: [{ id: id * 10, name: 'ambiente',
          label: 'Ambiente sintético', required: true, field_type: 'dropdown', choices: [{ value: 'Teste' }] }],
      } });
    }
    for (let id = 1; id <= 2; id++) {
      await controle(request, { action: 'upsert_record', resource: 'solutions/folders', record: { id, category_id: id } });
      await controle(request, { action: 'upsert_record', resource: 'solutions/articles', record: {
        id, title: `Artigo sintético ${id}`, folder_id: id,
      } });
    }
    const preferences = await request.put(`${SIM_ORIGIN}/api/sync/preferences`, { headers: HEADERS,
      data: { modules: [...MODULE_KEYS], metadataOnly: {}, storeRaw: false } });
    expect(preferences.ok()).toBe(true);
  });

  await test.step('Diagnosticar acesso conclui sem negar nenhum módulo consultável', async () => {
    await page.goto('/');
    const started = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/diagnostics' && res.request().method() === 'POST');
    const begin = Date.now();
    await page.getByRole('button', { name: 'Diagnosticar acesso', exact: true }).click();
    expect((await started).status()).toBe(202);
    await expect.poll(async () => (await (await request.get(`${SIM_ORIGIN}/api/diagnostics`)).json()).running,
      { timeout: 90_000, intervals: [500, 1000] }).toBe(false);
    timings.diagnostics_elapsed_ms = Date.now() - begin;
    const data = await (await request.get(`${SIM_ORIGIN}/api/diagnostics`)).json();
    const modules = data.modules as { key: string; accessStatus: string; docStatus: string }[];
    expect(modules.filter((module) => module.docStatus !== 'unsupported')).toHaveLength(23);
    expect(modules.filter((module) => module.accessStatus === 'forbidden')).toEqual([]);
    // Os três módulos filhos só são testados durante a coleta, com os IDs dos pais.
    expect(modules.filter((module) => module.accessStatus === 'accessible')).toHaveLength(20);
  });

  await test.step('Mapear tudo persiste 23 módulos completos e a paginação dos 120 tickets', async () => {
    const begin = Date.now();
    await executarSincronizacao(page, request, 'Mapear tudo');
    timings.full_elapsed_ms = Date.now() - begin;
    firstRun = latestRun();
    expect(firstRun).toMatchObject({ status: 'completed', modules_processed: 23, failures_count: 0 });
    const modules = modulesFor(firstRun.id);
    expect(modules.map((row) => row.module_key)).toEqual([...MODULE_KEYS].sort());
    expect(modules.every((row) => row.status === 'completed' && row.complete === 1 && row.records_count > 0)).toBe(true);
    expect(modules.find((row) => row.module_key === 'tickets.tickets')).toMatchObject({ records_count: 120, pages_fetched: 2 });
    expect(firstRun.records_count).toBeGreaterThan(120);
    const ticket = readSqlite((db) => db.prepare("SELECT id FROM resources WHERE instance_id = ? AND module_key = 'tickets.tickets' AND external_id = '1'").get(instanceId)) as { id: number };
    ticketId = ticket.id;
    firstTicketVersion = (readSqlite((db) => db.prepare('SELECT normalized_json FROM resource_versions WHERE resource_id = ?').get(ticketId)) as { normalized_json: string }).normalized_json;
    expect(firstTicketVersion).toContain('Ticket sintético 1');
  });

  await test.step('todos os grupos e detalhes dos 23 módulos abrem; formulário e relação têm destino local', async () => {
    for (const route of ['/catalogo', '/conhecimento', '/tickets', '/usuarios', '/ativos', '/configuracoes', '/?modulo=all']) {
      expect((await page.goto(route))?.status(), route).toBe(200);
      await expect(page.locator('a[href^="/recursos/"]').first()).toBeVisible();
    }
    const representatives = readSqlite((db) => db.prepare(
      'SELECT min(id) AS id, module_key, external_id, current_name FROM resources WHERE instance_id = ? GROUP BY module_key ORDER BY module_key',
    ).all(instanceId) as ResourceRow[]);
    expect(representatives).toHaveLength(23);
    for (const resource of representatives) {
      expect((await page.goto(`/recursos/${resource.id}`))?.status(), resource.module_key).toBe(200);
      await expect(page.locator('#identificacao')).toBeVisible();
      await expect(page.locator('#campos')).toBeVisible();
      await expect(page.locator('[aria-labelledby="versoes"]')).toContainText(`Execução #${firstRun.id}`);
      if (resource.module_key === 'service_catalog.item_details') {
        await expect(page.locator('[aria-labelledby="formulario"]')).toContainText('Ambiente sintético');
      }
    }
    await page.goto(`/recursos/${ticketId}`);
    const relation = page.locator('[aria-labelledby="relacoes"] a[href^="/recursos/"]').first();
    await expect(relation).toBeVisible();
    await relation.click();
    await expect(page.locator('#identificacao')).toBeVisible();
    await expect(page.locator('[aria-labelledby="origem"]')).toContainText('/api/v2/requesters');
  });

  await test.step('segunda coleta preserva a primeira versão, registra alteração e duas execuções', async () => {
    await controle(request, { action: 'upsert_record', resource: 'tickets', record: { id: 1, subject: 'Ticket estabilizado sintético' } });
    const begin = Date.now();
    await executarSincronizacao(page, request, 'Sincronizar novamente');
    timings.resync_elapsed_ms = Date.now() - begin;
    secondRun = latestRun();
    expect(secondRun.id).toBeGreaterThan(firstRun.id);
    expect(secondRun).toMatchObject({ status: 'completed', modules_processed: 23, failures_count: 0 });
    const versions = readSqlite((db) => db.prepare('SELECT normalized_json FROM resource_versions WHERE resource_id = ? ORDER BY id').all(ticketId)) as { normalized_json: string }[];
    expect(versions).toHaveLength(2);
    expect(versions[0].normalized_json).toBe(firstTicketVersion);
    expect(versions[1].normalized_json).toContain('Ticket estabilizado sintético');
    const observedRuns = readSqlite((db) => db.prepare('SELECT run_id FROM resource_observations WHERE resource_id = ? ORDER BY run_id').all(ticketId));
    expect(observedRuns).toEqual([{ run_id: firstRun.id }, { run_id: secondRun.id }]);
    await page.goto('/historico');
    await expect(page.locator('body')).toContainText(`#${firstRun.id}`);
    await expect(page.locator('body')).toContainText(`#${secondRun.id}`);
    for (const id of [firstRun.id, secondRun.id]) expect((await page.goto(`/historico/${id}`))?.status()).toBe(200);
    await page.goto('/diferencas');
    await expect(page.locator('body')).toContainText('Ticket estabilizado sintético');
    await page.goto(`/recursos/${ticketId}`);
    await expect(page.locator('[aria-labelledby="versoes"] li')).toHaveCount(2);
  });

  await test.step('desconectar e simular ausência da API mantém consulta, histórico e versões no SQLite', async () => {
    await page.goto('/');
    await desconectar(page);
    await controle(request, { action: 'configure', network: 'all' });
    await page.goto('/tickets?q=Ticket%20estabilizado%20sint%C3%A9tico');
    await expect(page.locator('body')).toContainText('Ticket estabilizado sintético');
    await page.reload();
    await expect(page.locator('body')).toContainText('Ticket estabilizado sintético');
    await page.goto(`/recursos/${ticketId}`);
    await expect(page.locator('[aria-labelledby="versoes"] li')).toHaveCount(2);
    await expect(page.locator('[aria-labelledby="conteudo"]')).toContainText('Ticket estabilizado sintético');
    await page.goto(`/historico/${firstRun.id}`);
    await expect(page.locator('body')).toContainText('23 de 23');
    expect(latestRun().id).toBe(secondRun.id);
    expect(readSqlite((db) => db.prepare("SELECT status, secret_ref FROM connections WHERE instance_id = ? ORDER BY id DESC LIMIT 1").get(instanceId)))
      .toEqual({ status: 'disconnected', secret_ref: null });
    expect(readSqlite((db) => db.prepare('SELECT count(*) AS n FROM resource_versions rv JOIN resources r ON r.id = rv.resource_id WHERE r.instance_id = ? AND (rv.normalized_json LIKE ? OR rv.raw_json LIKE ?)').get(instanceId, `%${API_KEY}%`, `%${API_KEY}%`)))
      .toEqual({ n: 0 });
    expectSemSegredos(await page.content());
    expectSemSegredos(errors.join('\n'));
    expect(popups).toEqual([]);
    expect(authRequests).toEqual([]);
    expect(errors).toEqual([]);
  });

  const benchmark = {
    synthetic: true, real_account_validated: false, instance_host: instanciaHost(instanceName), timings,
    runs: [firstRun, secondRun].map((run) => ({ ...run, modules: modulesFor(run.id),
      pages_fetched: modulesFor(run.id).reduce((sum, module) => sum + module.pages_fetched, 0) })),
  };
  const benchmarkPath = testInfo.outputPath('benchmark-estabilizacao-sintetica.json');
  await writeFile(benchmarkPath, `${JSON.stringify(benchmark, null, 2)}\n`, 'utf8');
  await testInfo.attach('benchmark-estabilizacao-sintetica', { path: benchmarkPath, contentType: 'application/json' });
  // O estado global do simulador volta ao padrão para eventuais cenários posteriores.
  await resetSimulador(request);
});
