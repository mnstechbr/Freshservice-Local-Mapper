/**
 * [SIMULADOR] Cenários de autenticação, um teste por cenário. Cada teste reseta o simulador e usa instância
 * e perfil novos (nome único), então nenhum depende do anterior.
 * AVISO: NÃO é autenticação Freshworks nem Freshservice. Tudo é fictício (FSLM_SIMULATOR=1, TLD .invalid).
 */
import type { APIRequestContext, Page, Route } from '@playwright/test';
import { collectErrors, expect, test } from '../ui-e2e/fixtures';
import {
  ANALYST,
  MFA_ANALYST,
  MFA_CODE,
  RESTRICT_CLIENT_ID,
  RESTRICT_CLIENT_SECRET,
  SIM_CLIENT_ID,
  SIM_CLIENT_SECRET,
  SIM_ORIGIN,
  autorizar,
  conectarPelaUrl,
  controle,
  criarPerfil,
  desconectar,
  escoposPadrao,
  esperarStatus,
  executarSincronizacao,
  expectSemSegredos,
  fluxoCompleto,
  instanciaHost,
  instanciaUrl,
  logarNoSimulador,
  nomeUnico,
  orgUrl,
  resetSimulador,
  statusConexao,
  testarConexao,
} from './helpers';

// Sem modo serial: cada cenário é independente (reset + instância própria). workers: 1 já mantém a ordem,
// e uma falha não pode pular os cenários seguintes.

/** Perfil de teste com nome e domínio únicos. Escopos padrão de leitura, salvo quando informados. */
async function perfilDeTeste(
  request: APIRequestContext,
  base: string,
  app: { clientId: string; clientSecret: string },
  extras: { scopes?: string[]; allowManage?: boolean } = {},
): Promise<string> {
  const nome = nomeUnico(base);
  await criarPerfil(request, {
    nome: `Perfil ${nome}`,
    orgUrl: orgUrl(nome),
    clientId: app.clientId,
    clientSecret: app.clientSecret,
    dominio: instanciaHost(nome),
    ...extras,
  });
  return nome;
}

test('[SIMULADOR] já autenticado (cookie SSO): segunda conexão vai direto ao consentimento', async ({ page, request }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await resetSimulador(request);
  const nome = await perfilDeTeste(request, 'sso', { clientId: SIM_CLIENT_ID, clientSecret: SIM_CLIENT_SECRET });

  const primeira = await conectarPelaUrl(page, nome);
  await fluxoCompleto(primeira, ANALYST);
  await esperarStatus(page, /Conectado/);
  await desconectar(page);

  const segunda = await conectarPelaUrl(page, nome);
  await expect(segunda.getByTestId('sim-email'), 'sem formulário de login com sessão SSO').toHaveCount(0);
  await expect(segunda.getByTestId('sim-allow')).toBeVisible();
  await autorizar(segunda);
  await esperarStatus(page, /Conectado/);

  expect(errors).toEqual([]);
});

test('[SIMULADOR] sem sessão: a página de login do simulador é exibida e o painel não alega conexão', async ({ page, request }) => {
  const errors = collectErrors(page);
  await resetSimulador(request);
  const nome = await perfilDeTeste(request, 'sem-sessao', { clientId: SIM_CLIENT_ID, clientSecret: SIM_CLIENT_SECRET });

  const popup = await conectarPelaUrl(page, nome);
  await expect(popup.getByTestId('sim-login-submit')).toBeVisible();
  await expect(popup.getByTestId('sim-allow')).toHaveCount(0);
  await expect(statusConexao(page)).not.toContainText('Conectado');

  expect(errors).toEqual([]);
});

test('[SIMULADOR] usuário com MFA: etapa de código, conexão e agentes "Sem permissão" por papel', async ({ page, request }) => {
  test.setTimeout(300_000);
  const errors = collectErrors(page);
  await resetSimulador(request);
  const escopos = [...(await escoposPadrao(request)), 'freshservice.agents.manage'];
  const nome = await perfilDeTeste(
    request,
    'mfa',
    { clientId: SIM_CLIENT_ID, clientSecret: SIM_CLIENT_SECRET },
    { scopes: escopos, allowManage: true },
  );

  const popup = await conectarPelaUrl(page, nome);
  await logarNoSimulador(popup, MFA_ANALYST);
  await expect(popup.getByTestId('sim-mfa-input')).toBeVisible();
  await popup.getByTestId('sim-mfa-input').fill(MFA_CODE);
  await popup.getByTestId('sim-mfa-submit').click();
  await autorizar(popup);
  await esperarStatus(page, /Conectado/);

  await executarSincronizacao(page, request, 'Mapear tudo');
  // Agentes: papel negado (Sem permissão), não escopo. Grupos: escopo .manage não concedido (Escopo não autorizado).
  await page.goto('/usuarios');
  await expect(page.getByText('Sem permissão').first()).toBeVisible();
  await expect(page.getByText('Escopo não autorizado').first()).toBeVisible();

  expect(errors).toEqual([]);
});

