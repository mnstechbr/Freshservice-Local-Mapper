import { type Page, test as base, expect } from '@playwright/test';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * Teste com rede bloqueada: só o loopback do app responde. Qualquer outro host é abortado,
 * inclusive popups de autenticação OAuth. Nenhuma instância real é contatada.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    const unexpected: string[] = [];
    await context.route('**/*', (route) => {
      const { hostname } = new URL(route.request().url());
      if (LOCAL_HOSTS.has(hostname)) return route.continue();
      unexpected.push(hostname);
      return route.abort('blockedbyclient');
    });
    await use(context);
    expect(unexpected, 'nenhuma requisição do navegador pode sair do loopback').toEqual([]);
  },
});

export { expect };

/**
 * Coleta erros de runtime e de console da página. Ignora só "Failed to load resource": respostas HTTP
 * de erro esperadas (ex.: 409 demo_instance) já aparecem na UI. Navegação com status 200 é checada à parte.
 */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (message.text().startsWith('Failed to load resource')) return;
    errors.push(`console: ${message.text()}`);
  });
  return errors;
}
