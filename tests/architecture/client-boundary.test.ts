/**
 * Fronteira cliente/servidor (C1, M2 de docs/AUDITORIA-OPUS.md).
 *
 * Teste estático: nenhum arquivo com 'use client' pode alcançar, por import estático, dinâmico ou
 * re-export, código de servidor: módulos node:*, better-sqlite3, server-only, src/lib/db|auth|secrets|sync,
 * src/lib/security/dns-guard.ts e src/lib/freshservice/http.ts. Imports só de tipo (import type e
 * especificadores type-only) são apagados na compilação e não entram no grafo: são ignorados.
 *
 * Imports com specifier não resolvível (relativo, '@/' ou import() não literal) também falham,
 * para que o teste não tenha ponto cego. Pacotes externos (react, next, lucide-react...) não são
 * percorridos: só o grafo interno de src/ é analisado.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = resolve(fileURLToPath(new URL('../../src', import.meta.url)));

/** Pacotes proibidos no grafo cliente (além de node:* e dos builtins sem prefixo). */
const FORBIDDEN_PACKAGES = new Set(['better-sqlite3', 'server-only']);
/** Caminhos relativos a src/ que são de servidor: qualquer arquivo neles é violação. */
const FORBIDDEN_PREFIXES = ['lib/db/', 'lib/auth/', 'lib/secrets/', 'lib/sync/'];
const FORBIDDEN_FILES = new Set(['lib/security/dns-guard.ts', 'lib/freshservice/http.ts']);

/**
 * Arquivos de servidor que devem declarar `import 'server-only'` (guarda contra remoção do marcador).
 * Exceções: auth/errors.ts e sync/types.ts não têm efeito de servidor (só classes e tipos).
 * db/bootstrap.ts, db/migrate.ts, db/integrity.ts, db/errors.ts, db/schema.ts e config/* NÃO podem
 * ter o marcador: scripts/start-dev.mjs (via tsx) e drizzle-kit os carregam fora do Next.
 */
const SERVER_ONLY_REQUIRED = [
  'lib/freshservice/http.ts',
  'lib/security/dns-guard.ts',
  'lib/security/url.ts',
  'lib/security/signing.ts',
  'lib/secrets/vault.ts',
  'lib/db/client.ts',
];
const SERVER_ONLY_EXEMPT = new Set(['lib/auth/errors.ts', 'lib/sync/types.ts']);

type Resolved =
  | { kind: 'file'; file: string }
  | { kind: 'server-package'; name: string }
  | { kind: 'external' }
  | { kind: 'unresolved' };

interface Violation {
  chain: string[];
  reason: string;
}

const toRel = (absolute: string): string => relative(SRC, absolute).split(sep).join('/');

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function listSource(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listSource(full);
    return /\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [full] : [];
  });
}

function parse(file: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
}

/** Diretiva 'use client' no prólogo do arquivo (comentários antes dela são aceitos pelo parser). */
function isUseClient(sf: ts.SourceFile): boolean {
  for (const statement of sf.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === 'use client') return true;
  }
  return false;
}

function isErasedImport(clause: ts.ImportClause | undefined): boolean {
  if (!clause) return false; // import 'x': efeito colateral, sempre executa
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings)) return false;
  const elements = clause.namedBindings.elements;
  return elements.length > 0 && elements.every((element) => element.isTypeOnly);
}

function isErasedExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  if (!clause || !ts.isNamedExports(clause)) return false;
  return clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly);
}

const specifierText = (expression: ts.Expression): string =>
  ts.isStringLiteralLike(expression) ? expression.text : '<especificador não literal>';

