import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { basicAuthorization, saveApiKey } from '../../src/lib/auth/api-key';
import { testConnection } from '../../src/lib/auth/connection';
import { createInstance, requireActiveInstance } from '../../src/lib/auth/instances';
import { findConnection } from '../../src/lib/auth/repo';
import { type Harness, INSTANCE_ORIGIN, SYNTHETIC, createHarness, json } from './helpers';

/** Segunda instância sintética (domínio fictício). */
const BETA_ORIGIN = 'https://beta-fslm.freshservice.com';

describe('isolamento de credencial entre instância A e B', () => {
  let h: Harness;
  let idA = 0;
  let idB = 0;

  beforeEach(async () => {
    h = createHarness(() => json({ ticket_form_fields: [] }, 200));
    idA = (await createInstance(h.deps, { base_url: INSTANCE_ORIGIN })).instance.id;
    await saveApiKey(h.deps, { mode: 'api_key_personal', api_key: SYNTHETIC.apiKey });
    idB = (await createInstance(h.deps, { base_url: BETA_ORIGIN })).instance.id;
    await saveApiKey(h.deps, { mode: 'api_key_personal', api_key: SYNTHETIC.otherApiKey });
    h.calls.splice(0);
  });

  afterEach(() => {
    h.cleanup();
  });

  it('cada instância tem conexão e segredo próprios', () => {
    const connA = findConnection(h.db, idA);
    const connB = findConnection(h.db, idB);
    expect(connA?.secretRef).toBeTruthy();
    expect(connB?.secretRef).toBeTruthy();
    expect(connA?.secretRef).not.toBe(connB?.secretRef);
    expect(h.vault.entries.size).toBe(2);
  });

  it('com A ativa, todas as chamadas usam a credencial de A e nenhuma a de B', async () => {
    await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
    expect(requireActiveInstance(h.deps).id).toBe(idA);
    await testConnection(h.deps);

    expect(h.calls.length).toBeGreaterThan(0);
    for (const call of h.calls) {
      expect(call.url.origin).toBe(INSTANCE_ORIGIN);
      expect(call.headers.Authorization).toBe(basicAuthorization(SYNTHETIC.apiKey));
      expect(call.headers.Authorization).not.toBe(basicAuthorization(SYNTHETIC.otherApiKey));
    }
  });

  it('trocar a instância ativa troca a identidade usada nas chamadas', async () => {
    await createInstance(h.deps, { base_url: BETA_ORIGIN });
    expect(requireActiveInstance(h.deps).id).toBe(idB);
    await testConnection(h.deps);

    expect(h.calls.length).toBeGreaterThan(0);
    for (const call of h.calls) {
      expect(call.url.origin).toBe(BETA_ORIGIN);
      expect(call.headers.Authorization).toBe(basicAuthorization(SYNTHETIC.otherApiKey));
      expect(call.headers.Authorization).not.toBe(basicAuthorization(SYNTHETIC.apiKey));
    }
  });

  it('ida e volta entre A e B não mistura credenciais', async () => {
    await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
    await testConnection(h.deps);
    await createInstance(h.deps, { base_url: BETA_ORIGIN });
    await testConnection(h.deps);
    await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
    await testConnection(h.deps);

    const pairs = h.calls.map((call) => [call.url.origin, call.headers.Authorization]);
    expect(pairs).toHaveLength(3);
    expect(pairs[0]).toEqual([INSTANCE_ORIGIN, basicAuthorization(SYNTHETIC.apiKey)]);
    expect(pairs[1]).toEqual([BETA_ORIGIN, basicAuthorization(SYNTHETIC.otherApiKey)]);
    expect(pairs[2]).toEqual([INSTANCE_ORIGIN, basicAuthorization(SYNTHETIC.apiKey)]);
  });
});
