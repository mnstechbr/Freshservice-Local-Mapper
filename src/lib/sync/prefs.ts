/*
 * Preferências de coleta (app_settings 'sync_preferences'): módulos coletados, somente metadados por
 * item e guardar resposta original. Mesmo formato de GET/PUT /api/sync/preferences.
 *
 * Regra única de metadataOnly (motor e tela usam a mesma função):
 *   1. chave exata do endpoint (ex.: 'tickets.tickets');
 *   2. chave de grupo ('tickets'); para settings.locations, a chave 'locations';
 *   3. padrão DEFAULT_METADATA_ONLY, pelas mesmas chaves;
 *   4. false.
 * Preferência explícita, em qualquer nível, sempre prevalece sobre o padrão.
 */
import 'server-only';
import { readSetting, writeSetting } from '../auth/repo';
import type { AppDb } from '../db/client';
import { MODULE_ADAPTERS, syncableAdapters, type ModuleAdapter } from '../freshservice/modules';
import { MODULES } from '../modules/catalog';
import { withoutNeverStoredKeys } from '../freshservice/modules/types';
import type { SyncPreferences } from './types';

export const SYNC_PREFERENCES_KEY = 'sync_preferences';

/** Padrão do produto: tickets.*, ITSM e knowledge_base.articles só metadados. Usa as mesmas chaves da resolução. */
export const DEFAULT_METADATA_ONLY: Readonly<Record<string, boolean>> = {
  tickets: true,
  itsm: true,
  'knowledge_base.articles': true,
};

export interface StoredPreferences {
  modules: string[];
  metadataOnly: Record<string, boolean>;
  storeRaw: boolean;
}

/** Grupos do catálogo e 'locations' (settings.locations, que o grupo 'settings' não cobre). */
const GROUP_KEYS: readonly string[] = [...MODULES.map((module) => module.key), 'locations'];

/** Chaves aceitas em `modules`: grupos, 'locations' e chaves exatas de endpoint (o que a tela grava). */
export const PREFERENCE_KEYS: readonly string[] = [
  ...new Set([...GROUP_KEYS, ...MODULE_ADAPTERS.map((adapter) => adapter.key)]),
];

function readRaw(db: AppDb): Record<string, unknown> | null {
  const value = readSetting<unknown>(db, SYNC_PREFERENCES_KEY);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Valor ausente ou inválido vira o padrão. Preferência ruim nunca derruba a sincronização. */
export function readStoredPreferences(db: AppDb): StoredPreferences {
  const raw = readRaw(db);
  const list = raw?.modules;
  const modules = Array.isArray(list)
    ? list.filter((item): item is string => typeof item === 'string' && PREFERENCE_KEYS.includes(item))
    : [...GROUP_KEYS];
  // Só o que foi gravado explicitamente. O padrão entra na resolução (resolveMetadataOnly), não aqui.
  const metadataOnly: Record<string, boolean> = {};
  const flags = raw?.metadataOnly;
  if (flags && typeof flags === 'object' && !Array.isArray(flags)) {
    for (const [key, flag] of Object.entries(flags as Record<string, unknown>)) {
      if (typeof flag === 'boolean') metadataOnly[key] = flag;
    }
  }
  return { modules: [...new Set(modules)], metadataOnly, storeRaw: raw?.storeRaw === true };
}

/** Motor: metadataOnly explícito e storeRaw. A decisão efetiva por módulo fica em isMetadataOnly. */
export function readSyncPreferences(db: AppDb): SyncPreferences {
  const stored = readStoredPreferences(db);
  return { metadataOnly: stored.metadataOnly, storeRaw: stored.storeRaw };
}

export function writeStoredPreferences(db: AppDb, prefs: StoredPreferences): void {
  writeSetting(db, SYNC_PREFERENCES_KEY, {
    modules: prefs.modules,
    metadataOnly: prefs.metadataOnly,
    storeRaw: prefs.storeRaw,
  });
}

/** Chaves que decidem a preferência de um módulo, do mais específico ao mais geral. */
export function prefKeysFor(moduleKey: string): string[] {
  if (moduleKey === 'settings.locations') return [moduleKey, 'locations'];
  return [moduleKey, moduleKey.split('.')[0] ?? moduleKey];
}

/** Item da tela cobre o adaptador. 'locations' é o item próprio de settings.locations. */
export function adapterMatchesPreference(
  adapter: Pick<ModuleAdapter, 'key' | 'moduleGroup'>,
  preferenceKey: string,
): boolean {
  if (adapter.key === preferenceKey) return true;
  if (preferenceKey === 'locations') return adapter.key === 'settings.locations';
  if (adapter.key === 'settings.locations') return false;
  return adapter.moduleGroup === preferenceKey;
}

/** Resolução única: explícito (chave exata, depois grupo) antes do padrão (mesma ordem). */
export function resolveMetadataOnly(explicit: Readonly<Record<string, boolean>>, moduleKey: string): boolean {
  const keys = prefKeysFor(moduleKey);
  for (const source of [explicit, DEFAULT_METADATA_ONLY]) {
    for (const key of keys) {
      const flag = source[key];
      if (typeof flag === 'boolean') return flag;
    }
  }
  return false;
}

export function isMetadataOnly(prefs: SyncPreferences, moduleKey: string): boolean {
  return resolveMetadataOnly(prefs.metadataOnly, moduleKey);
}

/**
 * Visão efetiva para a tela e para GET/PUT: `modules` e `metadataOnly` por chave exata de endpoint
 * consultável, com o valor que o motor de fato aplica. Não grava nada.
 */
export function effectivePreferences(stored: StoredPreferences): StoredPreferences {
  const adapters = syncableAdapters();
  return {
    modules: adapters
      .filter((adapter) => stored.modules.some((key) => adapterMatchesPreference(adapter, key)))
      .map((adapter) => adapter.key),
    metadataOnly: Object.fromEntries(
      adapters.map((adapter) => [adapter.key, resolveMetadataOnly(stored.metadataOnly, adapter.key)]),
    ),
    storeRaw: stored.storeRaw,
  };
}

export function readPreferencesView(db: AppDb): StoredPreferences {
  return effectivePreferences(readStoredPreferences(db));
}

/** Aplica exclusões permanentes; com metadataOnly remove também conteúdo/sensíveis de topo. Não altera o original. */
export function applyPrivacy(
  normalized: Record<string, unknown>,
  adapter: ModuleAdapter,
  metadataOnly: boolean,
): Record<string, unknown> {
  // Exclusões permanentes também valem para raw_json (sanitizeRaw usa esta função).
  const safe = withoutNeverStoredKeys(normalized, new Set(adapter.excludeFields ?? [])) as Record<string, unknown>;
  if (!metadataOnly) return safe;
  const drop = new Set<string>([...adapter.contentFields, ...adapter.sensitiveFields]);
  return Object.fromEntries(Object.entries(safe).filter(([key]) => !drop.has(key)));
}
