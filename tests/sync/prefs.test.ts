import { afterEach, describe, expect, it } from 'vitest';
import { writeSetting } from '@/lib/auth/repo';
import { syncableAdapters } from '@/lib/freshservice/modules';
import {
  DEFAULT_METADATA_ONLY,
  isMetadataOnly,
  readPreferencesView,
  readStoredPreferences,
  readSyncPreferences,
  resolveMetadataOnly,
  SYNC_PREFERENCES_KEY,
} from '@/lib/sync/prefs';
import { selectedModuleKeys } from '@/lib/sync/service';
import { createSyncEnv, type SyncEnv } from '../helpers/sync-env';

const envs: SyncEnv[] = [];
afterEach(() => {
  while (envs.length > 0) envs.pop()?.app.close();
});

const none = { metadataOnly: {}, storeRaw: false };

describe('metadataOnly: resolução única (chave exata > grupo > padrão)', () => {
  it('padrão: tickets.* e knowledge_base.articles só metadados; o restante não', () => {
    expect(isMetadataOnly(none, 'tickets.tickets')).toBe(true);
    expect(isMetadataOnly(none, 'tickets.form_fields')).toBe(true);
    expect(isMetadataOnly(none, 'knowledge_base.articles')).toBe(true);
    expect(isMetadataOnly(none, 'knowledge_base.folders')).toBe(false);
    expect(isMetadataOnly(none, 'users_groups.agents')).toBe(false);
    expect(isMetadataOnly(none, 'settings.locations')).toBe(false);
  });

  it('padrão é descrito pelas mesmas chaves da resolução', () => {
    expect(Object.keys(DEFAULT_METADATA_ONLY).sort()).toEqual(['itsm', 'knowledge_base.articles', 'tickets']);
  });

  it('chave exata prevalece sobre a de grupo', () => {
    const prefs = { metadataOnly: { tickets: true, 'tickets.tickets': false }, storeRaw: false };
    expect(isMetadataOnly(prefs, 'tickets.tickets')).toBe(false);
    expect(isMetadataOnly(prefs, 'tickets.form_fields')).toBe(true);
  });

  it('preferência de grupo explícita prevalece sobre o padrão da chave exata', () => {
    expect(isMetadataOnly({ metadataOnly: { knowledge_base: false }, storeRaw: false }, 'knowledge_base.articles')).toBe(false);
    expect(isMetadataOnly({ metadataOnly: { tickets: false }, storeRaw: false }, 'tickets.tickets')).toBe(false);
  });

  it('chave exata explícita prevalece sobre grupo explícito e sobre o padrão', () => {
    const prefs = { metadataOnly: { 'knowledge_base.articles': false, knowledge_base: true }, storeRaw: false };
    expect(isMetadataOnly(prefs, 'knowledge_base.articles')).toBe(false);
  });

  it('grupo explícito sem chave exata vale para todo o grupo', () => {
    expect(isMetadataOnly({ metadataOnly: { users_groups: true }, storeRaw: false }, 'users_groups.agents')).toBe(true);
  });

  it("settings.locations usa a chave 'locations', não o grupo 'settings'", () => {
    expect(isMetadataOnly({ metadataOnly: { locations: true }, storeRaw: false }, 'settings.locations')).toBe(true);
    expect(isMetadataOnly({ metadataOnly: { settings: true }, storeRaw: false }, 'settings.locations')).toBe(false);
  });

  it('valor não booleano é ignorado e cai para o padrão; chave desconhecida vira false', () => {
    expect(resolveMetadataOnly({ 'tickets.tickets': 'nao' as unknown as boolean }, 'tickets.tickets')).toBe(true);
    expect(resolveMetadataOnly({}, 'constructor')).toBe(false);
  });
});

describe('preferências persistidas', () => {
  it('chaves de endpoint gravadas pela tela sobrevivem à releitura e controlam a seleção', async () => {
    const env = await createSyncEnv(null);
    envs.push(env);
    writeSetting(env.db, SYNC_PREFERENCES_KEY, {
      modules: ['tickets.tickets', 'nao_existe', 'settings.locations'],
      metadataOnly: { 'tickets.tickets': false, 'knowledge_base.articles': false },
      storeRaw: false,
    });
    expect(readStoredPreferences(env.db).modules.sort()).toEqual(['settings.locations', 'tickets.tickets']);
    expect(selectedModuleKeys(env.db).sort()).toEqual(['settings.locations', 'tickets.tickets']);
    expect(readSyncPreferences(env.db).metadataOnly).toEqual({ 'tickets.tickets': false, 'knowledge_base.articles': false });
  });

  it('visão efetiva: padrão aplicado por endpoint e igual ao que o motor decide', async () => {
    const env = await createSyncEnv(null);
    envs.push(env);
    const view = readPreferencesView(env.db);
    expect(view.modules.sort()).toEqual(syncableAdapters().map((adapter) => adapter.key).sort());
    expect(view.metadataOnly['tickets.tickets']).toBe(true);
    expect(view.metadataOnly['knowledge_base.articles']).toBe(true);
    expect(view.metadataOnly['users_groups.agents']).toBe(false);

    const engine = readSyncPreferences(env.db);
    for (const adapter of syncableAdapters()) {
      expect(view.metadataOnly[adapter.key]).toBe(isMetadataOnly(engine, adapter.key));
    }
  });

  it('visão efetiva reflete a preferência explícita de grupo sem gravar as chaves de endpoint', async () => {
    const env = await createSyncEnv(null);
    envs.push(env);
    writeSetting(env.db, SYNC_PREFERENCES_KEY, { modules: ['knowledge_base'], metadataOnly: { knowledge_base: false }, storeRaw: true });
    const view = readPreferencesView(env.db);
    expect(view.metadataOnly['knowledge_base.articles']).toBe(false);
    expect(view.modules.every((key) => key.startsWith('knowledge_base.'))).toBe(true);
    expect(view.storeRaw).toBe(true);
    expect(readStoredPreferences(env.db).metadataOnly).toEqual({ knowledge_base: false });
  });
});
