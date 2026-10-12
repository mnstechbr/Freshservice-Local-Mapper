import type { Page } from '@playwright/test';
import { collectErrors, expect, test } from './fixtures';
import { REFUSED_BASE_URL, SAVED_BASE_URL, seedSavedInstance } from './saved-instance';

/** Chave fictícia: nunca é um segredo real. Serve só para provar que não volta para a tela. */
const FAKE_KEY = 'chave-ficticia-e2e-0000';
const DASHBOARD_STATUS = /^Status: /;

test.beforeEach(async ({ request }) => {
  await seedSavedInstance(request);
});

test('instância salva sem perfil de integração aparece como configuração ausente, sem alegar conexão', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  await expect(page.locator('#base-url')).toHaveValue(SAVED_BASE_URL);
  const pill = page.getByRole('status').filter({ hasText: DASHBOARD_STATUS });
  await expect(pill).toHaveText(/Status: Configuração administrativa ausente/);
  await expect(pill).not.toContainText('Conectado');

  expect(errors).toEqual([]);
});

test('Conectar sem OAuth configurado mostra o aviso, não abre aba e não finge conexão', async ({ page }) => {
  const errors = collectErrors(page);
  const popups: Page[] = [];
  page.context().on('page', (popup) => popups.push(popup));

  await page.goto('/');
  const pill = page.getByRole('status').filter({ hasText: DASHBOARD_STATUS });
  await expect(pill).toHaveText(/Status: Configuração administrativa ausente/);

  await page.getByRole('button', { name: 'Conectar conta autenticada' }).click();

  const card = page.locator('section[aria-labelledby="connection-title"]');
  await expect(card.getByRole('alert')).toContainText('Configuração administrativa ausente');
  await expect(pill).not.toContainText('Conectado');
  expect(popups, 'nenhuma aba de autenticação deve ser aberta').toHaveLength(0);

  expect(errors).toEqual([]);
});

test('configurações: chave com rede bloqueada mostra erro e não reexibe a chave', async ({ page, request }) => {
  const errors = collectErrors(page);
  // Instância com TLD reservado: o app recusa o endereço sem contatar nenhum host externo.
  await seedSavedInstance(request, REFUSED_BASE_URL);
  await page.goto('/configuracoes');

  // A API key é "Opção técnica avançada" recolhida por padrão: abre a seção antes de preencher.
  await page.getByTestId('advanced-api-key-section').locator('summary').first().click();

  const field = page.locator('input[name="api_key"]');
  await expect(field).toHaveAttribute('type', 'password');
  await field.fill(FAKE_KEY);
  await page.getByRole('button', { name: 'Salvar chave' }).click();

  const form = page.locator('form[aria-label="Configurar chave de API"]');
  await expect(form.getByRole('alert')).toBeVisible();
  await expect(form.getByRole('alert')).not.toContainText(FAKE_KEY);
  await expect(field).toHaveAttribute('type', 'password');
  expect(await page.content()).not.toContain(FAKE_KEY);

  expect(errors).toEqual([]);
});
