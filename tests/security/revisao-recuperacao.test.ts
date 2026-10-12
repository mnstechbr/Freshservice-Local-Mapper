/**
 * Revisão de segurança pós-recuperação (QA, 2026-10-11). Arquivo só de testes.
 *
 * Testes marcados "DEFEITO" falham de propósito enquanto o código de produção não for corrigido.
 * Cada um aponta o arquivo:linha no relatório de QA (docs/PROGRESSO.md). Os demais são guardas
 * que já passam e devem continuar passando.
 */
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { POST as demoPost } from '../../src/app/api/demo/route';
import { getAdapter } from '../../src/lib/freshservice/modules';
import { requestTarget } from '../../src/lib/sync/fetch-pages';
import { sanitizeRaw } from '../../src/lib/sync/persist';
import { checkLocalRequest } from '../../src/lib/security/origin';
import { defaultCommandRunner, type CommandOptions, type CommandResult } from '../../src/lib/secrets/command';
import { createSecretToolStore } from '../../src/lib/secrets/linux-secret-service';
import { SecretStoreError } from '../../src/lib/secrets/types';

const PORT = 3000;
const SEGREDO = 'SEGREDO-XYZ-123';

describe('L1: mensagem 403 do guarda local orienta só 127.0.0.1', () => {
  const result = checkLocalRequest({ method: 'GET', host: `evil.example:${PORT}`, origin: null, fetchSite: null, port: PORT });

  it('host recusado: mensagem cita "Acesse o app por http://127.0.0.1:PORT"', () => {
    // DEFEITO L1: src/lib/security/origin.ts:40 ainda cita "127.0.0.1 ou localhost".
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(`Acesse o app por http://127.0.0.1:${PORT}`);
  });

  it('host recusado: mensagem não menciona localhost', () => {
    // DEFEITO L1: mesma linha de origin.ts:40.
    if (!result.ok) expect(result.message).not.toMatch(/localhost/i);
  });
});

describe('a) normalização e raw_json: contato pessoal e segredos', () => {
  const tickets = getAdapter('tickets.tickets');
  const record = {
    id: 1,
    subject: 'assunto',
    email: 'pessoa@example.com',
    phone: '+55 11 0000-0000',
    mobile: '+55 11 90000-0000',
    attachments: [{ id: 9, attachment_url: 'https://files.example/a.pdf?token=ABC' }],
  };

  it('guarda: normalized já exclui e-mail, telefone, celular e anexos (regra global)', () => {
    const normalized = tickets?.toResource(record)?.normalized ?? {};
    expect(Object.keys(normalized)).not.toEqual(expect.arrayContaining(['email', 'phone', 'mobile', 'attachments']));
    expect(normalized.subject).toBe('assunto');
  });

  it('DEFEITO: raw_json (sanitizeRaw, sem metadataOnly) não grava contato nem anexos com URL temporária', () => {
    // Defeito: src/lib/sync/persist.ts:245-249 filtra só adapter.sensitiveFields, não GLOBAL_EXCLUDED_KEYS
    // (src/lib/freshservice/modules/types.ts:28). Com storeRaw ativo, email/phone/mobile/attachments entram no raw.
    const raw = sanitizeRaw(record, tickets!, false) ?? {};
    expect(raw).not.toHaveProperty('email');
    expect(raw).not.toHaveProperty('phone');
    expect(raw).not.toHaveProperty('mobile');
    expect(raw).not.toHaveProperty('attachments');
  });

  const comSegredos = { id: 2, subject: 'x', api_key: 'K-1', access_token: 'T-1', client_secret: 'S-1', password: 'P-1', secret: 'X-1' };

  it('DEFEITO: normalized não contém chaves com nome de segredo (api_key|token|secret|password)', () => {
    // Defeito de defesa em profundidade: src/lib/freshservice/modules/types.ts:28-50 não tem filtro por nome.
    const normalized = tickets?.toResource(comSegredos)?.normalized ?? {};
    for (const key of ['api_key', 'access_token', 'client_secret', 'password', 'secret']) {
      expect(normalized, `chave ${key} não deveria entrar em normalized`).not.toHaveProperty(key);
    }
  });

  it('DEFEITO: raw_json não contém chaves com nome de segredo', () => {
    // Defeito: src/lib/sync/persist.ts:245 (sanitizeRaw) sem filtro por nome de chave.
    const raw = sanitizeRaw(comSegredos, tickets!, false) ?? {};
    for (const key of ['api_key', 'access_token', 'client_secret', 'password', 'secret']) {
      expect(raw, `chave ${key} não deveria entrar em raw_json`).not.toHaveProperty(key);
    }
  });
});