test('[SIMULADOR] aplicativo OAuth não registrado: o simulador recusa e o painel não alega conexão', async ({ page, request }) => {
  const errors = collectErrors(page);
  await resetSimulador(request);
  const nome = await perfilDeTeste(request, 'naoreg', { clientId: 'sim-client-desconhecido', clientSecret: 'segredo-ficticio-desconhecido' });

  const popup = await conectarPelaUrl(page, nome);
  await expect(popup.getByTestId('sim-error')).toContainText('Aplicativo OAuth não registrado');
  await expect(statusConexao(page)).not.toContainText('Conectado');

  expect(errors).toEqual([]);
});

test('[SIMULADOR] autorização negada: Negar leva a "Autorização negada" sem token', async ({ page, request }) => {
  const errors = collectErrors(page);
  await resetSimulador(request);
  const nome = await perfilDeTeste(request, 'negada', { clientId: SIM_CLIENT_ID, clientSecret: SIM_CLIENT_SECRET });

  const popup = await conectarPelaUrl(page, nome);
  await logarNoSimulador(popup, ANALYST);
  await popup.getByTestId('sim-deny').click();
  await popup.waitForURL(/\/auth\/concluido/, { timeout: 30_000 });
  await esperarStatus(page, /Autorização negada/);
  await expect(statusConexao(page)).not.toContainText('Conectado');

  expect(errors).toEqual([]);
});

test('[SIMULADOR] token expirado e refresh revogado: Testar conexão mostra "Sessão expirada"', async ({ page, request }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await resetSimulador(request);
  const nome = await perfilDeTeste(request, 'expirado', { clientId: SIM_CLIENT_ID, clientSecret: SIM_CLIENT_SECRET });

  const popup = await conectarPelaUrl(page, nome);
  await fluxoCompleto(popup, ANALYST);
  await esperarStatus(page, /Conectado/);

  await controle(request, { action: 'expire_access_tokens', user_email: ANALYST.email });
  await controle(request, { action: 'revoke_refresh_tokens', user_email: ANALYST.email });
  await testarConexao(page);
  await esperarStatus(page, /Sessão expirada/);

  expect(errors).toEqual([]);
});

test('[SIMULADOR] só o access token expirou: o refresh renova e a conexão continua Conectado', async ({ page, request }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await resetSimulador(request);
  const nome = await perfilDeTeste(request, 'refresh', { clientId: SIM_CLIENT_ID, clientSecret: SIM_CLIENT_SECRET });

  const popup = await conectarPelaUrl(page, nome);
  await fluxoCompleto(popup, ANALYST);
  await esperarStatus(page, /Conectado/);

  await controle(request, { action: 'expire_access_tokens', user_email: ANALYST.email });
  // Captura o corpo real da mesma requisição do clique antes de entregá-lo ao renderer.
  // A leitura tardia de Response.json pode perder o lifecycle durante router.refresh.
  const endpoint = `${SIM_ORIGIN}/api/connection/test`;
  let resolveCaptured!: (value: { status: number; json: { status?: string } }) => void;
  let rejectCaptured!: (error: unknown) => void;
  const captured = new Promise<{ status: number; json: { status?: string } }>((resolve, reject) => {
    resolveCaptured = resolve;
    rejectCaptured = reject;
  });
  const handler = async (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    try {
      const upstream = await route.fetch({ maxRetries: 0, maxRedirects: 0, timeout: 30_000 });
      const bytes = await upstream.body();
      const result = { status: upstream.status(), json: JSON.parse(bytes.toString('utf8')) as { status?: string } };
      await route.fulfill({ response: upstream, body: bytes });
      resolveCaptured(result);
    } catch (error) {
      rejectCaptured(error);
      await route.abort();
    }
  };
  await page.route(endpoint, handler);
  try {
    const [resultado] = await Promise.all([captured, testarConexao(page)]);
    expect(resultado.status).toBe(200);
    expect(resultado.json.status).toBe('connected');
  } finally {
    await page.unroute(endpoint, handler);
  }
  await esperarStatus(page, /Conectado/);

  expect(errors).toEqual([]);
});

