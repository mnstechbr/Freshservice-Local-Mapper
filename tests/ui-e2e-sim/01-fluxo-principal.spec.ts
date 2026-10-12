/**
 * [SIMULADOR] Fluxo principal ponta a ponta: um único teste serial, passos numerados.
 * AVISO: NÃO é autenticação Freshworks nem Freshservice. Provedor OAuth e API v2 FICTÍCIOS (FSLM_SIMULATOR=1),
 * com fixtures sintéticas (TLD .invalid). Não comprova homologação com a conta real de nenhum cliente.
 */
import type { Page } from '@playwright/test';
import { collectErrors, expect, test } from '../ui-e2e/fixtures';
import {
  ANALYST,
  SIM_CLIENT_ID,
  SIM_CLIENT_SECRET,
  SIM_ORIGIN,
  autorizar,
  controle,
  conectarPelaUrl,
  criarPerfil,
  desconectar,
  esperarStatus,
  executarSincronizacao,
  expectSemSegredos,
  instanciaHost,
  instanciaUrl,
  logarNoSimulador,
  marcaDaPagina,
  marcarPagina,
  nomeUnico,
  orgUrl,
  resetSimulador,
  statusConexao,
  testarConexao,
} from './helpers';

test.describe.configure({ mode: 'serial' });

