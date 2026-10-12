import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, win32 } from 'node:path';
import { type CommandRunner } from './command';
import {
  type Availability,
  type SecretStore,
  SecretStoreError,
  deserializeSecret,
  parseSecretRef,
  serializeSecret,
} from './types';

/** Não resolve PowerShell pelo PATH: a pasta atual poderia conter um executável malicioso. */
function powershellProgram(env: Record<string, string | undefined>): string {
  const root = env.SystemRoot ?? env.SYSTEMROOT;
  if (typeof root !== 'string' || !/^[a-z]:[\\/]/i.test(root) ||
      /[\x00-\x1f"<>|?*]/.test(root) || root.slice(2).includes(':') ||
      root.split(/[\\/]/).some((part) => part === '.' || part === '..')) {
    throw new SecretStoreError('SystemRoot ausente ou inválido: PowerShell do sistema indisponível.');
  }
  return win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}
export const DPAPI_DIR_NAME = 'secrets';
/** Partida do PowerShell 5.1 pode ser lenta (antivírus, disco frio): mais folga que o padrão de 10 s. */
const DPAPI_TIMEOUT_MS = 20_000;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const HEX_PATTERN = /^[0-9a-fA-F]+$/;

/*
 * Codificação. O PowerShell 5.1 lê a entrada padrão e escreve a saída com a codepage do console
 * ([Console]::InputEncoding/OutputEncoding, p. ex. CP850 em pt-BR), e não com UTF-8. Um segredo com
 * acento ou símbolo seria corrompido em silêncio. Por isso o texto trafega sempre em base64 (ASCII) e
 * o script converte para UTF-8 com [Text.Encoding]::UTF8. O base64 existe só no canal entre processos
 * (stdin/stdout). A entrada é consumida por `$input` com `-InputFormat Text`: o host PowerShell
 * entrega stdin ao pipeline, portanto Console.In pode já estar vazio. Nunca usamos stdin como código.
 * O arquivo gravado é só o texto cifrado pelo DPAPI (saída de ConvertFrom-SecureString).
 *
 * Os scripts vão em -EncodedCommand (UTF-16LE em base64): nenhum caractere do script passa pelas regras
 * de aspas do Windows, e a execução não depende de ExecutionPolicy (que vale só para arquivos .ps1).
 */

/** Só rótulos fixos: IDs e tipos são inspecionados, nunca impressos. */
const FAILURE_KIND_SCRIPT = [
  "if ($_.Exception -is [System.Management.Automation.CommandNotFoundException]) { [Console]::Error.Write('FSLM_DPAPI_KIND_COMMAND_MISSING') }",
  "elseif ($_.FullyQualifiedErrorId -match 'ParameterArgumentValidationError(EmptyString|Null)NotAllowed') { [Console]::Error.Write('FSLM_DPAPI_KIND_EMPTY_ARGUMENT') }",
  "elseif ($_.FullyQualifiedErrorId -match 'Modules_(InsufficientPowerShellVersion|InvalidManifest|UnsupportedPowerShellVersion)|ModuleRequiresNewerPowerShellVersion' -or $_.Exception -is [System.BadImageFormatException] -or $_.Exception -is [System.IO.FileLoadException]) { [Console]::Error.Write('FSLM_DPAPI_KIND_MODULE_INCOMPATIBLE') }",
  "elseif ($_.FullyQualifiedErrorId -match 'ConstrainedLanguage|MethodInvocationNotSupported|CannotCreateType') { [Console]::Error.Write('FSLM_DPAPI_KIND_LANGUAGE_RESTRICTED') }",
  "elseif ($_.Exception -is [System.Security.Cryptography.CryptographicException] -or $_.Exception.InnerException -is [System.Security.Cryptography.CryptographicException]) { [Console]::Error.Write('FSLM_DPAPI_KIND_CRYPTOGRAPHIC') }",
  "else { [Console]::Error.Write('FSLM_DPAPI_KIND_UNKNOWN') }",
].join(' ');

/** Diagnóstico fechado: nenhum conteúdo da exceção, entrada ou script vai para stderr. */
function checkedStep(statement: string, stage: string): string {
  return `try { ${statement} } catch { [Console]::Error.Write('FSLM_DPAPI_FAIL_${stage} '); ${FAILURE_KIND_SCRIPT}; exit 1 }`;
}

// PowerShell 7 → Node → Windows PowerShell 5.1 pode herdar PSModulePath com módulos Core.
// Import explícito do módulo nativo do executável escolhido: não depende da busca herdada.
const IMPORT_SECURITY_MODULE = checkedStep(
  "Import-Module -Name ($PSHOME + '\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop",
  'MODULE',
);

/** Gravação. stdin = base64(UTF-8 do JSON). Saída = texto cifrado pelo DPAPI do usuário atual (hex). */
const PROTECT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  IMPORT_SECURITY_MODULE,
  checkedStep('$inputText = ($input -join "").Trim()', 'READ'),
  "if ($inputText.Length -eq 0) { [Console]::Error.Write('FSLM_DPAPI_FAIL_EMPTY'); exit 1 }",
  checkedStep('$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($inputText))', 'DECODE'),
  checkedStep('$secure = ConvertTo-SecureString -String $json -AsPlainText -Force', 'SECURE'),
  checkedStep('[Console]::Out.Write((ConvertFrom-SecureString -SecureString $secure))', 'PROTECT'),
].join('\n');

