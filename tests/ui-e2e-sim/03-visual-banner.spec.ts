/**
 * [SIMULADOR] Validação visual da faixa de simulador e captura do painel para comparação com a referência
 * (Painel_Freshservice_Design .png). AVISO: NÃO é autenticação Freshworks nem Freshservice (fixtures fictícias).
 */
import { collectErrors, expect, test } from '../ui-e2e/fixtures';
import { resetSimulador } from './helpers';

test('[SIMULADOR] faixa SIMULADOR fixa no topo de todas as telas, com captura do painel', async ({ page, request }, testInfo) => {
  const errors = collectErrors(page);
  await resetSimulador(request);

  for (const rota of ['/', '/configuracoes', '/diferencas', '/simulador']) {
    await page.goto(rota);
    const faixa = page.getByTestId('simulator-banner');
    await expect(faixa).toHaveCount(1);
    await expect(faixa).toBeVisible();
    await expect(faixa).toContainText('SIMULADOR');
    const caixa = await faixa.boundingBox();
    expect(caixa?.y ?? 99).toBeLessThanOrEqual(1);
  }

  await page.goto('/');
  await page.screenshot({ path: testInfo.outputPath('painel-simulador.png'), fullPage: false });
  expect(errors).toEqual([]);
});
