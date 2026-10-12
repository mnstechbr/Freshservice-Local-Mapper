import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { CALLBACK_URL, INSTANCE_ORIGIN, ORG_ORIGIN, SYNTHETIC, cookiePair, createHarness, json, type Harness } from './helpers';
import { auditEvents } from '../../src/lib/db/schema';
import { createInstance } from '../../src/lib/auth/instances';
import {
  handleOAuthCallback,
  oauthPreflight,
  resolveOAuthAccessToken,
  startOAuth,
} from '../../src/lib/auth/oauth';
import {
  DEFAULT_PROFILE_SCOPES,
  LEGACY_CONFIG_REJECTED_EVENT,
  createProfile,
  deleteProfile,
  findProfileForInstance,
  listProfileRows,
  migrateLegacyOAuthConfig,
  updateProfile,
} from '../../src/lib/auth/profiles';
import { getStatus } from '../../src/lib/auth/connection';
import { OAUTH_CONFIG_KEY, findConnection, readSetting, writeSetting } from '../../src/lib/auth/repo';
import { oauthStartRedirectTarget } from '../../src/lib/security/origin';
import { SecretStoreUnavailableError } from '../../src/lib/secrets/types';

const HOST = new URL(INSTANCE_ORIGIN).hostname;
const PROFILE = {
  name: 'Perfil sintético',
  org_url: `${ORG_ORIGIN}/org`,
  client_id: SYNTHETIC.clientId,
  client_secret: SYNTHETIC.clientSecret,
  freshservice_domains: [HOST],
  redirect_host: '127.0.0.1' as const,
};
/** Caminho documentado do token (token_path_prefix padrão ''). PROFILE não informa o campo. */
const TOKEN_PATH = '/oauth/v2/token';
const VERIFY_PATH = '/api/v2/departments';

/** Provedor sintético: token (com escopo informado), renovação e leitura de verificação. */
function provider(options: { scope?: string; refreshStatus?: number; verifyStatus?: number } = {}) {
  return (url: URL, init: RequestInit) => {
    const body = typeof init.body === 'string' ? init.body : '';
    if (url.origin === ORG_ORIGIN && url.pathname === TOKEN_PATH) {
      if (body.includes('grant_type=refresh_token')) {
        return json({ access_token: SYNTHETIC.renewedAccessToken, token_type: 'Bearer', expires_in: 1800 }, options.refreshStatus ?? 200);
      }
      return json({
        access_token: SYNTHETIC.accessToken,
        refresh_token: SYNTHETIC.refreshToken,
        token_type: 'Bearer',
        scope: options.scope ?? 'freshservice.departments.view',
        expires_in: 1800,
      });
    }
    if (url.origin === INSTANCE_ORIGIN && url.pathname === VERIFY_PATH) {
      const status = options.verifyStatus ?? 200;
      return json(status === 200 ? [] : {}, status);
    }
    return json({ unexpected: url.pathname }, 500);
  };
}

/** Conecta por OAuth (perfil + início + retorno) e devolve o estado final da callback. */
async function connect(h: Harness, scope?: string, profile: Partial<typeof PROFILE & { scopes: string[] }> = {}) {
  await createProfile(h.deps, { ...PROFILE, ...profile });
  h.setHandler(provider({ scope }));
  const started = await startOAuth(h.deps);
  const state = new URL(started.result.authorization_url ?? '').searchParams.get('state') ?? '';
  const callback = new URL(`${CALLBACK_URL}?${new URLSearchParams({ code: SYNTHETIC.code, state })}`);
  return handleOAuthCallback(h.deps, callback, cookiePair(started.setCookie));
}

let h: Harness;

beforeEach(async () => {
  h = createHarness(provider());
  await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
});

afterEach(() => {
  h.cleanup();
});