/**
 * Leitura. stdin = texto cifrado. Saída = base64(UTF-8 do JSON), para não depender da codepage.
 * O BSTR com o texto claro é zerado no finally; a cópia gerenciada da string não pode ser zerada.
 */
const UNPROTECT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  IMPORT_SECURITY_MODULE,
  checkedStep('$inputText = ($input -join "").Trim()', 'READ'),
  "if ($inputText.Length -eq 0) { [Console]::Error.Write('FSLM_DPAPI_FAIL_EMPTY'); exit 1 }",
  checkedStep('$secure = ConvertTo-SecureString -String $inputText', 'UNPROTECT'),
  checkedStep('$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)', 'BSTR'),
  checkedStep('try { $json = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr); [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }', 'ENCODE'),
].join('\n');

function powershellArgs(script: string): string[] {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return ['-NoProfile', '-NonInteractive', '-InputFormat', 'Text', '-EncodedCommand', encoded];
}

/**
 * Windows: DPAPI via PowerShell (ConvertTo/ConvertFrom-SecureString). O texto cifrado fica em
 * <dataDir>/secrets/<id>.dpapi. Implementado e testado só com runner simulado (sem Windows real).
 *
 * Permissões: no Windows o modo POSIX (0700/0600) é ignorado. A proteção real é o DPAPI, que só
 * decifra para o usuário que gravou. O diretório fica dentro de %LOCALAPPDATA% do perfil, que já é
 * privado ao usuário por padrão; nenhuma ACL extra é aplicada.
 *
 * Risco conhecido: com Constrained Language Mode (WDAC/AppLocker), as chamadas .NET do script são
 * bloqueadas. Nesse caso o cofre DPAPI fica indisponível e o app usa FSLM_SECRET_KEY.
 */
export function createDpapiStore(
  run: CommandRunner,
  dataDir: string,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined> = process.env,
): SecretStore {
  const dir = join(dataDir, DPAPI_DIR_NAME);
  const fileFor = (ref: string) => join(dir, `${parseSecretRef(ref).id}.dpapi`);

  return {
    backend: 'windows-dpapi',

    async isAvailable(): Promise<Availability> {
      if (platform !== 'win32') return { available: false, reason: 'DPAPI só existe no Windows.' };
      try {
        const result = await run(powershellProgram(env), ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']);
        return result.code === 0
          ? { available: true }
          : { available: false, reason: 'O PowerShell não respondeu para o DPAPI.' };
      } catch {
        return { available: false, reason: 'O PowerShell não está disponível para o DPAPI.' };
      }
    },

    async get(ref) {
      const file = fileFor(ref);
      if (!existsSync(file)) return null;
      const encrypted = readFileSync(file, 'utf8').trim();
      const result = await run(powershellProgram(env), powershellArgs(UNPROTECT_SCRIPT), {
        input: encrypted,
        timeoutMs: DPAPI_TIMEOUT_MS,
      });
      const output = result.stdout.trim();
      if (result.code !== 0 || !BASE64_PATTERN.test(output)) {
        throw new SecretStoreError('Falha ao decifrar o segredo com DPAPI.');
      }
      return deserializeSecret(Buffer.from(output, 'base64').toString('utf8'));
    },

    async set(ref, value) {
      const result = await run(powershellProgram(env), powershellArgs(PROTECT_SCRIPT), {
        input: Buffer.from(serializeSecret(value), 'utf8').toString('base64'),
        timeoutMs: DPAPI_TIMEOUT_MS,
      });
      const cipher = result.stdout.trim();
      // Só grava se a saída for texto hexadecimal (cifrado). Qualquer outra saída é recusada.
      if (result.code !== 0 || !HEX_PATTERN.test(cipher)) {
        throw new SecretStoreError('Falha ao cifrar o segredo com DPAPI.');
      }
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(fileFor(ref), cipher, { mode: 0o600 });
    },

    async delete(ref) {
      rmSync(fileFor(ref), { force: true });
    },
  };
}
