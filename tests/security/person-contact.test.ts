import { describe, expect, it } from 'vitest';
import { PERSON_SENSITIVE, usersGroupsAdapters } from '../../src/lib/freshservice/modules/users-groups';
import { makeAdapter } from '../../src/lib/freshservice/modules/types';
import { applyPrivacy } from '../../src/lib/sync/prefs';

/** Item sintético de agente. Contatos fictícios (domínio example.com, números reservados). */
const RAW_AGENT = {
  id: 42,
  first_name: 'Ana',
  last_name: 'Sintetica',
  job_title: 'Analista',
  active: true,
  department_ids: [1],
  group_ids: [2],
  location_id: 3,
  workspace_id: 1,
  primary_email: 'ana.sintetica@example.com',
  secondary_emails: ['ana.alt@example.com'],
  work_phone_number: '+55 11 0000-0000',
  mobile_phone_number: '+55 11 90000-0000',
  address: 'Rua Sintetica, 1',
};

const CONTACT_VALUES = ['ana.sintetica@example.com', 'ana.alt@example.com', '0000-0000', '90000-0000', 'Rua Sintetica'];

function personAdapters() {
  return usersGroupsAdapters.filter((adapter) => adapter.key === 'users_groups.agents' || adapter.key === 'users_groups.requesters');
}

describe('users_groups (agents e requesters): contato pessoal fora da whitelist', () => {
  it('PERSON_SENSITIVE cobre e-mails, telefones e endereço', () => {
    expect([...PERSON_SENSITIVE].sort()).toEqual(
      ['address', 'mobile_phone_number', 'primary_email', 'secondary_emails', 'work_phone_number'].sort(),
    );
  });

  it.each(['users_groups.agents', 'users_groups.requesters'])('%s: normalized nunca traz campos de contato', (key) => {
    const adapter = personAdapters().find((a) => a.key === key);
    expect(adapter).toBeDefined();
    const record = adapter?.toResource(RAW_AGENT);
    expect(record).not.toBeNull();
    const keys = Object.keys(record?.normalized ?? {});
    for (const field of PERSON_SENSITIVE) expect(keys).not.toContain(field);
    expect(record?.normalized.first_name).toBe('Ana');
  });

  it.each([true, false])('applyPrivacy (metadataOnly=%s) não deixa contato passar', (metadataOnly) => {
    for (const adapter of personAdapters()) {
      const record = adapter.toResource(RAW_AGENT);
      const kept = applyPrivacy(record?.normalized ?? {}, adapter, metadataOnly);
      const serialized = JSON.stringify(kept);
      for (const value of CONTACT_VALUES) expect(serialized).not.toContain(value);
      expect(kept.first_name).toBe('Ana');
    }
  });
});

describe('metadataOnly remove campos sensíveis mesmo se a whitelist crescer', () => {
  // Simula a whitelist crescendo para incluir contato: a regra precisa continuar valendo.
  const grown = makeAdapter({
    key: 'users_groups.agents',
    listKey: 'agents',
    moduleGroup: 'users_groups',
    name: 'Agentes (simulado)',
    path: '/api/v2/agents',
    paginated: true,
    docNote: 'Adaptador sintético para o teste.',
    fields: ['id', 'first_name', 'primary_email', 'mobile_phone_number', 'address'],
    sensitiveFields: PERSON_SENSITIVE,
  });

  it('com metadataOnly, os campos sensíveis saem do registro', () => {
    const record = grown.toResource(RAW_AGENT);
    // Normalização ampla (recuperação etapa 4): contato pessoal é excluído globalmente, então nem chega a normalized.
    expect(record?.normalized.primary_email).toBeUndefined();
    expect(record?.normalized.address).toBe('Rua Sintetica, 1');
    const kept = applyPrivacy(record?.normalized ?? {}, grown, true);
    expect(kept).not.toHaveProperty('primary_email');
    expect(kept).not.toHaveProperty('mobile_phone_number');
    expect(kept).not.toHaveProperty('address');
    expect(kept.first_name).toBe('Ana');
  });

  it('sem metadataOnly, contato global nunca entra; campos não globais passam (regra nova da etapa 4)', () => {
    const record = grown.toResource(RAW_AGENT);
    const kept = applyPrivacy(record?.normalized ?? {}, grown, false);
    expect(kept).not.toHaveProperty('primary_email');
    expect(kept).toHaveProperty('address');
  });
});
