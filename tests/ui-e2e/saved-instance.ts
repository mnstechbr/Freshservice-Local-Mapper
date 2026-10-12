import path from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';

/** Endereço fictício de instância salva. Os cenários que não chegam ao servidor externo nunca o contatam. */
export const SAVED_BASE_URL = 'https://acme-test.freshservice.com';
/** TLD reservado: a validação de URL recusa antes de qualquer conexão. Usado onde o teste envia chave. */
export const REFUSED_BASE_URL = 'https://acme-test.invalid';

const DATA_DIR_MARKER = `${path.sep}.e2e-data${path.sep}`;

/**
 * Grava direto no SQLite do diretório de dados da rodada (FSLM_E2E_DATA_DIR) uma instância ativa sem conexão.
 * Antes de abrir o banco, faz uma requisição que o próprio app usa para criá-lo e migrá-lo. Não há atalho no
 * código de produção: o app lê a instância do banco como em uso real.
 */
export async function seedSavedInstance(request: APIRequestContext, baseUrl: string = SAVED_BASE_URL): Promise<void> {
  const dataDir = process.env.FSLM_E2E_DATA_DIR ?? '';
  if (!dataDir.includes(DATA_DIR_MARKER)) {
    throw new Error('Diretório de dados do E2E ausente ou fora de .e2e-data. Nada foi gravado.');
  }

  const init = await request.get('/api/connection/status');
  if (!init.ok()) throw new Error(`Banco não inicializado (HTTP ${init.status()}).`);

  const db = new Database(path.join(dataDir, 'fslm.db'), { fileMustExist: true, timeout: 5000 });
  try {
    db.transaction(() => {
      const now = Date.now();
      db.prepare(
        'INSERT OR IGNORE INTO instances (base_url, display_name, is_demo, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
      ).run(baseUrl, 'Acme (teste)', now, now);
      const row = db.prepare('SELECT id FROM instances WHERE base_url = ?').get(baseUrl) as { id: number };
      // Sem linha de conexão: a instância está ativa, mas desconectada.
      db.prepare('DELETE FROM connections WHERE instance_id = ?').run(row.id);
      db.prepare(
        "INSERT INTO app_settings (key, value) VALUES ('active_instance_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(JSON.stringify(row.id));
    })();
  } finally {
    db.close();
  }
}
