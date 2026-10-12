import { describe, expect, it, vi } from 'vitest';

// Estes testes cobrem só validação de entrada: nenhuma requisição chega ao banco.
vi.mock('@/lib/auth/context', () => ({
  getAuthDeps: () => {
    throw new Error('banco não deveria ser acessado nestes testes');
  },
}));

import { POST } from '@/app/api/changes/[id]/review/route';

const ORIGIN = 'http://127.0.0.1:3000';

function post(id: string, body: string, contentType = 'application/json') {
  return POST(
    new Request(`${ORIGIN}/api/changes/${id}/review`, {
      method: 'POST',
      headers: { 'content-type': contentType, origin: ORIGIN },
      body,
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe('POST /api/changes/[id]/review (validação)', () => {
  it('exige application/json (415)', async () => {
    expect((await post('1', '{}', 'text/plain')).status).toBe(415);
  });

  it('JSON inválido: 400', async () => {
    expect((await post('1', '{nao-json')).status).toBe(400);
  });

  it('decisão fora de confirm/reject: 400 com código invalid_input', async () => {
    const res = await post('1', JSON.stringify({ decision: 'talvez' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('campo extra no corpo é recusado (schema estrito): 400', async () => {
    expect((await post('1', JSON.stringify({ decision: 'confirm', extra: true }))).status).toBe(400);
  });

  it('id não numérico: 404 sem tocar no banco', async () => {
    const res = await post('abc', JSON.stringify({ decision: 'confirm' }));
    expect(res.status).toBe(404);
  });
});
