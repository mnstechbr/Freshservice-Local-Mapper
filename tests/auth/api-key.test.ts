import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { basicAuthorization, saveApiKey } from '../../src/lib/auth/api-key';
import { AuthError } from '../../src/lib/auth/errors';
import { createInstance } from '../../src/lib/auth/instances';
import { disconnect, getStatus, reconnect, testConnection } from '../../src/lib/auth/connection';
import { findConnection, saveConnection } from '../../src/lib/auth/repo';
import { ALL_SECRET_VALUES, type Handler, type Harness, INSTANCE_ORIGIN, SYNTHETIC, createHarness, json } from './helpers';

const VALIDATION_PATH = '/api/v2/ticket_form_fields';

/** Freshservice mockado: a leitura de validação responde com o status pedido. */
function validationReturns(status: number, body: unknown = {}): Handler {
  return (url) => {
    if (url.pathname !== VALIDATION_PATH) return json({ unexpected: true }, 500);
    return status === 200 ? json([]) : json(body, status);
  };
}

describe('API key: validação antes de gravar', () => {
  let h: Harness;

  beforeEach(async () => {
    h = createHarness(validationReturns(200));
    await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
  });

  afterEach(() => {
    h.cleanup();
  });

  it('sem instância ativa responde 409 e não chama a API', async () => {
    const bare = createHarness(validationReturns(200));
    try {
      await expect(
        saveApiKey(bare.deps, { mode: 'api_key_personal', api_key: SYNTHETIC.apiKey }),
      ).rejects.toMatchObject({ httpStatus: 409, code: 'no_active_instance' });
      expect(bare.calls).toHaveLength(0);
    } finally {
      bare.cleanup();
    }
  });

  it('chave válida: conectado, grava no cofre e usa Basic apiKey:X', async () => {
    const result = await saveApiKey(h.deps, { mode: 'api_key_personal', api_key: SYNTHETIC.apiKey });
    expect(result).toMatchObject({ status: 'connected', auth_mode: 'api_key_personal' });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.url.toString()).toBe(`${INSTANCE_ORIGIN}${VALIDATION_PATH}`);
    expect(h.calls[0]?.headers.Authorization).toBe(basicAuthorization(SYNTHETIC.apiKey));
    expect(h.calls[0]?.headers.Authorization).toBe(
      `Basic ${Buffer.from(`${SYNTHETIC.apiKey}:X`).toString('base64')}`,
    );

    const row = findConnection(h.db, 1);
    expect(row?.status).toBe('connected');
    expect(row?.secretRef).toMatch(/^encrypted-file:/);
    expect(h.vault.entries.size).toBe(1);
    expect(JSON.stringify(row)).not.toContain(SYNTHETIC.apiKey);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC.apiKey);
  });

  it('401: awaiting_authentication, nada gravado e a mensagem não repete a chave', async () => {
    h.setHandler(validationReturns(401, { errors: [{ message: `eco ${SYNTHETIC.apiKey}` }] }));
    const result = await saveApiKey(h.deps, { mode: 'api_key_personal', api_key: SYNTHETIC.apiKey });
    expect(result.status).toBe('awaiting_authentication');
    expect(result.message).toContain('401');
    expect(h.vault.entries.size).toBe(0);
    expect(findConnection(h.db, 1)).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC.apiKey);
  });

  it('401 mantém a conexão anterior intacta', async () => {
    await saveApiKey(h.deps, { mode: 'api_key_personal', api_key: SYNTHETIC.apiKey });
    const before = findConnection(h.db, 1);
    h.setHandler(validationReturns(401));
    await saveApiKey(h.deps, { mode: 'api_key_personal', api_key: SYNTHETIC.otherApiKey });
    expect(findConnection(h.db, 1)).toEqual(before);
    expect(h.vault.entries.size).toBe(1);
  });

  it('403: no_permission e a chave é gravada (a identidade existe)', async () => {
    h.setHandler(validationReturns(403));
    const result = await saveApiKey(h.deps, { mode: 'api_key_integration', api_key: SYNTHETIC.apiKey });
    expect(result).toMatchObject({ status: 'no_permission', auth_mode: 'api_key_integration' });
    expect(findConnection(h.db, 1)?.status).toBe('no_permission');
    expect(h.vault.entries.size).toBe(1);
  });

  it('429 e erro de rede: connection_error, sem gravar', async () => {
    h.setHandler(() => new Response('{}', { status: 429, headers: { 'retry-after': '20' } }));
    const limited = await saveApiKey(h.deps, { mode: 'api_key_personal', api_key: SYNTHETIC.apiKey });
    expect(limited.status).toBe('connection_error');
    expect(limited.message).toContain('429');
    expect(h.vault.entries.size).toBe(0);

    h.setHandler(() => {
      throw new TypeError('connect ECONNREFUSED');
    });
    const offline = await saveApiKey(h.deps, { mode: 'api_key_personal', api_key: SYNTHETIC.apiKey });
    expect(offline.status).toBe('connection_error');
    expect(offline.message).not.toContain('ECONNREFUSED');
  });

  it('entrada inválida (modo desconhecido, chave curta) gera 400 sem eco do valor', async () => {
    const error = await saveApiKey(h.deps, { mode: 'oauth', api_key: 'abc' }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).httpStatus).toBe(400);
    expect((error as AuthError).message).not.toContain('abc');
    expect(h.calls).toHaveLength(0);
  });

  it('trocar de OAuth para API key remove o segredo anterior (nunca mistura identidades)', async () => {
    h.vault.entries.set('encrypted-file:00000000-0000-4000-8000-0000000000aa', 'TOKENS-ANTIGOS');
    saveConnection(h.db, 1, h.clock.now, {
      authMode: 'oauth',
      status: 'connected',
      secretRef: 'encrypted-file:00000000-0000-4000-8000-0000000000aa',
    });
    await saveApiKey(h.deps, { mode: 'api_key_integration', api_key: SYNTHETIC.apiKey });
    expect(h.vault.entries.has('encrypted-file:00000000-0000-4000-8000-0000000000aa')).toBe(false);
    const row = findConnection(h.db, 1);
    expect(row?.authMode).toBe('api_key_integration');
    expect(row?.accountLabel).toContain('Usuário de integração');
    expect(h.vault.entries.size).toBe(1);
  });
});

