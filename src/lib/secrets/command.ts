import { spawn } from 'node:child_process';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  /** Texto enviado pela entrada padrão (segredos entram aqui, nunca nos argumentos). */
  input?: string;
  timeoutMs?: number;
}

/** Executa um programa sem shell. Erro ENOENT indica que o programa não está instalado. */
export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

const MAX_OUTPUT_CHARS = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

export class CommandTimeoutError extends Error {
  readonly code = 'ETIMEDOUT' as const;

  constructor() {
    super('O comando do cofre excedeu o tempo limite.');
    this.name = 'CommandTimeoutError';
  }
}

export const defaultCommandRunner: CommandRunner = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (error: Error | null, result?: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result as CommandResult);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new CommandTimeoutError());
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk;
    });
    // EPIPE acontece se o programa encerrar antes de ler a entrada; o código de saída já informa a falha.
    child.stdin.on('error', () => undefined);
    child.on('error', (error) => finish(error));
    child.on('close', (code) => finish(null, { code: code ?? 1, stdout, stderr }));
    child.stdin.end(options.input ?? '');
  });

export function isCommandMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}
