import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ANALYST_PERMISSIONS, type SimUser } from './fixtures';
import { expireAccessTokens, revokeRefreshTokens } from './provider';
import { resetSimState, simState } from './state';

/**
 * API de controle de TESTE do simulador (POST /simulador/control). Só responde com FSLM_SIMULATOR=1.
 * Nunca devolve senhas, client_secret, API key nem tokens.
 */
const text = z.string().trim().min(1).max(200);
const email = z.string().trim().email().max(200);
const network = z.union([z.literal('none'), z.literal('all'), z.array(text).max(50)]);

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reset') }),
  z.object({ action: z.literal('state') }),
  z.object({
    action: z.literal('configure'),
    access_token_ttl_seconds: z.number().int().min(1).max(86_400).optional(),
    code_ttl_seconds: z.number().int().min(1).max(3_600).optional(),
    network: network.optional(),
  }),
  z.object({
    action: z.literal('register_app'),
    client_id: text,
    client_secret: text,
    name: text.optional(),
    redirect_uris: z.array(z.string().trim().min(1).max(500)).min(1).max(5),
    allowed_scopes: z.array(text).min(1).max(200),
  }),
  z.object({
    action: z.literal('set_user'),
    id: text.optional(),
    name: text,
    email,
    password: text,
    mfa: z.boolean(),
    mfa_code: z.string().regex(/^\d{6}$/).optional(),
    api_key: text.nullable().optional(),
    permissions: z.record(z.string(), z.boolean()).optional(),
  }),
  z.object({ action: z.literal('expire_access_tokens'), user_email: email.optional() }),
  z.object({ action: z.literal('revoke_refresh_tokens'), user_email: email.optional() }),
  z.object({ action: z.literal('upsert_record'), resource: text, record: z.record(z.string(), z.unknown()) }),
  z.object({ action: z.literal('delete_record'), resource: text, id: z.number().int().min(1) }),
]);

export interface ControlResult {
  status: number;
  body: Record<string, unknown>;
}

const ok = (body: Record<string, unknown> = {}): ControlResult => ({ status: 200, body: { ok: true, ...body } });
const fail = (status: number, message: string): ControlResult => ({
  status,
  body: { ok: false, error: status === 404 ? 'not_found' : 'invalid_request', message },
});

function publicUser(user: SimUser) {
  return { id: user.id, email: user.email, mfa: user.mfa, permissions: user.permissions };
}

export function applyControl(input: unknown): ControlResult {
  const parsed = ActionSchema.safeParse(input);
  if (!parsed.success) return fail(400, 'Ação de controle inválida ou fora do contrato.');
  const cmd = parsed.data;
  const st = simState();
  const now = new Date().toISOString();

  switch (cmd.action) {
    case 'reset':
      resetSimState();
      return ok({ reset: true });
    case 'state':
      return ok({
        apps: [...st.apps.values()].map((app) => ({ client_id: app.clientId, redirect_uris: app.redirectUris, allowed_scopes: app.allowedScopes })),
        users: st.users.map(publicUser),
        scenario: st.scenario,
        counts: { sessions: st.sessions.size, flows: st.flows.size, codes: st.codes.size, access: st.access.size, refresh: st.refresh.size },
        records: Object.fromEntries([...st.dataset].map(([path, rows]) => [path, rows.length])),
      });
    case 'configure': {
      if (cmd.access_token_ttl_seconds !== undefined) st.scenario.accessTokenTtlSeconds = cmd.access_token_ttl_seconds;
      if (cmd.code_ttl_seconds !== undefined) st.scenario.codeTtlSeconds = cmd.code_ttl_seconds;
      if (cmd.network !== undefined) st.scenario.network = cmd.network;
      return ok({ scenario: st.scenario });
    }
    case 'register_app':
      st.apps.set(cmd.client_id, {
        name: cmd.name ?? cmd.client_id,
        clientId: cmd.client_id,
        clientSecret: cmd.client_secret,
        redirectUris: cmd.redirect_uris,
        allowedScopes: cmd.allowed_scopes,
      });
      return ok({ client_id: cmd.client_id });
    case 'set_user': {
      const wanted = cmd.email.toLowerCase();
      const existing = st.users.find((user) => user.email.toLowerCase() === wanted || (cmd.id !== undefined && user.id === cmd.id));
      const user: SimUser = {
        id: cmd.id ?? existing?.id ?? randomUUID(),
        name: cmd.name,
        email: cmd.email,
        password: cmd.password,
        mfa: cmd.mfa,
        mfaCode: cmd.mfa_code ?? existing?.mfaCode ?? '135790',
        apiKey: cmd.api_key !== undefined ? cmd.api_key : (existing?.apiKey ?? null),
        permissions: { ...(existing?.permissions ?? ANALYST_PERMISSIONS), ...(cmd.permissions ?? {}) },
      };
      if (existing) st.users[st.users.indexOf(existing)] = user;
      else st.users.push(user);
      return ok({ user: publicUser(user) });
    }
    case 'expire_access_tokens':
      return ok({ changed: expireAccessTokens(cmd.user_email) });
    case 'revoke_refresh_tokens':
      return ok({ changed: revokeRefreshTokens(cmd.user_email) });
    case 'upsert_record': {
      const rows = st.dataset.get(cmd.resource);
      if (!rows) return fail(404, 'Recurso desconhecido no simulador.');
      const id = cmd.record.id;
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) return fail(400, 'record.id deve ser inteiro positivo.');
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) {
        rows[index] = { ...rows[index], ...cmd.record, id, updated_at: now };
        return ok({ resource: cmd.resource, id, change: 'updated' });
      }
      rows.push({ ...cmd.record, id, created_at: now, updated_at: now });
      return ok({ resource: cmd.resource, id, change: 'created' });
    }
    case 'delete_record': {
      const rows = st.dataset.get(cmd.resource);
      if (!rows) return fail(404, 'Recurso desconhecido no simulador.');
      const index = rows.findIndex((row) => row.id === cmd.id);
      if (index >= 0) rows.splice(index, 1);
      return ok({ resource: cmd.resource, id: cmd.id, deleted: index >= 0 });
    }
  }
}
