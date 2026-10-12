import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activateDemo } from '@/lib/demo/seed';
import { detectedChanges } from '@/lib/db/schema';
import { reviewChange } from '@/lib/diff';
import { createAppTestDb, type AppTestDb } from '../helpers/app-db';

/*
 * Dados fictícios da demonstração (activateDemo). A linha de possível troca de ID é gravada
 * direto pelo seed, sem passar pela detecção: a revisão tem de funcionar mesmo assim, no mesmo id.
 */
let env: AppTestDb;

beforeEach(() => {
  env = createAppTestDb();
  activateDemo(env.db);
});

afterEach(() => {
  env.close();
});

const pendingChange = () =>
  env.db
    .select()
    .from(detectedChanges)
    .where(and(eq(detectedChanges.changeType, 'possible_id_change'), eq(detectedChanges.reviewStatus, 'pending')))
    .get();

describe('demo: revisão da possível troca de ID', () => {
  it('rejeitar a mudança pendente muda o status para rejected e mantém o id', () => {
    const row = pendingChange();
    if (!row) throw new Error('demo sem possible_id_change pendente');
    const outcome = reviewChange(env.db, row.id, { decision: 'reject' });
    expect(outcome).toMatchObject({ changeId: row.id, status: 'rejected' });
    expect(env.db.select().from(detectedChanges).where(eq(detectedChanges.id, row.id)).get()).toMatchObject({
      reviewStatus: 'rejected',
    });
  });

  it('confirmar a mudança pendente muda o status para confirmed e mantém o id', () => {
    const row = pendingChange();
    if (!row) throw new Error('demo sem possible_id_change pendente');
    expect(reviewChange(env.db, row.id, { decision: 'confirm' })).toMatchObject({ changeId: row.id, status: 'confirmed' });
    expect(env.db.select().from(detectedChanges).where(eq(detectedChanges.id, row.id)).get()).toMatchObject({
      reviewStatus: 'confirmed',
    });
  });
});
