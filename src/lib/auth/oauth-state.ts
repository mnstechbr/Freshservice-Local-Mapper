import 'server-only';
import { createHash } from 'node:crypto';
import { lt } from 'drizzle-orm';
import type { AppDb } from '../db/client';
import { oauthConsumedStates } from '../db/schema';

/** Hash SHA-256 (hex) do state. O banco nunca guarda o state em texto puro. */
export function oauthStateHash(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}

/**
 * Marca o state como usado (L3 da auditoria). Retorna false se ele já foi consumido: retorno repetido ou
 * concorrente. A operação é síncrona (better-sqlite3, uma transação): entre checar e gravar não há await,
 * então duas chamadas concorrentes não passam juntas. A chave primária também barra a segunda gravação.
 * Linhas já expiradas são apagadas no mesmo passo, então a tabela continua pequena.
 */
export function consumeOAuthState(db: AppDb, state: string, expiresAt: number, now: number): boolean {
  const stateHash = oauthStateHash(state);
  return db.transaction((tx) => {
    tx.delete(oauthConsumedStates).where(lt(oauthConsumedStates.expiresAt, now)).run();
    const inserted = tx
      .insert(oauthConsumedStates)
      .values({ stateHash, consumedAt: now, expiresAt })
      .onConflictDoNothing()
      .returning({ stateHash: oauthConsumedStates.stateHash })
      .all();
    return inserted.length === 1;
  });
}
