#!/usr/bin/env node
/**
 * Audita bytes do índice Git e todas as árvores do histórico alcançável por refs.
 * Não lê o banco do usuário, não altera Git e nunca imprime trechos ou valores encontrados.
 * Uso: node scripts/check-publication.mjs [--reviewed-image=caminho:sha256]
 * Uma aprovação de imagem vale só para aquele caminho e aqueles bytes, após revisão humana.
 * Regras heurísticas não provam ausência de dados corporativos: revise também texto e imagens.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 64 * 1024 * 1024;
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0');
const SYNTHETIC_CREDENTIALS = new Set([
  'FSK-SYNTHETIC-KEY-0001', 'FSK-SYNTHETIC-KEY-0002', 'CLIENT-SECRET-SYNTHETIC-9999',
  'ACCESS-SYNTHETIC-TOKEN-AAA', 'ACCESS-SYNTHETIC-TOKEN-CCC', 'REFRESH-SYNTHETIC-TOKEN-BBB',
  'csec-synthetic-value', 'rt-synthetic', 'chave-sintetica-0000', 'fake-key-123',
  'segredo-sintetico-novo-123', 'token-sintetico', 'refresh-sintetico', 'synthetic',
  'sim-secret-ficticio-fslm', 'sim-secret-ficticio-restrito', 'SenhaFicticia-2026',
  'SenhaFicticia-MFA', 'chave-ficticia-simulador-0001', 'segredo-ficticio-desconhecido',
  'SenhaNova-1', 'nao-deve-aparecer', 'CHAVE-XYZ-987', 'CHAVE-HEADER-2', 'senha-CAMPO-4',
  'TOKEN-PROFUNDO-6', '[REDACTED]', 'nao-existe',
  // Sentinela base64 declarada explicitamente em tests/auth/secrets/probe.test.ts.
  'c2VudGluZWxhLXNlZ3JlZG8tbXVpdG8tbG9uZ2EtMTIzNDU2Nzg5MDEyMzQ1Njc4OTA=',
]);
const SYNTHETIC_HOSTS = new Set([
  'a', 'b', 'h', 'acme', 'acme-fslm', 'acme-test', 'beta-fslm', 'cliente', 'demo-sintetico',
  'empresa', 'evil-acme-fslm', 'fslm-org', 'org', 'outra', 'outra-fslm', 'outra-instancia',
  'outro-cliente', 'relacao-a', 'relacao-b', 'seu-dominio', 'sintetica', 'sintetica-a',
  'sintetica-b', 'sua-org', 'suaempresa', 'synthetic', 'xn--acm-fslm', 'açaí',
]);
const PUBLIC_HOSTS = new Set(['api.freshservice.com', 'support.freshservice.com', 'support.freshworks.com', 'developers.freshworks.com']);
const PRIVATE_PATH = /(?:^|\/)(?:\.claude|\.codex|\.aws|\.ssh|\.vscode|\.idea|data|backups?|secrets?|exports?|logs|test-results|playwright-report|blob-report|\.e2e-data|\.ci-data)(?:\/|$)|(?:^|\/)\.env(?:$|\.)|\.(?:db(?:-wal|-shm|-journal)?|sqlite3?(?:-wal|-shm)?|bak|backup|log|pem|key|p12|pfx|dpapi|csv|xlsx|zip|gz|tgz|7z|rar)$/i;
const PRIVATE_NAMES = /(?:^|\/)(?:Prompt_[^/]*|Painel_Freshservice_Design[^/]*|PROGRESSO\.md|AUDITORIA-OPUS\.md|SKILLS-MAP\.md|vault\.enc\.json|bootstrap-status\.json|dev-server\.lock|[^/]*credentials[^/]*\.json|[^/]*token[^/]*\.json|settings\.local\.json)$/i;
const STRONG_SECRETS = [
  ['private-key', /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g],
  ['provider-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[A-Z0-9]{16})\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g],
];

const isFixture = (path) => path.startsWith('tests/') || path === 'src/lib/simulator/fixtures.ts';
const isSyntheticLiteral = (path, value) => isFixture(path) && (SYNTHETIC_CREDENTIALS.has(value) || /^\$\{[A-Z][A-Z0-9_]*\}$/.test(value));
const lineAt = (text, offset) => text.slice(0, offset).split('\n').length;

// Exemplo de geração aleatória revisado. A comparação exige caminho e linha inteira exatos;
// não dispensa outras atribuições no documento, comandos $(...) nem geradores constantes.
const REVIEWED_RANDOM_KEY_LINE = `export ${['FSLM', 'SECRET', 'KEY'].join('_')}="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))")"`;
function isReviewedRandomKeyLine(path, text, offset) {
  if (path !== 'docs/DEMONSTRACAO-SIMULADOR.md') return false;
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  const end = text.indexOf('\n', offset);
  return text.slice(start, end === -1 ? text.length : end) === REVIEWED_RANDOM_KEY_LINE;
}


/** Retorna só categorias e linhas. Valores sensíveis nunca saem desta função. */
export function inspectBlob(path, bytes, reviewedImages = new Map()) {
  const findings = [];
  const add = (rule, line) => findings.push({ rule, ...(line ? { line } : {}) });
  // Diretórios do código homônimos a artefatos privados não dispensam a análise dos bytes.
  const sourceDirectory = /^(?:src\/lib\/secrets|src\/app\/logs|tests\/auth\/secrets)\/[^/]+\.(?:tsx?|mjs)$/.test(path);
  if ((PRIVATE_PATH.test(path) && path !== '.env.example' && !sourceDirectory) || PRIVATE_NAMES.test(path)) add('private-artifact');
  if (bytes.includes(SQLITE_MAGIC)) add('sqlite-content');
  if (bytes.length > MAX_BYTES) { add('blob-too-large'); return findings; }
  const image = /\.(?:png|jpe?g|gif|webp|ico|svg)$/i.test(path)
    || bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (image) {
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (reviewedImages.get(path) !== hash) add('image-needs-manual-review');
  } else if (bytes.includes(0) && !bytes.includes(SQLITE_MAGIC)) add('opaque-binary-needs-review');
  const text = bytes.toString('utf8');
  for (const [rule, pattern] of STRONG_SECRETS) {
    for (const match of text.matchAll(pattern)) add(rule, lineAt(text, match.index));
  }
  const credentials = /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password|FSLM_SECRET_KEY)\s*['"]?\s*[:=]\s*(['"])([^'"\r\n]{8,})\1/gi;
  for (const match of text.matchAll(credentials)) {
    if (!isSyntheticLiteral(path, match[2]) && !isReviewedRandomKeyLine(path, text, match.index)) add('credential-literal', lineAt(text, match.index));
  }
  // Valores reais copiados para modelos .env também são detectados sem aspas.
  const envCredentials = /^\s*(?:export\s+)?(?:[A-Z0-9_]*(?:API_KEY|CLIENT_SECRET|ACCESS_TOKEN|REFRESH_TOKEN|PASSWORD|PRIVATE_KEY)|FSLM_SECRET_KEY)\s*=\s*([^\s'"#]{8,})\s*(?:#.*)?$/gm;
  for (const match of text.matchAll(envCredentials)) {
    if (!isSyntheticLiteral(path, match[1]) && !/^\$\{[A-Z0-9_]+\}$/.test(match[1])) add('credential-env-value', lineAt(text, match.index));
  }
  const personalPaths = /\/(?:home|Users)\/([^/\s<>"'`$]+)|\b[A-Z]:\\{1,2}Users\\{1,2}([^\\\r\n<>"'`$]+)/gi;
  for (const match of text.matchAll(personalPaths)) {
    const name = match[1] ?? match[2];
    const explicitFixture = (path === 'tests/config/paths.test.ts' && ['ana', 'Ana', 'João Silva'].includes(name))
      || (path === 'tests/bootstrap/bootstrap-core.test.ts' && name === 'u');
    if (!explicitFixture) add('personal-path', lineAt(text, match.index));
  }
  const emails = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
  for (const match of text.matchAll(emails)) {
    const domain = match[1].toLowerCase();
    if (!/(?:^|\.)(?:example\.(?:com|net|org)|[^.]+\.invalid)$/.test(domain)
        && !(isFixture(path) && ['exemplo.com', 'exemplo.invalido'].includes(domain))
        // Teste de URL com usuário na autoridade, não endereço de e-mail real.
        && !(isFixture(path) && domain === 'acme.freshservice.com')) {
      add('email-needs-review', lineAt(text, match.index));
    }
  }
  const hosts = /(?<![\w.-])([\p{L}\w-]+)\.(freshservice|freshworks|myfreshworks)\.com\b/giu;
  for (const match of text.replace(/%2f/gi, '/').matchAll(hosts)) {
    const host = match[0].toLowerCase();
    if (!PUBLIC_HOSTS.has(host) && !SYNTHETIC_HOSTS.has(match[1].toLowerCase())) add('customer-host-needs-review', lineAt(text, match.index));
  }
  return findings;
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: null, maxBuffer: MAX_BYTES, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('git-read-failed');
  return result.stdout;
}

/** Índice real, inclusive arquivos ignorados adicionados com -f; histórico por todas as refs locais. */
export function scanRepository(cwd, reviewedImages = new Map()) {
  const findings = [];
  const entries = new Map();
  const addEntry = (path, oid, source, mode) => {
    const key = `${path}\0${oid}`;
    const old = entries.get(key);
    if (old) old.sources.add(source);
    else entries.set(key, { path, oid, mode, sources: new Set([source]) });
  };
  const staged = git(cwd, ['ls-files', '--cached', '--stage', '-z']).toString('utf8').split('\0').filter(Boolean);
  if (!staged.length) findings.push({ path: '(índice)', rule: 'empty-index', sources: ['index'] });
  for (const record of staged) {
    const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(record);
    if (!match) throw new Error('invalid-index-record');
    if (match[3] !== '0') findings.push({ path: match[4], rule: 'unmerged-index', sources: ['index'] });
    addEntry(match[4], match[2], 'index', match[1]);
  }
  const commits = git(cwd, ['rev-list', '--all']).toString('utf8').trim().split('\n').filter(Boolean);
  for (const commit of commits) {
    const tree = git(cwd, ['ls-tree', '-r', '-z', commit]).toString('utf8').split('\0').filter(Boolean);
    for (const record of tree) {
      const match = /^(\d+) (blob|commit) ([a-f0-9]+)\t([\s\S]+)$/.exec(record);
      if (!match) throw new Error('invalid-history-record');
      addEntry(match[4], match[3], 'history', match[1]);
    }
  }
  const cache = new Map();
  for (const entry of entries.values()) {
    if (entry.mode === '160000') {
      findings.push({ path: entry.path, rule: 'submodule-needs-separate-audit', sources: [...entry.sources] });
      continue;
    }
    let bytes = cache.get(entry.oid);
    if (!bytes) { bytes = git(cwd, ['cat-file', 'blob', entry.oid]); cache.set(entry.oid, bytes); }
    for (const finding of inspectBlob(entry.path, bytes, reviewedImages)) findings.push({ path: entry.path, ...finding, sources: [...entry.sources] });
  }
  return { indexedFiles: staged.length, historicalCommits: commits.length, blobs: cache.size, findings };
}

export function main(args = process.argv.slice(2), cwd = process.cwd()) {
  try {
    const reviewed = new Map();
    for (const arg of args) {
      const match = /^--reviewed-image=(.+):([a-f0-9]{64})$/.exec(arg);
      if (!match || reviewed.has(match[1])) throw new Error('invalid-arguments');
      reviewed.set(match[1], match[2]);
    }
    const result = scanRepository(cwd, reviewed);
    console.log(`Publicação: ${result.indexedFiles} arquivos no índice, ${result.historicalCommits} commits, ${result.blobs} blobs.`);
    for (const finding of result.findings) {
      // JSON.stringify impede caracteres de controle de arquivos de alterarem o terminal.
      console.error(`${finding.rule}: ${JSON.stringify(finding.path)}${finding.line ? `:${finding.line}` : ''} [${finding.sources.join(',')}]`);
    }
    if (result.findings.length) console.error(`Bloqueado: ${result.findings.length} achados para corrigir ou revisar. Nenhum conteúdo sensível foi impresso.`);
    else console.log('OK: nenhum achado nas regras automáticas; mantém-se a revisão humana do conteúdo.');
    return result.findings.length ? 1 : 0;
  } catch {
    console.error('Publicação bloqueada: não foi possível concluir a auditoria Git, ou os argumentos são inválidos.');
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