describe('perfis de integração: CRUD e segredo', () => {
  it('client_secret vai só para o cofre: resposta, banco e auditoria não o contêm', async () => {
    const result = await createProfile(h.deps, PROFILE);
    expect(result.profile.has_secret).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC.clientSecret);
    const row = listProfileRows(h.db)[0];
    expect(JSON.stringify(row)).not.toContain(SYNTHETIC.clientSecret);
    expect(await h.vault.read(row.clientSecretRef)).toBe(SYNTHETIC.clientSecret);
    expect(h.auditText()).not.toContain(SYNTHETIC.clientSecret);
  });

  it('escopos padrão são só .view; nenhum .manage por padrão e sem avisos', async () => {
    const result = await createProfile(h.deps, PROFILE);
    expect(result.profile.scopes).toEqual([...DEFAULT_PROFILE_SCOPES]);
    expect(DEFAULT_PROFILE_SCOPES.every((scope) => scope.endsWith('.view'))).toBe(true);
    expect(result.profile.scopes).not.toContain('freshservice.tickets.conversations.view');
    expect(result.profile.scopes.filter((scope) => /\.(manage|edit)$/.test(scope))).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('escopo fora da lista oficial é recusado; .manage exige allow_manage_scopes e gera aviso', async () => {
    await expect(createProfile(h.deps, { ...PROFILE, scopes: ['freshservice.inventada.view'] })).rejects.toMatchObject({
      code: 'invalid_scope',
      httpStatus: 400,
    });
    await expect(createProfile(h.deps, { ...PROFILE, scopes: ['freshservice.agents.manage'] })).rejects.toMatchObject({
      code: 'manage_scopes_not_allowed',
    });
    const result = await createProfile(h.deps, {
      ...PROFILE,
      scopes: ['freshservice.agents.manage', 'freshservice.departments.view'],
      allow_manage_scopes: true,
    });
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'manage_scopes_granted', scopes: ['freshservice.agents.manage'] }),
    ]);
  });

  it('.edit exige consentimento explícito na criação e atualização do perfil', async () => {
    const scopes = ['freshservice.service_catalog.edit', 'freshservice.departments.view'];
    await expect(createProfile(h.deps, { ...PROFILE, scopes })).rejects.toMatchObject({ code: 'manage_scopes_not_allowed' });
    const created = await createProfile(h.deps, PROFILE);
    await expect(updateProfile(h.deps, created.profile.id, { scopes })).rejects.toMatchObject({ code: 'manage_scopes_not_allowed' });
    const updated = await updateProfile(h.deps, created.profile.id, { scopes, allow_manage_scopes: true });
    expect(updated.warnings).toEqual([expect.objectContaining({ scopes: ['freshservice.service_catalog.edit'] })]);
  });

  it('domínio fora de *.freshservice.com e domínio já usado em outro perfil são recusados', async () => {
    await expect(createProfile(h.deps, { ...PROFILE, freshservice_domains: ['acme.example.com'] })).rejects.toMatchObject({
      code: 'invalid_domain',
    });
    await createProfile(h.deps, PROFILE);
    await expect(createProfile(h.deps, { ...PROFILE, name: 'Outro' })).rejects.toMatchObject({ code: 'domain_conflict' });
  });

  it('atualizar sem client_secret mantém o segredo; com novo segredo, grava outro no cofre', async () => {
    const created = await createProfile(h.deps, PROFILE);
    const before = listProfileRows(h.db)[0].clientSecretRef;
    await updateProfile(h.deps, created.profile.id, { name: 'Novo nome' });
    expect(listProfileRows(h.db)[0].clientSecretRef).toBe(before);
    await updateProfile(h.deps, created.profile.id, { client_secret: 'segredo-sintetico-novo-123' });
    const after = listProfileRows(h.db)[0].clientSecretRef;
    expect(after).not.toBe(before);
    expect(await h.vault.read(after)).toBe('segredo-sintetico-novo-123');
  });

  it('perfil em uso por conexão não pode ser removido; perfil livre pode', async () => {
    await connect(h);
    const [used] = listProfileRows(h.db);
    await expect(deleteProfile(h.deps, used.id)).rejects.toMatchObject({ code: 'profile_in_use', httpStatus: 409 });
    const free = await createProfile(h.deps, { ...PROFILE, freshservice_domains: ['outro-cliente.freshservice.com'] });
    await deleteProfile(h.deps, free.profile.id);
    expect(listProfileRows(h.db).map((row) => row.id)).toEqual([used.id]);
  });
});

