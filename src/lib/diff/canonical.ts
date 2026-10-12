import { createHash } from 'node:crypto';
import { volatileKeysFor } from './volatile';

/** Ordena chaves de objetos em todos os níveis. A ordem dos arrays é preservada. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortDeep(source[key]);
    return out;
  }
  return value;
}

/** JSON canônico: mesma estrutura com outra ordem de propriedades gera o mesmo texto. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value)) ?? 'null';
}

/** Remove metadados voláteis do módulo em todos os níveis. Não altera a entrada. */
export function stripVolatile(value: unknown, moduleKey: string): unknown {
  const volatile = volatileKeysFor(moduleKey);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        if (!volatile.has(key)) out[key] = walk(child);
      }
      return out;
    }
    return node;
  };
  return walk(value);
}

/** Hash SHA-256 (hex) do conteúdo normalizado, sem voláteis e com chaves ordenadas. */
export function contentHashOf(normalized: unknown, moduleKey: string): string {
  return createHash('sha256').update(canonicalJson(stripVolatile(normalized, moduleKey))).digest('hex');
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
