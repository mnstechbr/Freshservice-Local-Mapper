import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { instances } from '../../src/lib/db/schema';
import { setDnsLookupForTests } from '../../src/lib/security/dns-guard';
import { useFakePublicDns } from '../helpers/dns';
import { runSync } from '../../src/lib/sync/engine';
import { runDiagnostics } from '../../src/lib/sync/diagnostics';
import { createInstance, listInstances, requireActiveInstance } from '../../src/lib/auth/instances';
import { AuthError } from '../../src/lib/auth/errors';
import { type Harness, INSTANCE_ORIGIN, createHarness } from './helpers';

describe('instâncias: cadastro, ativação e URL', () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness();
    useFakePublicDns();
  });

  afterEach(() => {
    h.cleanup();
  });

  it('sem instância ativa, requireActiveInstance responde 409', () => {
    expect(() => requireActiveInstance(h.deps)).toThrow(AuthError);
    try {
      requireActiveInstance(h.deps);
    } catch (error) {
      expect((error as AuthError).httpStatus).toBe(409);
      expect((error as AuthError).code).toBe('no_active_instance');
    }
  });

  it('cadastra, ativa e normaliza a origem', async () => {
    const result = await createInstance(h.deps, {
      base_url: `${INSTANCE_ORIGIN}/tickets?x=1`,
      display_name: 'Acme Synthetic',
    });
    expect(result.created).toBe(true);
    expect(result.instance.origin).toBe(INSTANCE_ORIGIN);
    expect(result.instance.display_name).toBe('Acme Synthetic');
    expect(result.instance.is_active).toBe(true);
    expect(requireActiveInstance(h.deps).baseUrl).toBe(INSTANCE_ORIGIN);
  });

  it('cadastrar a mesma URL reativa a existente sem duplicar', async () => {
    const first = await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
    await createInstance(h.deps, { base_url: 'https://outra-fslm.freshservice.com' });
    const again = await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
    expect(again.created).toBe(false);
    expect(again.instance.id).toBe(first.instance.id);
    const list = listInstances(h.deps);
    expect(list.instances).toHaveLength(2);
    expect(list.active_instance_id).toBe(first.instance.id);
  });

  it('nome padrão é o primeiro rótulo do host', async () => {
    const result = await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
    expect(result.instance.display_name).toBe('acme-fslm');
  });

  it('URL inválida devolve 400 com código invalid_url', async () => {
    for (const base_url of ['http://acme.freshservice.com', 'https://127.0.0.1', 'https://evil.example.com']) {
      try {
        await createInstance(h.deps, { base_url });
        throw new Error('deveria recusar');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthError);
        expect((error as AuthError).httpStatus).toBe(400);
        expect((error as AuthError).code).toBe('invalid_url');
      }
    }
  });

  it('recusa domínio customizado mesmo com flag, antes de DNS, sem alterar instâncias existentes', async () => {
    const first = await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
    const legacyOrigin = 'https://helpdesk.synthetic.com.br';
    const legacy = h.deps.db.insert(instances).values({ baseUrl: legacyOrigin, displayName: 'Legado sintético',
      createdAt: h.deps.now(), updatedAt: h.deps.now() }).returning().get();
    const lookup = vi.fn(async () => []);
    setDnsLookupForTests(lookup);
    await expect(createInstance(h.deps, { base_url: 'https://helpdesk.empresa.com.br' })).rejects.toThrow(AuthError);
    await expect(createInstance(h.deps, {
      base_url: legacyOrigin,
      allow_custom_domain: true,
    })).rejects.toMatchObject({ code: 'invalid_url', httpStatus: 400,
      message: expect.stringContaining('domínio original *.freshservice.com') });
    expect(lookup).not.toHaveBeenCalled();
    expect(listInstances(h.deps).instances).toHaveLength(2);
    expect(requireActiveInstance(h.deps).id).toBe(first.instance.id);
    expect(listInstances(h.deps).instances.some((row) => row.origin === legacyOrigin)).toBe(true);
    const fetchImpl = vi.fn();
    const input = { db: h.deps.db, auth: h.deps, instanceId: legacy.id, deps: { fetch: fetchImpl } };
    await expect(runSync({ ...input, kind: 'full' })).rejects.toMatchObject({ code: 'invalid_origin' });
    await expect(runDiagnostics(input)).rejects.toMatchObject({ code: 'invalid_url' });
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(listInstances(h.deps).instances.some((row) => row.origin === legacyOrigin)).toBe(true);
  });

  it('campos desconhecidos e nomes com controle são recusados sem eco do valor', async () => {
    try {
      await createInstance(h.deps, { base_url: INSTANCE_ORIGIN, display_name: 'ok\u0007' });
      throw new Error('deveria recusar');
    } catch (error) {
      expect((error as AuthError).code).toBe('invalid_input');
      expect((error as AuthError).message).not.toContain('\u0007');
    }
  });

  it('a listagem não expõe nenhum campo sensível', async () => {
    await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
    const serialized = JSON.stringify(listInstances(h.deps));
    expect(serialized).not.toMatch(/secret|token|api_key|apiKey|password/i);
  });

  it('cada cadastro gera evento de auditoria sem a URL com credenciais', async () => {
    await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
    expect(h.auditText()).toContain('instance.created');
  });
});