test('[SIMULADOR] fluxo principal: configuração administrativa, autorização, sincronização, diferenças e desconexão', async ({
  page,
  request,
}) => {
  test.setTimeout(420_000);
  const errors = collectErrors(page);
  const instancia = nomeUnico('fluxo');
  const abasAbertas: Page[] = [];

  await resetSimulador(request);

  await test.step('1. app sem configuração: sem formulário técnico; Conectar mostra configuração ausente e não abre aba', async () => {
    page.context().on('page', (aba) => abasAbertas.push(aba));
    await page.goto('/');
    await expect(page.locator('input[name="api_key"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Salvar chave' })).toHaveCount(0);

    await page.locator('#base-url').fill(instanciaUrl(instancia));
    await page.getByTestId('connection-connect').click();

    await expect(page.getByTestId('connection-card').getByRole('alert')).toContainText('Configuração administrativa ausente');
    await expect(statusConexao(page)).toHaveText(/Status: Configuração administrativa ausente/);
    // Regressão coberta: sem perfil, Conectar não abre aba (nem about:blank) antes da checagem do perfil.
    expect.soft(abasAbertas, 'nenhuma aba de autenticação deve abrir sem perfil').toHaveLength(0);
  });

  await test.step('2. administrador pré-configura o perfil em Configurações → Administração da integração', async () => {
    await page.goto('/configuracoes');
    await page.getByTestId('integration-admin-new').click();
    const formulario = page.getByTestId('integration-profile-form');
    await formulario.locator('#ip-name').fill('Perfil fictício do fluxo principal');
    await formulario.locator('#ip-org').fill(orgUrl(instancia));
    await formulario.locator('#ip-client-id').fill(SIM_CLIENT_ID);
    await formulario.locator('#ip-client-secret').fill(SIM_CLIENT_SECRET);
    await formulario.locator('#ip-domains').fill(instanciaHost(instancia));
    // F4: callback localhost com painel canônico em 127.0.0.1.
    await formulario.locator('#ip-redirect-host').selectOption('localhost');
    await formulario.locator('input[name="scopes"][value="freshservice.departments.view"]').check();
    await page.getByTestId('integration-profile-save').click();

    await expect(page.getByTestId('integration-profile-row')).toHaveCount(1);
    await expect(page.getByTestId('integration-profile-secret-badge').first()).toBeVisible();
    expectSemSegredos(await page.content());
  });

  let popup: Page | undefined;
  let marcaAntes = '';

  await test.step('3-4. analista informa só a URL e clica Conectar: abre a autorização em nova aba', async () => {
    marcaAntes = 'sem-recarga';
    popup = await conectarPelaUrl(page, instancia);
    await marcarPagina(page, marcaAntes);
    expect(popup.url()).toContain('http://localhost:3112/simulador/oauth/authorize');
    const localhostCookies = await page.context().cookies('http://localhost:3112/api/auth/oauth/callback');
    const dashboardCookies = await page.context().cookies(`${SIM_ORIGIN}/api/auth/oauth/callback`);
    expect(localhostCookies.find((cookie) => cookie.name === 'fslm_oauth_state')).toMatchObject({
      domain: 'localhost', httpOnly: true, sameSite: 'Lax', path: '/api/auth/oauth',
    });
    expect(dashboardCookies.some((cookie) => cookie.name === 'fslm_oauth_state')).toBe(false);
  });

  await test.step('5-6. login com o analista fictício e Autorizar; callback local conclui', async () => {
    await logarNoSimulador(popup!, ANALYST);
    await expect(popup!.getByTestId('sim-allow')).toBeVisible();
    const canonicalDone = popup!.waitForURL(`${SIM_ORIGIN}/auth/concluido?conn=connected`, { waitUntil: 'domcontentloaded' });
    await autorizar(popup!);
    await canonicalDone;
    expect((await page.context().cookies('http://localhost:3112/api/auth/oauth/callback'))
      .some((cookie) => cookie.name === 'fslm_oauth_state')).toBe(false);
  });

  await test.step('7. aba original passa a Conectado sozinha, sem recarregar a página', async () => {
    await esperarStatus(page, /Conectado/, 30_000);
    expect(await marcaDaPagina(page), 'a página não pode ter sido recarregada').toBe(marcaAntes);
  });

  await test.step('8-9. Testar conexão responde OK e mantém Conectado', async () => {
    await testarConexao(page);
    await esperarStatus(page, /Conectado/);
  });

  await test.step('10. Mapear tudo conclui; módulo sem escopo aparece como "Escopo não autorizado"', async () => {
    await executarSincronizacao(page, request, 'Mapear tudo');
    // Módulo sem escopo no perfil (grupos exigem .manage) aparece na página do módulo, não falha a coleta.
    await page.goto('/usuarios');
    await expect(page.getByText('Escopo não autorizado').first()).toBeVisible();
  });

  await test.step('11. inventário mostra os registros mapeados', async () => {
    await page.goto('/tickets');
    await expect(page.locator('body')).toContainText('Ticket sintético');
  });

  await test.step('12. dataset alterado pela API de controle; Sincronizar novamente conclui', async () => {
    await controle(request, { action: 'upsert_record', resource: 'tickets', record: { id: 1, subject: 'Ticket alterado pelo teste' } });
    await controle(request, { action: 'delete_record', resource: 'tickets', id: 2 });
    await executarSincronizacao(page, request, 'Sincronizar novamente');
  });

  await test.step('13. /diferencas mostra a alteração e a remoção', async () => {
    await page.goto('/diferencas');
    await expect(page.locator('body')).toContainText(/Ticket alterado pelo teste|Campos alterados/);
    await expect(page.locator('body')).toContainText(/Removido/);
  });

  await test.step('14. Desconectar leva a Desconectado, inclusive após recarregar', async () => {
    await page.goto('/');
    await desconectar(page);
    await page.reload();
    await expect(statusConexao(page)).toHaveText(/Status: Desconectado/);
    await expect(statusConexao(page)).not.toContainText('Conectado');
  });

  await test.step('15. nenhum segredo ou token em página, console ou API de perfis', async () => {
    const resposta = await request.get(`${SIM_ORIGIN}/api/admin/integration-profiles`);
    expect(resposta.ok()).toBeTruthy();
    expectSemSegredos(await resposta.text());
    await page.goto('/configuracoes');
    expectSemSegredos(await page.content());
    expectSemSegredos(errors.join('\n'));
  });

  expect(errors).toEqual([]);
});