test('[SIMULADOR] app restrito sem escopo de metadados: "Escopo insuficiente"', async ({ page, request }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await resetSimulador(request);
  // O app restrito só recebe tickets.view. Pedir escopos fora dele faz o simulador recusar com invalid_scope
  // antes da tela de login; por isso o perfil pede só o escopo que o app concede, e a verificação é que falha.
  const nome = await perfilDeTeste(
    request,
    'restrito',
    { clientId: RESTRICT_CLIENT_ID, clientSecret: RESTRICT_CLIENT_SECRET },
    { scopes: ['freshservice.tickets.view'] },
  );

  const popup = await conectarPelaUrl(page, nome);
  await fluxoCompleto(popup, ANALYST);
  await esperarStatus(page, /Escopo insuficiente/, 60_000);
  await expect(statusConexao(page)).not.toContainText('Conectado');

  expect(errors).toEqual([]);
});

test('[SIMULADOR] módulo sem permissão de papel: fica "Sem permissão" e a execução termina parcial', async ({ page, request }) => {
  test.setTimeout(300_000);
  const errors = collectErrors(page);
  await resetSimulador(request);
  const escopos = [...(await escoposPadrao(request)), 'freshservice.agents.manage'];
  const nome = await perfilDeTeste(
    request,
    'parcial',
    { clientId: SIM_CLIENT_ID, clientSecret: SIM_CLIENT_SECRET },
    { scopes: escopos, allowManage: true },
  );

  const popup = await conectarPelaUrl(page, nome);
  await fluxoCompleto(popup, ANALYST);
  await esperarStatus(page, /Conectado/);
  await executarSincronizacao(page, request, 'Mapear tudo');

  await page.goto('/usuarios');
  await expect(page.getByText('Sem permissão').first()).toBeVisible();
  // Execução parcial, não falha: o histórico registra "Parcial" e os demais módulos seguem coletando.
  await page.goto('/historico');
  await expect(page.locator('body')).toContainText('Parcial');

  expect(errors).toEqual([]);
});

test('[SIMULADOR] callback inválido (state forjado ou ausente): não conecta e não guarda token', async ({ page, request }) => {
  const errors = collectErrors(page);
  await resetSimulador(request);
  const nome = await perfilDeTeste(request, 'callback', { clientId: SIM_CLIENT_ID, clientSecret: SIM_CLIENT_SECRET });
  // Cria a instância (sem abrir autorização) para o painel ter um alvo.
  const criada = await request.post(`${SIM_ORIGIN}/api/instances`, {
    headers: { 'content-type': 'application/json', origin: SIM_ORIGIN },
    data: { base_url: instanciaUrl(nome) },
  });
  expect(criada.status()).toBeLessThan(300);

  for (const url of [
    `${SIM_ORIGIN}/api/auth/oauth/callback?code=codigo-ficticio&state=estado-forjado`,
    `${SIM_ORIGIN}/api/auth/oauth/callback?code=codigo-ficticio`,
  ]) {
    const resposta = await request.get(url, { maxRedirects: 0 });
    expect(resposta.status()).toBe(303);
    expect(resposta.headers().location ?? '').toContain('/auth/concluido');
  }

  await page.goto('/');
  await expect(statusConexao(page)).not.toContainText('Conectado');
  const estado = await request.get(`${SIM_ORIGIN}/api/connection/status`);
  expect(await estado.text()).not.toContain('"connected"');

  expect(errors).toEqual([]);
});

test('[SIMULADOR] erro de rede: "Erro de conexão" mantém tokens; ao voltar, Conectado sem novo login', async ({ page, request }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await resetSimulador(request);
  const nome = await perfilDeTeste(request, 'rede', { clientId: SIM_CLIENT_ID, clientSecret: SIM_CLIENT_SECRET });

  const popup = await conectarPelaUrl(page, nome);
  await fluxoCompleto(popup, ANALYST);
  await esperarStatus(page, /Conectado/);

  const novasAbas: Page[] = [];
  page.context().on('page', (aba) => novasAbas.push(aba));

  await controle(request, { action: 'configure', network: 'all' });
  await testarConexao(page);
  await esperarStatus(page, /Erro de conexão/);

  await controle(request, { action: 'configure', network: 'none' });
  await testarConexao(page);
  await esperarStatus(page, /Conectado/);
  expect(novasAbas, 'recuperar a rede não pode exigir novo login').toHaveLength(0);

  expect(errors).toEqual([]);
});


test('[SIMULADOR] regressão: perfil com callback 127.0.0.1 também conecta', async ({ page, request }) => {
  await resetSimulador(request);
  const nome = nomeUnico('callback-ip');
  await criarPerfil(request, {
    nome: `Perfil ${nome}`, orgUrl: orgUrl(nome), clientId: SIM_CLIENT_ID,
    clientSecret: SIM_CLIENT_SECRET, dominio: instanciaHost(nome), redirectHost: '127.0.0.1',
  });
  const popup = await conectarPelaUrl(page, nome);
  expect(new URL(popup.url()).hostname).toBe('127.0.0.1');
  await fluxoCompleto(popup, ANALYST);
  await esperarStatus(page, /Conectado/);
  expectSemSegredos(await page.content());
});
