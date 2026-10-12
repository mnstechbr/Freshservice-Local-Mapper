import { type CommandRunner, CommandTimeoutError } from '../../src/lib/secrets/command';
import { SecretStoreError } from '../../src/lib/secrets/types';

/** Classificação fechada: mensagens de erro podem conter valores, caminhos ou saída do processo. */
export function classifySmokeFailure(error: unknown): string {
  if (error instanceof CommandTimeoutError) return 'timeout';
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  if (code === 'ETIMEDOUT') return 'timeout';
  if (code === 'ENOENT') return 'executable_missing';
  if (code === 'EACCES' || code === 'EPERM') return 'access_denied';
  if (code === 'ERR_ASSERTION') return 'assertion_failed';
  if (error instanceof SecretStoreError) return 'dpapi_response_rejected';
  return 'unexpected_failure';
}

/** Reconhece só marcadores literais emitidos pelo script DPAPI; nenhuma captura é devolvida. */
export function classifyDpapiStderr(stderr: string): string {
  if (!stderr.trim()) return 'none';
  for (const stage of ['EMPTY', 'READ', 'DECODE', 'SECURE', 'PROTECT', 'UNPROTECT', 'BSTR', 'ENCODE']) {
    if (stderr.includes(`FSLM_DPAPI_FAIL_${stage}`)) return `dpapi_${stage.toLowerCase()}_failed`;
  }
  if (/ParserError|UnexpectedToken|MissingEndParenthesis/i.test(stderr)) return 'powershell_parser_error';
  return 'unclassified_stderr';
}

/** Instrumenta sem imprimir comando, argumentos, input, stdout, stderr ou mensagens do runner. */
export function observeSmokeRunner(
  run: CommandRunner,
  report: (message: string) => void,
): CommandRunner {
  let call = 0;
  return async (command, args, options) => {
    const id = ++call;
    const started = Date.now();
    report(`process=${id} start timeoutMs=${options?.timeoutMs ?? 10_000}`);
    try {
      const result = await run(command, args, options);
      report(`process=${id} end elapsedMs=${Date.now() - started} exitCode=${result.code} stderrKind=${classifyDpapiStderr(result.stderr)}`);
      return result;
    } catch (error) {
      report(`process=${id} failed elapsedMs=${Date.now() - started} kind=${classifySmokeFailure(error)}`);
      throw error;
    }
  };
}
