import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { escapeGlob, isModuleKey, moduleFilter } from '@/lib/queries/module-filter';

const moduleRows = sqliteTable('module_rows', { moduleKey: text('module_key').notNull() });

/** SQLite em memória com as chaves de módulo de exemplo. Nenhum dado real. */
function setup() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite);
  db.run(sql`create table module_rows (module_key text not null)`);
  const keys = [
    'tickets',
    'tickets.tickets',
    'itsm.releases',
    'itsm.changes',
    'service_catalog',
    'service_catalog.items',
    'servicexcatalog.items',
    'users_groups.agents',
    'knowledge_base.articles',
    'settings.locations',
  ];
  for (const key of keys) db.run(sql`insert into module_rows (module_key) values (${key})`);
  return {
    db,
    close: () => sqlite.close(),
    matching(value: string): string[] {
      return db
        .select({ key: moduleRows.moduleKey })
        .from(moduleRows)
        .where(moduleFilter(moduleRows.moduleKey, value))
        .all()
        .map((row) => row.key)
        .sort();
    },
  };
}

describe('isModuleKey: aceita só grupo ou chave pontuada', () => {
  it.each(['tickets', 'service_catalog', 'itsm.releases', 'knowledge_base.articles'])('%s é válida', (key) => {
    expect(isModuleKey(key)).toBe(true);
  });

  it.each(['*', '*.*', 'tickets.*', 'a.b.c', '', 'Tickets', 'itsm.', '.tickets', '?', '[a]', "t'k", 'tickets;drop', 'a b', '1abc'])(
    '%j é recusada',
    (key) => {
      expect(isModuleKey(key)).toBe(false);
    },
  );
});

describe('escapeGlob: metacaracteres do GLOB viram literais', () => {
  it('escapa * ? [ ] como classes', () => {
    expect(escapeGlob('a*b?c[d]')).toBe('a[*]b[?]c[[]d[]]');
  });

  it('deixa "_" e "." intactos (não são metacaracteres do GLOB)', () => {
    expect(escapeGlob('service_catalog.x')).toBe('service_catalog.x');
  });
});

describe('moduleFilter: consulta real no SQLite', () => {
  it('module=* não casa tudo (chave inválida fecha sem linhas)', () => {
    const fixture = setup();
    try {
      expect(fixture.matching('*')).toEqual([]);
      expect(fixture.matching('*.*')).toEqual([]);
      expect(fixture.matching('?')).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  it('grupo casa só o próprio grupo e as chaves pontuadas dele', () => {
    const fixture = setup();
    try {
      expect(fixture.matching('tickets')).toEqual(['tickets.tickets']);
      expect(fixture.matching('itsm')).toEqual(['itsm.changes', 'itsm.releases']);
    } finally {
      fixture.close();
    }
  });

  it('"_" de service_catalog não vira curinga: servicexcatalog não entra (LIKE casaria)', () => {
    const fixture = setup();
    try {
      expect(fixture.matching('service_catalog')).toEqual(['service_catalog.items']);
      expect(fixture.matching('servicexcatalog')).toEqual(['servicexcatalog.items']);
    } finally {
      fixture.close();
    }
  });

  it('chave pontuada usa igualdade', () => {
    const fixture = setup();
    try {
      expect(fixture.matching('itsm.releases')).toEqual(['itsm.releases']);
      expect(fixture.matching('itsm.*')).toEqual([]);
    } finally {
      fixture.close();
    }
  });
});
