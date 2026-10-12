import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Script Node independente; allowJs permite a inferência dos exports nesta configuração.
import { inspectBlob, main, scanRepository } from '../../scripts/check-publication.mjs';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });
const rules = (path: string, value: string) => inspectBlob(path, Buffer.from(value)).map((finding: { rule: string }) => finding.rule);
const keyName = ['api', 'key'].join('_');
const confidential = ['unknown', 'private', 'credential', '7890'].join('-');
function git(dir: string, args: string[]) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('fixture git failed');
}
function repository() {
  const dir = mkdtempSync(join(tmpdir(), 'fslm-publication-')); dirs.push(dir);
  git(dir, ['init', '-q']);
  return dir;
}

describe('publication: bytes e paths, sem dispensar conteúdo arbitrário dos testes', () => {
  it('detecta SQLite renomeado, inclusive em arquivo de teste', () => {
    const magic = ['SQLite format ', '3\0'].join('');
    expect(rules('innocent.txt', magic)).toContain('sqlite-content');
    expect(rules('tests/fixture.txt', magic)).toContain('sqlite-content');
  });
  it.each(['.env', 'nested/.env.production', 'backups/payload', '.aws/config', 'private.key', 'client.log', 'Prompt_Projeto.txt', '.claude/agents/a.md', 'docs/PROGRESSO.md'])('bloqueia artefato privado %s', (path) => {
    expect(rules(path, 'harmless')).toContain('private-artifact');
  });
  it('modelo .env.example continua sujeito à análise de segredo', () => {
    expect(rules('.env.example', 'PORT=3000')).toEqual([]);
    expect(rules('.env.example', `${keyName}='${confidential}'`)).toContain('credential-literal');
    expect(rules('.env.example', `${keyName.toUpperCase()}=${confidential}`)).toContain('credential-env-value');
  });
  it('valor arbitrário em teste não ganha isenção; fixture sintética conhecida sim', () => {
    expect(rules('tests/unknown.test.ts', `${keyName}='${confidential}'`)).toContain('credential-literal');
    expect(rules('tests/auth/helpers.ts', `${keyName}='FSK-SYNTHETIC-KEY-0001'`)).toEqual([]);
    expect(rules('src/unknown.ts', `${keyName}='FSK-SYNTHETIC-KEY-0001'`)).toContain('credential-literal');
  });
  it('identifica credenciais de fornecedor sem devolver o valor', () => {
    const token = ['gh', 'p_'].join('') + 'A'.repeat(36);
    const findings = inspectBlob('tests/arbitrary.txt', Buffer.from(token));
    expect(findings.map((finding: { rule: string }) => finding.rule)).toContain('provider-token');
    expect(JSON.stringify(findings)).not.toContain(token);
  });
  it('caminho de pessoa só é permitido na fixture explicitamente revisada', () => {
    const fictitious = ['/', 'home', '/ana/private'].join('');
    const realLooking = ['/', 'home', '/unknown_person/private'].join('');
    expect(rules('tests/config/paths.test.ts', fictitious)).toEqual([]);
    expect(rules('tests/other.test.ts', fictitious)).toContain('personal-path');
    expect(rules('tests/config/paths.test.ts', realLooking)).toContain('personal-path');
  });
  it('domínio e e-mail corporativo desconhecido requerem revisão', () => {
    expect(rules('tests/fixture.ts', ['private', '@organization.com'].join(''))).toContain('email-needs-review');
    expect(rules('tests/fixture.ts', ['organization', '.freshservice.com'].join(''))).toContain('customer-host-needs-review');
    expect(rules('tests/fixture.ts', 'ana@example.invalid')).toEqual([]);
  });
  it('imagem precisa de aprovação para os mesmos bytes e caminho', () => {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(inspectBlob('image.png', bytes).map((finding: { rule: string }) => finding.rule)).toContain('image-needs-manual-review');
    expect(inspectBlob('image.png', bytes, new Map([['image.png', hash]]))).toEqual([]);
    expect(inspectBlob('renamed.png', bytes, new Map([['image.png', hash]])).map((finding: { rule: string }) => finding.rule)).toContain('image-needs-manual-review');
    expect(inspectBlob('image.png', Buffer.concat([bytes, Buffer.from([1])]), new Map([['image.png', hash]])).map((finding: { rule: string }) => finding.rule)).toContain('image-needs-manual-review');
  });
});

describe('publication: índice e histórico em repositórios temporários', () => {
  it('índice vazio falha explicitamente, sem fingir auditoria bem-sucedida', () => {
    const dir = repository();
    expect(scanRepository(dir).findings).toContainEqual(expect.objectContaining({ rule: 'empty-index' }));
    vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main([], dir)).toBe(1);
  });
  it('audita os bytes staged mesmo se o working tree foi limpo depois', () => {
    const dir = repository();
    writeFileSync(join(dir, 'payload.txt'), `${keyName}='${confidential}'`);
    git(dir, ['add', 'payload.txt']); writeFileSync(join(dir, 'payload.txt'), 'clean');
    expect(scanRepository(dir).findings).toContainEqual(expect.objectContaining({ path: 'payload.txt', rule: 'credential-literal', sources: ['index'] }));
  });
  it('detecta arquivo privado já apagado do índice, no histórico', () => {
    const dir = repository();
    writeFileSync(join(dir, 'renamed.txt'), ['SQLite format ', '3\0'].join(''));
    git(dir, ['add', '.']); git(dir, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'synthetic fixture']);
    git(dir, ['rm', '-q', 'renamed.txt']);
    writeFileSync(join(dir, 'README.md'), 'clean'); git(dir, ['add', 'README.md']);
    const result = scanRepository(dir);
    expect(result.historicalCommits).toBe(1);
    expect(result.findings).toContainEqual(expect.objectContaining({ path: 'renamed.txt', rule: 'sqlite-content', sources: ['history'] }));
  });
  it('mesmo blob em outro nome histórico recebe análise de caminho', () => {
    const dir = repository();
    writeFileSync(join(dir, '.env'), 'PORT=3000'); git(dir, ['add', '.env']);
    git(dir, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'synthetic fixture']);
    git(dir, ['mv', '.env', '.env.example']);
    expect(scanRepository(dir).findings).toContainEqual(expect.objectContaining({ path: '.env', rule: 'private-artifact', sources: ['history'] }));
  });
  it('saída só informa caminho/regra, nunca os bytes encontrados', () => {
    const dir = repository(); writeFileSync(join(dir, 'payload.txt'), `${keyName}='${confidential}'`); git(dir, ['add', '.']);
    const logged: unknown[] = []; vi.spyOn(console, 'log').mockImplementation((value) => logged.push(value)); vi.spyOn(console, 'error').mockImplementation((value) => logged.push(value));
    expect(main([], dir)).toBe(1); expect(logged.join('\n')).not.toContain(confidential);
  });
});
