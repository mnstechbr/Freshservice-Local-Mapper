import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInstance } from '../../src/lib/auth/instances';
import { oauthPreflight } from '../../src/lib/auth/oauth';
import { createProfile } from '../../src/lib/auth/profiles';
import { activeInstanceId, listInstanceRows } from '../../src/lib/auth/repo';
import { errorResponse } from '../../src/lib/auth/route-utils';
import { INSTANCE_ORIGIN, ORG_ORIGIN, SYNTHETIC, type Harness, createHarness } from './helpers';

const HOST = new URL(INSTANCE_ORIGIN).hostname;
const PROFILE = {
  name: 'Perfil sintético',
  org_url: `${ORG_ORIGIN}/org`,
  client_id: SYNTHETIC.clientId,
  client_secret: SYNTHETIC.clientSecret,
  freshservice_domains: [HOST],
  redirect_host: '127.0.0.1' as const,
};

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

afterEach(() => {
  h.cleanup();
});

describe('preflight por link digitado (?url=): nada é gravado', () => {
  it('com perfil e sem instância salva: pronto, sem start_url, e nenhuma instância criada', async () => {
    await createProfile(h.deps, PROFILE);
    expect(oauthPreflight(h.deps, `${INSTANCE_ORIGIN}/agents?x=1`)).toMatchObject({
      ready: true,
      status: 'disconnected',
      profile_name: 'Perfil sintético',
      redirect_host: '127.0.0.1',
      redirect_uri: `http://127.0.0.1:${h.deps.port}/api/auth/oauth/callback`,
      start_url: null,
      app_url: `http://127.0.0.1:${h.deps.port}/`,
    });
    expect(listInstanceRows(h.db)).toHaveLength(0);
  });

  it('sem perfil para o domínio: admin_config_missing, sem start_url e sem instância criada', () => {
    expect(oauthPreflight(h.deps, INSTANCE_ORIGIN)).toMatchObject({
      ready: false,
      status: 'admin_config_missing',
      start_url: null,
    });
    expect(listInstanceRows(h.db)).toHaveLength(0);
  });

  it('instância salva e ativa: mesmo resultado do preflight da instância ativa, com start_url', async () => {
    await createProfile(h.deps, PROFILE);
    await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
    const porLink = oauthPreflight(h.deps, INSTANCE_ORIGIN);
    expect(porLink).toMatchObject({
      ready: true,
      start_url: `http://127.0.0.1:${h.deps.port}/api/auth/oauth/start`,
    });
    expect(porLink).toEqual(oauthPreflight(h.deps));
  });

  it('instância salva, mas não ativa: pronta e sem start_url, porque o start usa a instância ativa', async () => {
    await createProfile(h.deps, PROFILE);
    await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
    const primeira = listInstanceRows(h.db).find((row) => row.baseUrl === INSTANCE_ORIGIN)?.id;
    await createInstance(h.deps, { base_url: 'https://outra-instancia.freshservice.com' });
    expect(activeInstanceId(h.db)).not.toBe(primeira);
    expect(oauthPreflight(h.deps, INSTANCE_ORIGIN)).toMatchObject({ ready: true, start_url: null });
  });

  it('link fora do padrão (http, ou domínio que não é Freshservice): invalid_url com HTTP 400, sem ecoar o link', async () => {
    for (const url of ['http://acme-fslm.freshservice.com', 'https://exemplo.com']) {
      let erro: unknown;
      try {
        oauthPreflight(h.deps, url);
      } catch (error) {
        erro = error;
      }
      const resposta = errorResponse(erro);
      expect(resposta.status).toBe(400);
      const corpo = await resposta.text();
      expect(JSON.parse(corpo)).toMatchObject({ error: { code: 'invalid_url' } });
      expect(corpo).not.toContain(url);
    }
    expect(listInstanceRows(h.db)).toHaveLength(0);
  });
});
