import { expect, test } from '@playwright/test';

// Regressão do laço de recarga em dev (etapa 6): com a página aberta e sem interação, `/` não pode
// ser recarregado em laço. Conta carregamentos completos do documento (evento load do frame principal).
// Atualizações de histórico do próprio Next (replaceState na hidratação) não contam como recarga.
test('/ não recarrega em laço: no máximo 1 carregamento do documento em 30 s', async ({ page }) => {
  let documentLoads = 0;
  page.on('load', () => {
    documentLoads += 1;
  });

  await page.goto('/');
  await page.waitForTimeout(30_000);

  expect(documentLoads).toBeLessThanOrEqual(1);
});