describe('resolução por domínio e admin_config_missing', () => {
  it('correspondência estrita por hostname: sem presumir a organização pelo domínio', async () => {
    const created = await createProfile(h.deps, PROFILE);
    expect(findProfileForInstance(h.db, INSTANCE_ORIGIN)?.id).toBe(created.profile.id);
    expect(findProfileForInstance(h.db, `https://${HOST}.evil.example`)).toBeUndefined();
    expect(findProfileForInstance(h.db, 'https://evil-acme-fslm.freshservice.com')).toBeUndefined();
  });

  it('sem perfil: status admin_config_missing com orientação ao administrador, e preflight não pronto', () => {
    const status = getStatus(h.deps);
    expect(status.status).toBe('admin_config_missing');
    expect(status.message).toContain('Configurações → Administração da integração');
    expect(oauthPreflight(h.deps)).toMatchObject({ ready: false, status: 'admin_config_missing', start_url: null });
  });

  it('com perfil: preflight pronto com redirect_uri e start_url no host do perfil', async () => {
    await createProfile(h.deps, PROFILE);
    expect(oauthPreflight(h.deps)).toMatchObject({
      ready: true,
      profile_name: 'Perfil sintético',
      redirect_host: '127.0.0.1',
      redirect_uri: `http://127.0.0.1:${h.deps.port}/api/auth/oauth/callback`,
      start_url: `http://127.0.0.1:${h.deps.port}/api/auth/oauth/start`,
    });
  });
});

describe('início: redirecionamento de Host (303 antes do cookie)', () => {
  it('Host diferente do redirect_host gera destino no host do perfil, com a mesma rota e query', () => {
    expect(oauthStartRedirectTarget('localhost:3102', '127.0.0.1', 3102, '/api/auth/oauth/start?x=1')).toBe(
      'http://127.0.0.1:3102/api/auth/oauth/start?x=1',
    );
  });

  it('Host igual ao redirect_host não redireciona', () => {
    expect(oauthStartRedirectTarget('127.0.0.1:3102', '127.0.0.1', 3102, '/api/auth/oauth/start')).toBeNull();
    expect(oauthStartRedirectTarget('LOCALHOST:3102', 'localhost', 3102, '/api/auth/oauth/start')).toBeNull();
  });
});

describe('retorno: escopo insuficiente e renovação', () => {
  it('escopo concedido não cobre nenhuma leitura de verificação: insufficient_scope, sem GET de verificação', async () => {
    const location = await connect(h, 'freshservice.solutions.view', { scopes: ['freshservice.solutions.view'] });
    expect(location).toBe('/auth/concluido?conn=insufficient_scope');
    expect(getStatus(h.deps)).toMatchObject({ status: 'insufficient_scope' });
    expect(findConnection(h.db, 1)?.status).toBe('no_permission');
    expect(h.calls.some((call) => new URL(call.url).pathname === VERIFY_PATH)).toBe(false);
  });

  it('renovação com falha transitória (5xx): tokens mantidos e connection_error', async () => {
    await connect(h);
    const row = findConnection(h.db, 1)!;
    h.clock.now += 30 * 60 * 1000 - 10_000;
    h.setHandler(provider({ refreshStatus: 503 }));
    await expect(resolveOAuthAccessToken(h.deps, row)).rejects.toMatchObject({ code: 'connection_error' });
    const after = findConnection(h.db, 1);
    expect(after?.status).toBe('connection_error');
    expect(after?.secretRef).toBe(row.secretRef);
    expect(await h.vault.read(after!.secretRef!)).not.toBeNull();
  });

  it('cofre indisponível na renovação: tokens mantidos (não é recusa do provedor)', async () => {
    await connect(h);
    const row = findConnection(h.db, 1)!;
    h.clock.now += 30 * 60 * 1000 - 10_000;
    h.deps.vault.read = async () => {
      throw new SecretStoreUnavailableError('cofre indisponível (teste)');
    };
    await expect(resolveOAuthAccessToken(h.deps, row)).rejects.toMatchObject({ code: 'connection_error' });
    expect(findConnection(h.db, 1)).toMatchObject({ status: 'connection_error', secretRef: row.secretRef });
  });
});

