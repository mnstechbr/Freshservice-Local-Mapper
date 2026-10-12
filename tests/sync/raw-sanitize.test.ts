import { describe, expect, it } from 'vitest';
import type { ModuleAdapter } from '@/lib/freshservice/modules/types';
import { sanitizeRaw } from '@/lib/sync/persist';

/* Dados sintéticos. Campos de contato seguem a lista PERSON_SENSITIVE do módulo de pessoas. */
const adapter = {
  key: 'users_groups.agents',
  path: '/api/v2/agents',
  contentFields: ['description'],
  sensitiveFields: ['primary_email', 'secondary_emails', 'mobile_phone_number', 'address'],
} as unknown as ModuleAdapter;

const raw = {
  id: 1001,
  first_name: 'Pessoa',
  description: 'Texto de conteúdo sintético',
  primary_email: 'pessoa.sintetica@example.invalid',
  secondary_emails: ['outra.sintetica@example.invalid'],
  mobile_phone_number: '+55 00 00000-0000',
  address: 'Rua Sintética, 0',
  active: true,
};

describe('sanitizeRaw: raw_json', () => {
  it('sem metadataOnly: remove contato pessoal sempre e mantém o conteúdo', () => {
    expect(sanitizeRaw(raw, adapter, false)).toEqual({
      id: 1001,
      first_name: 'Pessoa',
      description: 'Texto de conteúdo sintético',
      active: true,
    });
  });

  it('com metadataOnly: remove conteúdo e contato', () => {
    const out = sanitizeRaw(raw, adapter, true);
    expect(out).toEqual({ id: 1001, first_name: 'Pessoa', active: true });
    const text = JSON.stringify(out);
    for (const value of ['sintetica', 'Texto de conteúdo', '+55', 'Rua Sint']) expect(text).not.toContain(value);
  });

  it('módulo sem campos sensíveis: só o conteúdo sai com metadataOnly', () => {
    const plain = { ...adapter, sensitiveFields: [] } as unknown as ModuleAdapter;
    // Ajuste D2 (QA 2026-10-11): primary_email está em GLOBAL_EXCLUDED_KEYS e nunca entra no raw_json,
    // mesmo sem sensibilidade declarada no módulo. A asserção antiga exigia o oposto (defeito).
    expect(sanitizeRaw(raw, plain, false)).not.toHaveProperty('primary_email');
    expect(sanitizeRaw(raw, plain, false)).toMatchObject({ description: raw.description });
    expect(sanitizeRaw(raw, plain, true)).not.toHaveProperty('description');
  });

  it('não altera o item original', () => {
    const copy = structuredClone(raw);
    sanitizeRaw(raw, adapter, true);
    expect(raw).toEqual(copy);
  });

  it('item que não é objeto não é gravado', () => {
    expect(sanitizeRaw('texto solto', adapter, true)).toBeNull();
    expect(sanitizeRaw([1, 2], adapter, false)).toBeNull();
    expect(sanitizeRaw(null, adapter, false)).toBeNull();
  });
});
