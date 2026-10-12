import 'server-only';
import { z } from 'zod';
import { instances } from '../db/schema';
import { DnsGuardError, ensurePublicDnsTarget } from '../security/dns-guard';
import { UrlValidationError, normalizeInstanceUrl } from '../security/url';
import { type AuthDeps } from './deps';
import { AuthError } from './errors';
import { invalidFields } from './route-utils';
import {
  ACTIVE_INSTANCE_KEY,
  type InstanceRow,
  activeInstanceId,
  findInstance,
  findInstanceByOrigin,
  listInstanceRows,
  writeSetting,
} from './repo';

const createInstanceSchema = z.object({
  base_url: z.string(),
  display_name: z.string().max(80).optional(),
  allow_custom_domain: z.boolean().optional(),
});

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function instanceDto(row: InstanceRow, activeId: number | null) {
  return {
    id: row.id,
    display_name: row.displayName,
    origin: row.baseUrl,
    is_active: row.id === activeId,
    created_at: row.createdAt,
  };
}

export function listInstances(deps: AuthDeps) {
  const activeId = activeInstanceId(deps.db);
  return {
    active_instance_id: activeId,
    instances: listInstanceRows(deps.db).map((row) => instanceDto(row, activeId)),
  };
}

/** Instância ativa ou erro 409 (o front deve cadastrar uma instância antes). */
export function requireActiveInstance(deps: AuthDeps): InstanceRow {
  const id = activeInstanceId(deps.db);
  const row = id === null ? undefined : findInstance(deps.db, id);
  if (!row) {
    throw new AuthError(
      'no_active_instance',
      409,
      'Nenhuma instância ativa. Cadastre uma instância em POST /api/instances.',
    );
  }
  return row;
}

/** Recusa o host se a resolução apontar para endereço interno ou se o DNS falhar. Erro sanitizado. */
async function checkInstanceDestination(hostname: string): Promise<void> {
  try {
    await ensurePublicDnsTarget(hostname);
  } catch (error) {
    if (error instanceof DnsGuardError) throw new AuthError(error.code, 400, error.message);
    throw error;
  }
}

/**
 * Cadastra (ou reativa, se já existir) uma instância e a torna ativa. A URL é normalizada para a
 * origem https e o host é resolvido por DNS: recusa se algum endereço não for público. Nenhum dado
 * sensível é devolvido.
 */
export async function createInstance(deps: AuthDeps, body: unknown) {
  const parsed = createInstanceSchema.safeParse(body);
  if (!parsed.success) throw invalidFields(parsed.error);

  let normalized: ReturnType<typeof normalizeInstanceUrl>;
  try {
    normalized = normalizeInstanceUrl(parsed.data.base_url, {
      allowCustomDomain: parsed.data.allow_custom_domain === true,
    });
    if (normalized.kind === 'custom') {
      throw new UrlValidationError(
        'A API exige o domínio original *.freshservice.com. Domínios customizados não são aceitos para cadastro, sincronização ou diagnóstico.',
      );
    }
  } catch (error) {
    if (error instanceof UrlValidationError) throw new AuthError('invalid_url', 400, error.message);
    throw error;
  }
  await checkInstanceDestination(normalized.hostname);

  const requestedName = parsed.data.display_name?.trim();
  if (requestedName !== undefined && CONTROL_CHARS.test(requestedName)) {
    throw new AuthError('invalid_input', 400, 'Campos inválidos: display_name.');
  }
  const displayName = requestedName || normalized.hostname.split('.')[0] || normalized.hostname;

  const existing = findInstanceByOrigin(deps.db, normalized.origin);
  const now = deps.now();
  const row =
    existing ??
    deps.db
      .insert(instances)
      .values({ baseUrl: normalized.origin, displayName, createdAt: now, updatedAt: now })
      .returning()
      .get();

  writeSetting(deps.db, ACTIVE_INSTANCE_KEY, row.id);
  deps.audit.log({
    level: 'info',
    eventType: existing ? 'instance.activated' : 'instance.created',
    instanceId: row.id,
    message: existing ? 'Instância existente ativada.' : 'Instância cadastrada e ativada.',
    context: { kind: normalized.kind },
  });

  return {
    created: existing === undefined,
    active_instance_id: row.id,
    instance: instanceDto(row, row.id),
  };
}
