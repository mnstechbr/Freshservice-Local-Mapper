import { afterEach, describe, expect, it } from 'vitest';
import { getAdapter } from '@/lib/freshservice/modules';
import { resources, resourceVersions, syncRuns } from '@/lib/db/schema';
import { persistPage, sanitizeRaw } from '@/lib/sync/persist';
import { applyPrivacy, resolveMetadataOnly } from '@/lib/sync/prefs';
import type { AppTestDb } from '../helpers/app-db';
import { createSyncEnv } from '../helpers/sync-env';
import { findConnection } from '@/lib/auth/repo';

const contexts: AppTestDb[] = [];
afterEach(() => { while (contexts.length) contexts.pop()!.close(); });
const raw = {
  id: 7, name: 'Nome estrutural', parent_location_id: 2, workspace_id: 1,
  description: 'Descrição estrutural', created_at: '2026-01-01',
  address: { line1: 'Rua confidencial', city: 'Cidade confidencial' },
  contact_name: 'Pessoa confidencial', contact_person: 'Pessoa confidencial',
  contact: { name: 'Pessoa confidencial' }, zipcode: '00000',
  custom_fields: { nested: { address: 'Rua confidencial', contact_name: 'Pessoa confidencial' }, inventory_code: 'REF-1' },
};

describe('A-01: contato de locais e fornecedores', () => {
  it.each(['settings.locations', 'settings.vendors'])('%s: normalizado e raw gravados removem contato em ambos modos', async (key) => {
    const adapter = getAdapter(key)!;
    const env = await createSyncEnv();
    const ctx = env.app; contexts.push(ctx);
    const instanceId = env.instanceId;
    const connectionId = findConnection(ctx.db, instanceId)!.id;
    for (const metadataOnly of [false, true]) {
      const runId = ctx.db.insert(syncRuns).values({ instanceId, connectionId, identityLabel: 'Sintético', kind: 'full', status: 'completed', startedAt: 1, modulesRequested: [key] }).returning({ id: syncRuns.id }).get().id;
      const record = adapter.toResource(raw)!;
      persistPage(ctx.db, { instanceId, runId, adapter, metadataOnly, storeRaw: true, now: runId }, [{ raw, record }]);
      const normalized = applyPrivacy(record.normalized, adapter, metadataOnly);
      const original = sanitizeRaw(raw, adapter, metadataOnly);
      for (const value of [normalized, original]) {
        const text = JSON.stringify(value);
        expect(text).not.toContain('confidencial');
        expect(text).not.toContain('00000');
        expect(value).toMatchObject({ id: 7, name: 'Nome estrutural', parent_location_id: 2, custom_fields: { inventory_code: 'REF-1' } });
      }
    }
    for (const version of ctx.db.select().from(resourceVersions).all()) {
      expect(JSON.stringify(version.normalizedJson)).not.toContain('confidencial');
      expect(JSON.stringify(version.rawJson)).not.toContain('confidencial');
    }
    expect(ctx.db.select().from(resources).all()).toHaveLength(1);
    expect(raw.address.line1).toBe('Rua confidencial');
  });
});

describe('A-05: minimizar conteúdo preservando inventário', () => {
  it.each(['itsm.problems', 'itsm.changes', 'itsm.releases'])('%s: padrão omite corpo; opção explícita mantém conteúdo', (key) => {
    const adapter = getAdapter(key)!;
    const item = { id: 1, subject: 'Assunto', status: 2, category: 'Software', department_id: 3, description: 'Corpo privado', description_text: 'Corpo privado', custom_fields: { inventory_code: 'REF-1' } };
    const record = adapter.toResource(item)!;
    expect(record.relations).toContainEqual({ type: 'department', toExternalId: '3' });
    const defaults = resolveMetadataOnly({}, key);
    expect(defaults).toBe(true);
    expect(applyPrivacy(record.normalized, adapter, defaults)).toEqual({ id: 1, subject: 'Assunto', status: 2, category: 'Software', department_id: 3, custom_fields: { inventory_code: 'REF-1' } });
    expect(sanitizeRaw(item, adapter, defaults)).not.toHaveProperty('description');
    expect(resolveMetadataOnly({ itsm: false }, key)).toBe(false);
    expect(applyPrivacy(record.normalized, adapter, false)).toHaveProperty('description', 'Corpo privado');
    expect(sanitizeRaw(item, adapter, false)).toHaveProperty('description', 'Corpo privado');
  });

  it.each(['users_groups.agents', 'users_groups.requesters'])('%s: somente metadados omite assinatura e informações pessoais livres', (key) => {
    const adapter = getAdapter(key)!;
    const record = adapter.toResource({ id: 2, first_name: 'Nome', signature: 'Texto privado', background_information: 'Texto privado', custom_fields: { inventory_code: 'REF-1' } })!;
    expect(applyPrivacy(record.normalized, adapter, true)).toEqual({ id: 2, first_name: 'Nome', custom_fields: { inventory_code: 'REF-1' } });
    expect(applyPrivacy(record.normalized, adapter, false)).toHaveProperty('signature');
  });
});
