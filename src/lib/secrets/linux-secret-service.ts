import {
  type Availability,
  type SecretStore,
  SecretStoreError,
  deserializeSecret,
  serializeSecret,
} from './types';
import {
  type CommandResult,
  type CommandRunner,
  CommandTimeoutError,
  isCommandMissing,
} from './command';

const PROGRAM = 'secret-tool';
const SERVICE_ATTRIBUTE = 'freshservice-local-mapper';
const PROBE_ATTRIBUTE = 'fslm-probe';
const PROBE_VALUE = 'x';
/** Tempo máximo da sonda: D-Bus parado ou cofre aguardando desbloqueio não podem travar a aplicação. */
export const PROBE_TIMEOUT_MS = 3_000;

export const DBUS_UNAVAILABLE_REASON =
  'Sem D-Bus de sessão ou serviço de segredos (org.freedesktop.secrets) acessível.';

/** Texto de erro típico de D-Bus ausente. Código 1 do secret-tool também significa "não encontrado", então o texto decide. */
const DBUS_FAILURE =
  /autolaunch|d-bus|session bus|org\.freedesktop\.secrets|serviceunknown|not provided by any|no such interface|failed to connect/i;

/** Motivo fixo para falha de secret-tool. O texto bruto do programa nunca é repassado. */
function failureReason(result: CommandResult): string {
  if (DBUS_FAILURE.test(result.stderr)) return DBUS_UNAVAILABLE_REASON;
  return `secret-tool falhou (código ${result.code}).`;
}

/** Código 0: o serviço respondeu. Código 1 sem texto: respondeu, sem itens. Demais: indisponível. */
function probeOutcome(result: CommandResult): Availability {
  if (result.code === 0 || (result.code === 1 && result.stderr.trim() === '')) {
    return { available: true };
  }
  return { available: false, reason: failureReason(result) };
}

function probeErrorReason(error: unknown): string {
  if (isCommandMissing(error)) {
    return 'secret-tool não está instalado (pacote libsecret-tools ou libsecret).';
  }
  if (error instanceof CommandTimeoutError) {
    return `O serviço de segredos não respondeu em ${PROBE_TIMEOUT_MS / 1000} s (D-Bus parado ou cofre aguardando desbloqueio).`;
  }
  return 'Não foi possível executar secret-tool.';
}

/**
 * Linux: libsecret via CLI `secret-tool`. Chamado sem shell; o segredo vai pela entrada padrão.
 * A sonda consulta de verdade o serviço (search com timeout curto). Só é disponível se o serviço responder.
 */
export function createSecretToolStore(run: CommandRunner): SecretStore {
  return {
    backend: 'linux-secret-service',

    async isAvailable(): Promise<Availability> {
      try {
        const result = await run(
          PROGRAM,
          ['search', '--all', PROBE_ATTRIBUTE, PROBE_VALUE],
          { timeoutMs: PROBE_TIMEOUT_MS },
        );
        return probeOutcome(result);
      } catch (error) {
        return { available: false, reason: probeErrorReason(error) };
      }
    },

    async get(ref) {
      const result = await run(PROGRAM, ['lookup', 'service', SERVICE_ATTRIBUTE, 'account', ref]);
      // Código 1 sem texto é "não encontrado". Com texto é falha do cofre: não pode virar "sem segredo".
      if (result.code === 1 && result.stderr.trim() === '') return null;
      if (result.code !== 0) {
        throw new SecretStoreError(`Falha ao acessar o cofre do sistema: ${failureReason(result)}`);
      }
      return deserializeSecret(result.stdout);
    },

    async set(ref, value) {
      const result = await run(
        PROGRAM,
        ['store', '--label=Freshservice Local Mapper', 'service', SERVICE_ATTRIBUTE, 'account', ref],
        { input: serializeSecret(value) },
      );
      if (result.code !== 0) {
        throw new SecretStoreError(`Falha ao gravar no cofre do sistema: ${failureReason(result)}`);
      }
    },

    async delete(ref) {
      const result = await run(PROGRAM, ['clear', 'service', SERVICE_ATTRIBUTE, 'account', ref]);
      if (result.code === 0) return;
      if (result.code === 1 && result.stderr.trim() === '') return;
      throw new SecretStoreError(`Falha ao remover do cofre do sistema: ${failureReason(result)}`);
    },
  };
}
