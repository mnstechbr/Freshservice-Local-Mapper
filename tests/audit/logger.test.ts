import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_FILE_NAME } from '../../src/lib/config/paths';
import { prepareDatabase } from '../../src/lib/db/bootstrap';
import { createAuditLogger } from '../../src/lib/audit/logger';
import { redactString, redactValue } from '../../src/lib/audit/redact';
import { MIGRATIONS_FOLDER, makeTempDir, openTestDb, removeTempDir } from '../helpers/db';

describe('audit logger: redação de segredos', () => {
  let dir: string;
  let test: ReturnType<typeof openTestDb>;

  beforeEach(() => {
    dir = makeTempDir();
    prepareDatabase({ dataDir: dir, migrationsFolder: MIGRATIONS_FOLDER });
    test = openTestDb(join(dir, DB_FILE_NAME));
  });

  afterEach(() => {
    test.sqlite.close();
    removeTempDir(dir);
  });

  it('grava mensagem e contexto redigidos, sem nenhum segredo no banco', () => {
    const logger = createAuditLogger(test.db, { now: () => 1_700_000_000_000 });

    logger.log({
      level: 'info',
      eventType: 'connection.test',
      message: 'Teste com Authorization: Bearer tok-SEGREDO-ABC e api_key=CHAVE-XYZ-987',
      context: {
        Authorization: 'Basic c2VjcmV0-BASE64',
        headers: { cookie: 'sid=COOKIE-SEGREDO-1', 'X-Api-Key': 'CHAVE-HEADER-2' },
        token: 'tok-CAMPO-3',
        password: 'senha-CAMPO-4',
        secret: 'segredo-CAMPO-5',
        nested: { deep: { ok: 1, auth_token: 'TOKEN-PROFUNDO-6' } },
        module: 'tickets',
        count: 3,
      },
    });

    const row = test.sqlite
      .prepare('SELECT message, context, created_at FROM audit_events')
      .get() as { message: string; context: string; created_at: number };

    const stored = `${row.message}\n${row.context}`;
    for (const secret of [
      'tok-SEGREDO-ABC',
      'CHAVE-XYZ-987',
      'c2VjcmV0-BASE64',
      'COOKIE-SEGREDO-1',
      'CHAVE-HEADER-2',
      'tok-CAMPO-3',
      'senha-CAMPO-4',
      'segredo-CAMPO-5',
      'TOKEN-PROFUNDO-6',
    ]) {
      expect(stored).not.toContain(secret);
    }

    expect(JSON.parse(row.context)).toMatchObject({
      Authorization: '[REDACTED]',
      module: 'tickets',
      count: 3,
    });
    expect(row.created_at).toBe(1_700_000_000_000);
  });

  it('redactValue troca só os valores de chaves sensíveis e preserva o restante', () => {
    expect(redactValue({ apiKey: 'a', name: 'b', list: [{ password: 'c' }, 'ok'] })).toEqual({
      apiKey: '[REDACTED]',
      name: 'b',
      list: [{ password: '[REDACTED]' }, 'ok'],
    });
  });

  it('redactString mascara Bearer, Basic e parâmetros de URL', () => {
    expect(redactString('GET /x?api_key=abc&page=2')).toBe('GET /x?api_key=[REDACTED]&page=2');
    expect(redactString('Basic Zm9vOmJhcg==')).toBe('Basic [REDACTED]');
  });
});
