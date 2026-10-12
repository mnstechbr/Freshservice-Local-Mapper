import { collectErrors, expect, test } from './fixtures';

/**
 * Sem FSLM_SIMULATOR=1 (modo prod e dev), nenhuma tela mostra a faixa do simulador e as rotas de simulação
 * respondem 404. O texto da faixa é o próprio marcador, então ele não pode aparecer em lugar nenhum.
 */
const TEXTO_FAIXA = 'autenticação fictícia';

test('sem FSLM_SIMULATOR=1: nenhuma página mostra a faixa SIMULADOR e /simulador não existe', async ({ page, request }) => {
  const errors = collectErrors(page);

  for (const rota of ['/', '/configuracoes', '/tickets', '/diferencas']) {
    await page.goto(rota);
    await expect(page.getByTestId('simulator-banner')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(TEXTO_FAIXA);
  }

  expect((await request.get('/simulador')).status()).toBe(404);
  const controle = await request.post('/simulador/control', {
    headers: { 'content-type': 'application/json', origin: new URL(page.url()).origin },
    data: { action: 'state' },
  });
  expect(controle.status()).toBe(404);

  expect(errors).toEqual([]);
});