describe('migração da configuração global legada', () => {
  it('oauth_config vira um perfil (redirect 127.0.0.1, domínio da instância ativa), é idempotente e remove a chave', async () => {
    const ref = await h.deps.vault.store(SYNTHETIC.clientSecret);
    writeSetting(h.db, OAUTH_CONFIG_KEY, {
      orgOrigin: ORG_ORIGIN,
      clientId: SYNTHETIC.clientId,
      scopes: ['freshservice.departments.view'],
      clientSecretRef: ref,
      pathPrefix: '/org',
    });
    const [migrated] = listProfileRows(h.db);
    expect(migrated).toMatchObject({
      orgOrigin: ORG_ORIGIN,
      redirectHost: '127.0.0.1',
      freshserviceDomains: [HOST],
      allowManageScopes: false,
      clientSecretRef: ref,
      pathPrefix: '/org',
    });
    expect(readSetting(h.db, OAUTH_CONFIG_KEY)).toBeNull();
    expect(migrateLegacyOAuthConfig(h.db, Date.now())).toBeNull();
    expect(listProfileRows(h.db)).toHaveLength(1);
  });

  it("M1: a migração preserva o comportamento anterior, em que o token usa o mesmo prefixo do authorize", async () => {
    const ref = await h.deps.vault.store(SYNTHETIC.clientSecret);
    const base = { orgOrigin: ORG_ORIGIN, clientId: SYNTHETIC.clientId, scopes: ['freshservice.departments.view'], clientSecretRef: ref };
    writeSetting(h.db, OAUTH_CONFIG_KEY, { ...base, pathPrefix: '/org' });
    expect(listProfileRows(h.db)[0]).toMatchObject({ pathPrefix: '/org', tokenPathPrefix: '/org' });
  });

  it("M1: configuração antiga sem prefixo migra com token '' (também o comportamento anterior)", async () => {
    const ref = await h.deps.vault.store(SYNTHETIC.clientSecret);
    writeSetting(h.db, OAUTH_CONFIG_KEY, {
      orgOrigin: ORG_ORIGIN,
      clientId: SYNTHETIC.clientId,
      scopes: ['freshservice.departments.view'],
      clientSecretRef: ref,
    });
    expect(listProfileRows(h.db)[0]).toMatchObject({ pathPrefix: '', tokenPathPrefix: '' });
  });

  it('L2: origem inválida na configuração antiga não migra, mantém a chave e grava aviso sem URL nem segredo', async () => {
    const ref = await h.deps.vault.store(SYNTHETIC.clientSecret);
    const invalidOrigins = [
      'https://evil.example.com',
      'http://fslm-org.myfreshworks.com',
      'https://10.0.0.1',
      'https://localhost',
    ];
    for (const orgOrigin of invalidOrigins) {
      const legacy = { orgOrigin, clientId: SYNTHETIC.clientId, scopes: ['freshservice.departments.view'], clientSecretRef: ref, pathPrefix: '/org' };
      writeSetting(h.db, OAUTH_CONFIG_KEY, legacy);
      expect(listProfileRows(h.db)).toHaveLength(0);
      expect(migrateLegacyOAuthConfig(h.db, Date.now())).toBeNull();
      expect(readSetting(h.db, OAUTH_CONFIG_KEY)).toEqual(legacy);
    }
    const warnings = h.db.select().from(auditEvents).where(eq(auditEvents.eventType, LEGACY_CONFIG_REJECTED_EVENT)).all();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ level: 'warn', context: { reason: 'invalid_org_url' } });
    const text = h.auditText();
    expect(text).not.toContain('evil.example.com');
    expect(text).not.toContain('10.0.0.1');
    expect(text).not.toContain(SYNTHETIC.clientSecret);
    expect(text).not.toContain(ref);
  });

  it('L2: origem válida continua migrando, já normalizada para a origem (sem caminho)', async () => {
    const ref = await h.deps.vault.store(SYNTHETIC.clientSecret);
    writeSetting(h.db, OAUTH_CONFIG_KEY, {
      orgOrigin: `${ORG_ORIGIN}/org`,
      clientId: SYNTHETIC.clientId,
      scopes: ['freshservice.departments.view'],
      clientSecretRef: ref,
      pathPrefix: '/org',
    });
    expect(listProfileRows(h.db)[0]).toMatchObject({ orgOrigin: ORG_ORIGIN });
    expect(readSetting(h.db, OAUTH_CONFIG_KEY)).toBeNull();
  });
});
