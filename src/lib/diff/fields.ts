import { canonicalJson, isPlainObject, stripVolatile } from './canonical';
import { alwaysReturnedFor } from './volatile';
import type { FieldDiff, FieldTag } from './types';

/*
 * Diff estrutural de um registro normalizado (sem banco).
 * Regras:
 * - Objetos: chaves em ambos os lados são comparadas recursivamente. Chave ausente em um
 *   lado só gera added/removed se estiver na lista de "sempre retornadas" do módulo; caso
 *   contrário é ignorada (pode ser omissão da API). Ausência nunca vira null.
 * - Arrays de primitivos (ex.: opções): comparados como conjunto. Ordem não gera mudança.
 * - Arrays de objetos: pareados por identidade (id, field_id, key, name, nessa ordem, quando
 *   único em ambos os lados). Mesmo id com nome diferente vira field_renamed.
 *   Sem identidade comum, pareia por índice.
 */

// 'value' cobre opções no formato real da API: choices: [{ value: 'IT' }].
const IDENTITY_KEYS = ['id', 'field_id', 'key', 'name', 'value'] as const;
const OPTION_KEYS = new Set(['options', 'choices', 'values']);
// Listas de campos de formulário: adição/remoção sem identidade comum vira field_added/field_removed.
const FIELD_LIST_KEYS = new Set(['custom_fields', 'fields', 'form_fields']);

interface Ctx {
  always: ReadonlySet<string>;
}

function tagFor(key: string, parentPath: string): FieldTag {
  const k = key.toLowerCase();
  if (k === 'required' || k === 'is_required' || k === 'mandatory') return 'required';
  if ((k === 'name' || k === 'label') && parentPath !== '') return 'field_renamed';
  if (k.startsWith('description')) return 'description';
  if (k === 'category' || k === 'category_id' || k === 'category_name') return 'category';
  if (k.includes('visib')) return 'visibility';
  if (k.includes('relation') || parentPath.includes('relation')) return 'relation';
  return 'value';
}

function isPrimitive(value: unknown): boolean {
  return value === null || typeof value !== 'object';
}

function sortedUnion(a: Iterable<string>, b: Iterable<string>): string[] {
  return [...new Set([...a, ...b])].sort();
}

/** Chaves de identidade válidas (únicas e preenchidas) para os dois arrays, na ordem de preferência. */
function commonIdentityKey(b: unknown[], a: unknown[]): string | null {
  for (const k of IDENTITY_KEYS) {
    const valid = [b, a].every((items) => {
      const seen = new Set<string>();
      return items.every((item) => {
        if (!isPlainObject(item)) return false;
        const v = item[k];
        if (typeof v !== 'string' && typeof v !== 'number') return false;
        const s = String(v);
        if (seen.has(s)) return false;
        seen.add(s);
        return true;
      });
    });
    if (valid) return k;
  }
  return null;
}

function walkArray(b: unknown[], a: unknown[], path: string, key: string, ctx: Ctx, out: FieldDiff[]) {
  if (b.every(isPrimitive) && a.every(isPrimitive)) {
    const sb = new Map(b.map((v) => [canonicalJson(v), v]));
    const sa = new Map(a.map((v) => [canonicalJson(v), v]));
    const isOption = OPTION_KEYS.has(key);
    for (const id of sortedUnion(sa.keys(), [])) {
      if (!sb.has(id)) {
        out.push({ path: `${path}[=${id}]`, kind: 'added', tag: isOption ? 'option_added' : tagFor(key, path), after: sa.get(id) });
      }
    }
    for (const id of sortedUnion(sb.keys(), [])) {
      if (!sa.has(id)) {
        out.push({ path: `${path}[=${id}]`, kind: 'removed', tag: isOption ? 'option_removed' : tagFor(key, path), before: sb.get(id) });
      }
    }
    return;
  }

  const idKey = commonIdentityKey(b, a);
  if (idKey !== null) {
    const isOption = OPTION_KEYS.has(key);
    const mb = new Map(b.map((o) => [String((o as Record<string, unknown>)[idKey]), o]));
    const ma = new Map(a.map((o) => [String((o as Record<string, unknown>)[idKey]), o]));
    for (const id of sortedUnion(mb.keys(), ma.keys())) {
      const itemPath = `${path}[${idKey}=${id}]`;
      if (mb.has(id) && ma.has(id)) {
        walk(mb.get(id), ma.get(id), itemPath, key, ctx, out);
      } else if (mb.has(id)) {
        out.push({ path: itemPath, kind: 'removed', tag: isOption ? 'option_removed' : 'field_removed', before: mb.get(id) });
      } else {
        out.push({ path: itemPath, kind: 'added', tag: isOption ? 'option_added' : 'field_added', after: ma.get(id) });
      }
    }
    return;
  }

  // Sem identidade comum: pareia por índice. Em listas de campos, a adição/remoção continua sendo campo.
  const isField = FIELD_LIST_KEYS.has(key);
  const size = Math.max(b.length, a.length);
  for (let i = 0; i < size; i += 1) {
    const itemPath = `${path}[${i}]`;
    if (i < b.length && i < a.length) walk(b[i], a[i], itemPath, key, ctx, out);
    else if (i < b.length) out.push({ path: itemPath, kind: 'removed', tag: isField ? 'field_removed' : 'value', before: b[i] });
    else out.push({ path: itemPath, kind: 'added', tag: isField ? 'field_added' : 'value', after: a[i] });
  }
}

function walk(b: unknown, a: unknown, path: string, key: string, ctx: Ctx, out: FieldDiff[]): void {
  if (isPlainObject(b) && isPlainObject(a)) {
    for (const k of sortedUnion(Object.keys(b), Object.keys(a))) {
      const childPath = path ? `${path}.${k}` : k;
      const inB = Object.hasOwn(b, k);
      const inA = Object.hasOwn(a, k);
      if (inB && inA) {
        walk(b[k], a[k], childPath, k, ctx, out);
      } else if (ctx.always.has(k)) {
        out.push(
          inB
            ? { path: childPath, kind: 'removed', tag: tagFor(k, path), before: b[k] }
            : { path: childPath, kind: 'added', tag: tagFor(k, path), after: a[k] },
        );
      }
    }
    return;
  }
  if (Array.isArray(b) && Array.isArray(a)) {
    walkArray(b, a, path, key, ctx, out);
    return;
  }
  if (canonicalJson(b) !== canonicalJson(a)) {
    out.push({ path, kind: 'modified', tag: tagFor(key, path), before: b, after: a });
  }
}

function compareDiffs(x: FieldDiff, y: FieldDiff): number {
  if (x.path !== y.path) return x.path < y.path ? -1 : 1;
  if (x.kind !== y.kind) return x.kind < y.kind ? -1 : 1;
  return x.tag < y.tag ? -1 : x.tag > y.tag ? 1 : 0;
}

/** Diferenças estruturais entre dois registros normalizados. Ordenadas por caminho. */
export function diffNormalized(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  moduleKey: string,
): FieldDiff[] {
  const out: FieldDiff[] = [];
  walk(
    stripVolatile(before, moduleKey),
    stripVolatile(after, moduleKey),
    '',
    '',
    { always: alwaysReturnedFor(moduleKey) },
    out,
  );
  return out.sort(compareDiffs);
}