describe('API key: estado, teste, reconexão e desconexão', () => {
  let h: Harness;

  beforeEach(async () => {
    h = createHarness(validationReturns(200));
    await createInstance(h.deps, { base_url: INSTANCE_ORIGIN });
    await saveApiKey(h.deps, { mode: 'api_key_personal', api_key: SYNTHETIC.apiKey });
  });

  afterEach(() => {
    h.cleanup();
  });

  it('testConnection: 401 depois de salvo muda o estado e mantém o segredo para correção', async () => {
    h.setHandler(validationReturns(401));
    const result = await testConnection(h.deps);
    expect(result.status).toBe('awaiting_authentication');
    expect(findConnection(h.db, 1)?.status).toBe('awaiting_authentication');
    expect(h.vault.entries.size).toBe(1);
  });

  it('testConnection sem conexão responde 409', async () => {
    await disconnect(h.deps);
    await expect(testConnection(h.deps)).rejects.toMatchObject({ httpStatus: 409 });
  });

  it('reconnect com API key revalida com uma leitura', async () => {
    const before = h.calls.length;
    const { result, setCookie } = await reconnect(h.deps);
    expect(result.status).toBe('connected');
    expect(setCookie).toBeUndefined();
    expect(h.calls.length).toBe(before + 1);
  });

  it('disconnect apaga o segredo, marca desconectado e preserva o histórico da instância', async () => {
    const result = await disconnect(h.deps);
    expect(result.status).toBe('disconnected');
    expect(h.vault.entries.size).toBe(0);
    const row = findConnection(h.db, 1);
    expect(row?.status).toBe('disconnected');
    expect(row?.secretRef).toBeNull();
    expect(getStatus(h.deps).status).toBe('disconnected');
  });

  it('getStatus não expõe chave, referência de segredo nem valores sensíveis', () => {
    const serialized = JSON.stringify(getStatus(h.deps));
    expect(serialized).not.toContain(SYNTHETIC.apiKey);
    expect(serialized).not.toContain('secret_ref');
    expect(serialized).not.toContain('encrypted-file:');
    expect(getStatus(h.deps)).toMatchObject({ status: 'connected', auth_mode: 'api_key_personal' });
  });

  it('nenhum valor sintético aparece em audit_events, nem cabeçalho Authorization', async () => {
    h.setHandler(validationReturns(401));
    await testConnection(h.deps);
    await disconnect(h.deps);
    const audit = h.auditText();
    for (const secret of ALL_SECRET_VALUES) expect(audit).not.toContain(secret);
    expect(audit).not.toContain('Basic ');
    expect(audit).toContain('connection.api_key.saved');
  });
});
