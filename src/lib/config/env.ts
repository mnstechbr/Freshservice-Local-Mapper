import { z } from 'zod';

/** Origem das variáveis (process.env ou um objeto de teste). */
export type EnvSource = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Trata variável definida como string vazia (ex.: "PORT=") como ausente. */
const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const booleanFlag = z
  .preprocess(emptyToUndefined, z.enum(['0', '1', 'true', 'false']).optional())
  .transform((value) => value === '1' || value === 'true');

export const envSchema = z.object({
  /** Validado em paths.ts (caminho absoluto e fora de áreas proibidas). */
  FSLM_DATA_DIR: z.preprocess(emptyToUndefined, z.string().optional()),
  PORT: z
    .preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).optional())
    .transform((value) => value ?? 3000),
  /** 1 ou true: não abre o navegador automaticamente em pnpm dev / npm run dev. */
  FSLM_NO_BROWSER: booleanFlag,
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(source: EnvSource = process.env): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Variáveis de ambiente inválidas: ${issues}`);
  }
  return result.data;
}
