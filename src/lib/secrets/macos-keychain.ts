import {
  type Availability,
  type SecretStore,
  SecretStoreError,
  deserializeSecret,
  serializeSecret,
} from './types';
import { type CommandRunner, isCommandMissing } from './command';

const SECURITY_BIN = '/usr/bin/security';
const SERVICE_ATTRIBUTE = 'freshservice-local-mapper';
/** errSecItemNotFound: item inexistente. */
const NOT_FOUND_CODE = 44;

/**
 * macOS: Keychain via `security`. Para não expor o segredo em argv (visível em `ps`), a gravação
 * usa `security -i` com o comando pela entrada padrão. O valor vai em base64 (só caracteres
 * seguros para o comando). Não testado em macOS real: validado só com runner simulado.
 */
export function createKeychainStore(
  run: CommandRunner,
  exists: (path: string) => boolean,
  platform: NodeJS.Platform,
): SecretStore {
  return {
    backend: 'macos-keychain',

    async isAvailable(): Promise<Availability> {
      if (platform !== 'darwin') return { available: false, reason: 'Keychain só existe no macOS.' };
      if (!exists(SECURITY_BIN)) {
        return { available: false, reason: 'O utilitário security do macOS não foi encontrado.' };
      }
      return { available: true };
    },

    async get(ref) {
      const result = await run(SECURITY_BIN, [
        'find-generic-password',
        '-s',
        SERVICE_ATTRIBUTE,
        '-a',
        ref,
        '-w',
      ]);
      if (result.code === NOT_FOUND_CODE) return null;
      if (result.code !== 0) throw new SecretStoreError('Falha ao ler o Keychain do macOS.');
      return deserializeSecret(
        Buffer.from(result.stdout.trimEnd(), 'base64').toString('utf8'),
      );
    },

    async set(ref, value) {
      const encoded = Buffer.from(serializeSecret(value), 'utf8').toString('base64');
      const command = `add-generic-password -U -s "${SERVICE_ATTRIBUTE}" -a "${ref}" -w "${encoded}"\n`;
      const result = await run(SECURITY_BIN, ['-i'], { input: command }).catch((error: unknown) => {
        if (isCommandMissing(error)) throw new SecretStoreError('O utilitário security não foi encontrado.');
        throw error;
      });
      if (result.code !== 0) throw new SecretStoreError('Falha ao gravar no Keychain do macOS.');
    },

    async delete(ref) {
      const result = await run(SECURITY_BIN, [
        'delete-generic-password',
        '-s',
        SERVICE_ATTRIBUTE,
        '-a',
        ref,
      ]);
      if (result.code !== 0 && result.code !== NOT_FOUND_CODE) {
        throw new SecretStoreError('Falha ao remover o segredo do Keychain do macOS.');
      }
    },
  };
}
