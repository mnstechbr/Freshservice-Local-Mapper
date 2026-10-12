/**
 * AVISO: SIMULADOR LOCAL. Não é autenticação Freshworks nem Freshservice.
 * Provedor OAuth e API v2 fictícios (FSLM_SIMULATOR=1), fixtures sintéticas com TLD .invalid.
 * Nada aqui homologa o fluxo com a conta real de um cliente. Nenhum host externo é contatado: o simulador
 * é atendido em processo; o navegador só fala com 127.0.0.1 (o fixture de tests/ui-e2e bloqueia o resto).
 */
import { type APIRequestContext, type Page, expect } from '@playwright/test';

/** Origem do servidor de simulação (porta 3112, ver playwright.config.ts). Também é o Origin dos POSTs locais. */
export const SIM_ORIGIN = 'http://127.0.0.1:3112';

/** Credenciais FICTÍCIAS do simulador (fixtures de src/lib/simulator/fixtures.ts). */
export const SIM_CLIENT_ID = 'sim-client-fslm';
export const SIM_CLIENT_SECRET = 'sim-secret-ficticio-fslm';
export const RESTRICT_CLIENT_ID = 'sim-client-restrito';
export const RESTRICT_CLIENT_SECRET = 'sim-secret-ficticio-restrito';
export const ANALYST = { email: 'analista.ficticio@simulador.invalid', password: 'SenhaFicticia-2026' } as const;
export const MFA_ANALYST = { email: 'analista.mfa@simulador.invalid', password: 'SenhaFicticia-MFA' } as const;
export const MFA_CODE = '135790';

/** Marcadores que nunca podem aparecer em página, HTML, JSON de API ou console. */
export const FORBIDDEN_MARKERS = ['sim-secret-ficticio', 'sim_at', 'sim_rt', 'sim_code'] as const;

const JSON_HEADERS = { 'content-type': 'application/json', origin: SIM_ORIGIN };

/** Nome de instância único por teste (minúsculas, hífen, até 63 caracteres): cada cenário parte de instância nova. */
export function nomeUnico(prefixo: string): string {
  const sufixo = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  return `${prefixo}-${sufixo}`.slice(0, 63).replace(/-+$/, '');
}

export const instanciaHost = (nome: string): string => `${nome}.freshservice.simulador.invalid`;
export const instanciaUrl = (nome: string): string => `https://${instanciaHost(nome)}`;
export const orgUrl = (nome: string): string => `https://${nome}.myfreshworks.simulador.invalid`;

/** Chama a API de controle do simulador (POST /simulador/control). Falha se a resposta não for ok. */
export async function controle(request: APIRequestContext, acao: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resposta = await request.post(`${SIM_ORIGIN}/simulador/control`, { headers: JSON_HEADERS, data: acao });
  const corpo = (await resposta.json()) as Record<string, unknown>;
  expect(resposta.ok(), `controle ${String(acao.action)} falhou: ${JSON.stringify(corpo)}`).toBeTruthy();
  return corpo;
}

/** Volta o simulador ao estado inicial (apps, usuários, sessões, tokens e dataset). Rede volta a "none". */
export async function resetSimulador(request: APIRequestContext): Promise<void> {
  await controle(request, { action: 'reset' });
}

/** Cadastra um perfil de integração pela API administrativa (mesmo contrato da tela de Configurações). */
export async function criarPerfil(
  request: APIRequestContext,
  opcoes: {
    nome: string;
    orgUrl: string;
    clientId: string;
    clientSecret: string;
    dominio: string;
    scopes?: string[];
    allowManage?: boolean;
    redirectHost?: 'localhost' | '127.0.0.1';
  },
): Promise<void> {
  const resposta = await request.post(`${SIM_ORIGIN}/api/admin/integration-profiles`, {
    headers: JSON_HEADERS,
    data: {
      name: opcoes.nome,
      org_url: opcoes.orgUrl,
      client_id: opcoes.clientId,
      client_secret: opcoes.clientSecret,
      freshservice_domains: [opcoes.dominio],
      ...(opcoes.scopes ? { scopes: opcoes.scopes } : {}),
      ...(opcoes.allowManage !== undefined ? { allow_manage_scopes: opcoes.allowManage } : {}),
      // Exercita o callback localhost a partir do painel 127.0.0.1.
      redirect_host: opcoes.redirectHost ?? 'localhost',
    },
  });
  expect(resposta.status(), `criar perfil: ${await resposta.text()}`).toBeLessThan(300);
}

