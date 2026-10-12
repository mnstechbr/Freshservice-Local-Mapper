/*
 * Cabeçalho Authorization do motor. OAuth: resolveOAuthAccessToken com uma renovação por vez por
 * instância (Promise compartilhada). API key: Basic com a chave lida do cofre (uma vez por execução).
 * O valor nunca é registrado em log nem em mensagem de erro.
 */
import 'server-only';
import { basicAuthorization, resolveApiKey } from '../auth/api-key';
import type { AuthDeps } from '../auth/deps';
import { AuthError } from '../auth/errors';
import { OAUTH_REFRESH_MARGIN_MS, resolveOAuthAccessToken } from '../auth/oauth';
import { findConnection, type ConnectionRow } from '../auth/repo';
import type { AppDb } from '../db/client';

const FLIGHTS_KEY = '__fslmOAuthFlights';

/** Renovações em voo por instância, em globalThis: uma só fila mesmo se o módulo for recarregado. */
function flightsMap(): Map<number, Promise<string>> {
  const holder = globalThis as unknown as Record<string, Map<number, Promise<string>> | undefined>;
  if (!holder[FLIGHTS_KEY]) holder[FLIGHTS_KEY] = new Map<number, Promise<string>>();
  return holder[FLIGHTS_KEY];
}

/** Quem chega durante um refresh recebe a mesma Promise. Um refresh por instância por vez. */
export function sharedFlight(instanceId: number, start: () => Promise<string>): Promise<string> {
  const flights = flightsMap();
  const running = flights.get(instanceId);
  if (running) return running;
  const flight: Promise<string> = start().finally(() => {
    if (flights.get(instanceId) === flight) flights.delete(instanceId);
  });
  flights.set(instanceId, flight);
  return flight;
}

export interface AuthorizationInput {
  db: AppDb;
  auth: AuthDeps;
  instanceId: number;
  /** Injetável em testes. Padrão: resolveOAuthAccessToken. */
  resolveOAuth?: (connection: ConnectionRow) => Promise<string>;
}

/** Devolve uma função que entrega o cabeçalho Authorization. Cacheia enquanto o token for válido. */
export function createAuthorizationProvider(input: AuthorizationInput): () => Promise<string> {
  let cached: { header: string; permanent: boolean; expiresAt: number } | null = null;
  return async () => {
    const now = input.auth.now();
    if (cached && (cached.permanent || cached.expiresAt - now > OAUTH_REFRESH_MARGIN_MS)) return cached.header;
    const connection = findConnection(input.db, input.instanceId);
    if (!connection) throw new AuthError('no_secret', 409, 'Conexão não encontrada.');

    if (connection.authMode === 'oauth') {
      return sharedFlight(input.instanceId, async () => {
        const resolve = input.resolveOAuth ?? ((row: ConnectionRow) => resolveOAuthAccessToken(input.auth, row));
        const token = await resolve(connection);
        const fresh = findConnection(input.db, input.instanceId);
        const header = `Bearer ${token}`;
        cached = { header, permanent: false, expiresAt: fresh?.tokenExpiresAt ?? 0 };
        return header;
      });
    }

    const apiKey = await resolveApiKey(input.auth, connection.secretRef);
    const header = basicAuthorization(apiKey);
    cached = { header, permanent: true, expiresAt: 0 };
    return header;
  };
}
