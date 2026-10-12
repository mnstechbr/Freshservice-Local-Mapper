import { getDbHandle } from './client';
import { countAppliedMigrations } from './migrate';

/** Resposta pública de saúde: sem caminhos, sem mensagens de erro internas. */
export type DbHealth = { db: 'ok'; migrations: number } | { db: 'error' };

export function getDbHealth(): DbHealth {
  try {
    const { sqlite } = getDbHandle();
    const ping = sqlite.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    if (ping?.ok !== 1) return { db: 'error' };
    return { db: 'ok', migrations: countAppliedMigrations(sqlite) };
  } catch (err) {
    // Detalhes ficam só no terminal do servidor, nunca na resposta HTTP.
    console.error('[fslm] Banco indisponível:', err instanceof Error ? err.message : err);
    return { db: 'error' };
  }
}