/** Escopos padrão de leitura expostos pela API de perfis (ver DEFAULT_PROFILE_SCOPES no servidor). */
export async function escoposPadrao(request: APIRequestContext): Promise<string[]> {
  const resposta = await request.get(`${SIM_ORIGIN}/api/admin/integration-profiles`);
  const corpo = (await resposta.json()) as { default_scopes?: string[] };
  expect(corpo.default_scopes?.length ?? 0, 'API de perfis deve informar default_scopes').toBeGreaterThan(0);
  return corpo.default_scopes ?? [];
}

/** Conteúdo de página, HTML e JSON não pode conter segredo nem token. */
export function expectSemSegredos(texto: string): void {
  for (const marcador of FORBIDDEN_MARKERS) {
    expect(texto, `marcador proibido "${marcador}" apareceu`).not.toContain(marcador);
  }
}

/** Abre o painel, preenche só a URL da instância e dispara Conectar. Devolve a aba de autorização (popup). */
export async function conectarPelaUrl(page: Page, instancia: string): Promise<Page> {
  await page.goto('/');
  await page.locator('#base-url').fill(instanciaUrl(instancia));
  const popupAguardado = page.context().waitForEvent('page');
  await page.getByTestId('connection-connect').click();
  const popup = await popupAguardado;
  await popup.waitForURL(/\/simulador\/oauth\/authorize/, { timeout: 30_000 });
  return popup;
}

/** Login fictício na página de autorização do simulador. */
export async function logarNoSimulador(popup: Page, credenciais: { email: string; password: string }): Promise<void> {
  await popup.getByTestId('sim-email').fill(credenciais.email);
  await popup.getByTestId('sim-password').fill(credenciais.password);
  await popup.getByTestId('sim-login-submit').click();
}

/** Autoriza o app e espera o retorno ao callback local (/auth/concluido). */
export async function autorizar(popup: Page): Promise<void> {
  await popup.getByTestId('sim-allow').click();
  await popup.waitForURL(/\/auth\/concluido/, { timeout: 30_000 });
}

/** Painel: campo de status da conexão (role=status, texto "Status: <rótulo>"). */
export function statusConexao(page: Page) {
  return page.getByTestId('connection-status');
}

/** Espera o status do card mudar para o rótulo informado, sem recarregar a página. */
export async function esperarStatus(page: Page, rotulo: RegExp, timeout = 30_000): Promise<void> {
  await expect(statusConexao(page)).toHaveText(new RegExp(`Status: ${rotulo.source}`), { timeout });
}

/** Testar conexão e espera a resposta da API de teste. */
export async function testarConexao(page: Page): Promise<void> {
  const resposta = page.waitForResponse((r) => r.url().includes('/api/connection/test'), { timeout: 60_000 });
  await page.getByTestId('connection-test').click();
  await resposta;
}

/**
 * Mapear tudo (ou Sincronizar novamente): espera o 202 da API e depois `running === false` em /api/sync/status.
 * Não depende de texto da tela, que muda conforme o resultado. Recarrega o painel no fim.
 */
export async function executarSincronizacao(
  page: Page,
  request: APIRequestContext,
  botao: 'Mapear tudo' | 'Sincronizar novamente',
): Promise<void> {
  await page.goto('/');
  const iniciou = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/sync\/(full|resync)$/.test(new URL(r.url()).pathname),
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: botao }).click();
  expect((await iniciou).status(), 'a sincronização deve ser aceita (202)').toBe(202);
  await expect
    .poll(
      async () => {
        const resposta = await request.get(`${SIM_ORIGIN}/api/sync/status`);
        return ((await resposta.json()) as { running?: unknown }).running;
      },
      { timeout: 150_000, intervals: [1_000, 2_000] },
    )
    .toBe(false);
  await page.goto('/');
}

/** Desconectar: aceita a confirmação nativa (window.confirm) e espera o status Desconectado. */
export async function desconectar(page: Page): Promise<void> {
  page.once('dialog', (dialogo) => void dialogo.accept());
  await page.getByTestId('connection-disconnect').click();
  await esperarStatus(page, /Desconectado/);
}

/** Login + MFA (quando houver) + autorização, a partir da aba de autorização. */
export async function fluxoCompleto(popup: Page, credenciais: { email: string; password: string }, mfa = false): Promise<void> {
  await logarNoSimulador(popup, credenciais);
  if (mfa) {
    await popup.getByTestId('sim-mfa-input').fill(MFA_CODE);
    await popup.getByTestId('sim-mfa-submit').click();
  }
  await autorizar(popup);
}

/** Marca de página para provar ausência de recarga: a marca precisa sobreviver até o fim do passo. */
export async function marcarPagina(page: Page, valor: string): Promise<void> {
  await page.evaluate((v) => {
    (window as unknown as Record<string, unknown>).__fslmMarca = v;
  }, valor);
}

export async function marcaDaPagina(page: Page): Promise<unknown> {
  return page.evaluate(() => (window as unknown as Record<string, unknown>).__fslmMarca);
}
