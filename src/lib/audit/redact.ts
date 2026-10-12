export const REDACTED = '[REDACTED]';

const MAX_DEPTH = 8;

/** Chaves cujo valor nunca é gravado: Authorization, token, api_key, password, secret, cookie. */
const SECRET_KEY_PATTERN =
  /authorization|cookie|token|api[-_]?key|apikey|password|passwd|secret|credential/i;

/** Mesmos nomes de SECRET_KEY_PATTERN, em forma de fonte de regex (para a chave entre aspas). */
const SECRET_KEY_NAMES =
  'api[-_]?key|apikey|access[-_]?token|token|secret|password|passwd|authorization|cookie|credential';

/**
 * Chave entre aspas em JSON ou texto: "api_key":"x", 'token': 'y', "token":123. Mantém a chave e as
 * aspas e troca só o valor. Valor sem aspas: troca até o separador.
 */
const QUOTED_SECRET_RE = new RegExp(
  `(["'])([\\w-]*(?:${SECRET_KEY_NAMES})[\\w-]*)\\1(\\s*[:=]\\s*)(?:(["'])(?:(?!\\4)[^\\r\\n])*\\4|[^\\s,;&}\\]"']+)`,
  'gi',
);

/** Padrões de segredo em texto livre (mensagens, URLs, cabeçalhos colados). */
const SECRET_TEXT_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`],
  [/([?&](?:api[-_]?key|access_token|token|secret|password)=)[^&\s"']+/gi, `$1${REDACTED}`],
  [
    /\b((?:api[-_]?key|access_token|token|secret|password|passwd|authorization|cookie)\s*[:=]\s*)(?:(?:Bearer|Basic)\s+)?[^\s,;"'&]+/gi,
    `$1${REDACTED}`,
  ],
];

export function redactString(input: string): string {
  const quotedMasked = input.replace(
    QUOTED_SECRET_RE,
    (_match: string, quote: string, key: string, sep: string, valueQuote: string | undefined) => {
      const q = valueQuote ?? '';
      return `${quote}${key}${quote}${sep}${q}${REDACTED}${q}`;
    },
  );
  return SECRET_TEXT_PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    quotedMasked,
  );
}

/** Copia um valor arbitrário trocando segredos por REDACTED. Não altera o original. */
export function redactValue(
  value: unknown,
  depth = 0,
  ancestors: WeakSet<object> = new WeakSet(),
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return '[omitido]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (depth >= MAX_DEPTH) return '[truncado]';
  if (ancestors.has(value)) return '[circular]';

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, depth + 1, ancestors));
    }
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const hasValue = item !== null && item !== undefined;
      output[key] =
        hasValue && SECRET_KEY_PATTERN.test(key)
          ? REDACTED
          : redactValue(item, depth + 1, ancestors);
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}