describe('b) cofre Linux: processo sem shell, segredo só pela entrada padrão', () => {
  it('runner sem shell: metacaracteres em argumentos chegam como texto literal', async () => {
    const res = await defaultCommandRunner(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', '$(echo PWNED)']);
    expect(res.stdout).toBe('$(echo PWNED)');
  });

  it('runner: tempo esgotado encerra o processo e rejeita com erro de tempo limite', async () => {
    await expect(
      defaultCommandRunner(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 200 }),
    ).rejects.toThrow(/tempo limite/);
  });

  it('set: o segredo vai pela entrada padrão e nunca nos argumentos', async () => {
    const calls: { args: readonly string[]; input?: string }[] = [];
    const run = async (_command: string, args: readonly string[], options?: CommandOptions): Promise<CommandResult> => {
      calls.push({ args: [...args], input: options?.input });
      return { code: 0, stdout: '', stderr: '' };
    };
    await createSecretToolStore(run).set('ref-1', SEGREDO);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args.join(' ')).not.toContain(SEGREDO);
    expect(calls[0]!.input).toContain(SEGREDO);
  });

  it('erro de gravação não ecoa stderr nem o valor gravado', async () => {
    const run = async (): Promise<CommandResult> => ({ code: 2, stdout: '', stderr: `falha com ${SEGREDO}` });
    const error = await createSecretToolStore(run).set('ref-1', SEGREDO).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SecretStoreError);
    expect(String((error as Error).message)).not.toContain(SEGREDO);
  });

  it('leitura com conteúdo inválido não ecoa o conteúdo do cofre', async () => {
    const run = async (): Promise<CommandResult> => ({ code: 0, stdout: `${SEGREDO} não é JSON`, stderr: '' });
    const error = await createSecretToolStore(run).get('ref-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SecretStoreError);
    expect(String((error as Error).message)).not.toContain(SEGREDO);
  });
});

describe('d) item_details: display_id no caminho é codificado e fica no mesmo recurso', () => {
  const adapter = getAdapter('service_catalog.item_details');

  it('referência numérica vira caminho simples, sem parâmetro de query sobrando', () => {
    expect(requestTarget(adapter!, { display_id: '42' })).toEqual({ path: '/api/v2/service_catalog/items/42', query: {} });
  });

  it('barra, interrogação e igual no valor não criam segmento nem parâmetro', () => {
    expect(requestTarget(adapter!, { display_id: '../../agents?x=1' }).path).toBe(
      '/api/v2/service_catalog/items/..%2F..%2Fagents%3Fx%3D1',
    );
  });
});

describe('e) /api/demo exige Origin da própria aplicação', () => {
  const body = JSON.stringify({ action: 'remover' });
  const headers = { 'content-type': 'application/json' };

  it('POST sem Origin devolve 403 antes de tocar no banco', async () => {
    const res = await demoPost(new NextRequest(`http://127.0.0.1:${PORT}/api/demo`, { method: 'POST', body, headers }));
    expect(res.status).toBe(403);
  });

  it('POST com Origin de outro site devolve 403', async () => {
    const res = await demoPost(
      new NextRequest(`http://127.0.0.1:${PORT}/api/demo`, {
        method: 'POST',
        body,
        headers: { ...headers, origin: 'https://evil.example' },
      }),
    );
    expect(res.status).toBe(403);
  });
});