/** Specifiers que entram no grafo de execução (exclui imports apagados na compilação). */
function runtimeSpecifiers(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && !isErasedImport(node.importClause)) {
      out.push(specifierText(node.moduleSpecifier));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !isErasedExport(node)) {
      out.push(specifierText(node.moduleSpecifier));
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = node.arguments;
      out.push(arg && ts.isStringLiteralLike(arg) ? arg.text : '<import() não literal>');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function resolveSpecifier(spec: string, fromFile: string): Resolved {
  if (spec.startsWith('node:') || builtinModules.includes(spec) || FORBIDDEN_PACKAGES.has(spec)) {
    return { kind: 'server-package', name: spec };
  }
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return { kind: 'external' };
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : resolve(dirname(fromFile), spec);
  const stem = base.replace(/\.js$/, '');
  const candidates = [base, `${stem}.ts`, `${stem}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  const file = candidates.find(isFile);
  return file ? { kind: 'file', file } : { kind: 'unresolved' };
}

function hasServerOnlyImport(sf: ts.SourceFile): boolean {
  return sf.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      !statement.importClause &&
      specifierText(statement.moduleSpecifier) === 'server-only',
  );
}

function findViolations(clientFiles: string[]): Violation[] {
  const violations: Violation[] = [];
  const reported = new Set<string>();
  const specCache = new Map<string, string[]>();
  const specsOf = (file: string): string[] => {
    let specs = specCache.get(file);
    if (!specs) {
      specs = runtimeSpecifiers(parse(file));
      specCache.set(file, specs);
    }
    return specs;
  };

  for (const start of clientFiles) {
    const parentOf = new Map<string, string | null>([[start, null]]);
    const queue = [start];
    const chainOf = (file: string): string[] => {
      const chain: string[] = [];
      for (let cur: string | null | undefined = file; cur; cur = parentOf.get(cur)) chain.unshift(toRel(cur));
      return chain;
    };

    while (queue.length > 0) {
      const file = queue.shift() as string;
      const rel = toRel(file);
      const reasons: string[] = [];
      if (FORBIDDEN_FILES.has(rel) || FORBIDDEN_PREFIXES.some((prefix) => rel.startsWith(prefix))) {
        reasons.push(`arquivo de servidor alcançado: ${rel}`);
      }
      // Continua o percurso mesmo após um motivo: o relatório mostra também a causa mais profunda.
      for (const spec of specsOf(file)) {
        const resolved = resolveSpecifier(spec, file);
        if (resolved.kind === 'server-package') {
          reasons.push(`importa '${resolved.name}' em ${rel}`);
        } else if (resolved.kind === 'unresolved') {
          reasons.push(`import não resolvido '${spec}' em ${rel}`);
        } else if (resolved.kind === 'file' && !parentOf.has(resolved.file)) {
          parentOf.set(resolved.file, file);
          queue.push(resolved.file);
        }
      }
      for (const reason of reasons) {
        const key = `${rel}|${reason}`;
        if (!reported.has(key)) {
          reported.add(key);
          violations.push({ chain: chainOf(file), reason });
        }
      }
    }
  }
  return violations;
}

const formatViolation = (v: Violation): string => `${v.chain.join(' → ')}: ${v.reason}`;

const allSource = listSource(SRC).map((file) => ({ file, sf: parse(file) }));
const clientFiles = allSource.filter(({ sf }) => isUseClient(sf)).map(({ file }) => file);

describe('fronteira cliente/servidor (C1, M2)', () => {
  it('inspeciona os componentes use client (inclui o caminho de /configuracoes)', () => {
    expect(clientFiles.map(toRel)).toContain('components/config/preferences-form.tsx');
    expect(clientFiles.length).toBeGreaterThanOrEqual(10);
  });

  it('nenhum arquivo use client alcança código de servidor', () => {
    expect(findViolations(clientFiles).map(formatViolation)).toEqual([]);
  });

  it("arquivos de servidor declaram import 'server-only' (guarda contra remoção do marcador)", () => {
    const serverFiles = [
      ...SERVER_ONLY_REQUIRED,
      ...listSource(join(SRC, 'lib/auth')).map(toRel),
      ...listSource(join(SRC, 'lib/sync')).map(toRel),
    ].filter((rel) => !SERVER_ONLY_EXEMPT.has(rel));
    const unique = [...new Set(serverFiles)];
    const missing = unique.filter((rel) => !hasServerOnlyImport(parse(join(SRC, rel))));
    expect(missing).toEqual([]);
  });

  it("módulos carregados fora do Next (start-dev.mjs via tsx, next.config.ts, drizzle-kit) não usam 'server-only'", () => {
    const outsideNext = [
      'lib/db/bootstrap.ts',
      'lib/db/migrate.ts',
      'lib/db/integrity.ts',
      'lib/db/errors.ts',
      'lib/db/schema.ts',
      'lib/config/env.ts',
      'lib/config/paths.ts',
      'lib/security/origin.ts',
      'lib/secrets/probe.ts',
    ];
    const marked = outsideNext.filter((rel) => hasServerOnlyImport(parse(join(SRC, rel))));
    expect(marked).toEqual([]);
  });
});
