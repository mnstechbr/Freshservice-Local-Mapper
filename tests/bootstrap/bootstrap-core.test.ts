import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as coreModule from '../../scripts/lib/bootstrap-core.mjs';

// Módulo JS: allowJs infere tipos estreitos demais dos valores padrão. Os testes validam o comportamento.
const core = coreModule as unknown as Record<string, any>;

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PNPM_FIELD = 'pnpm@10.18.0';
const asFn = (value: unknown) => value as never;

let dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fslm-boot-'));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  dirs = [];
});

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('versão do Node', () => {
  it.each([
    ['21.9.0', false],
    ['22.11.0', false],
    ['22.12.0', true],
    ['v22.12.0', true],
    ['24.18.0', true],
  ])('Node %s suportado = %s', (version, ok) => {
    expect(core.evaluateNode(version, 'linux').node.ok).toBe(ok);
  });

  it('erro traz instruções por SO e link oficial', () => {
    const linux = core.evaluateNode('21.9.0', 'linux').step;
    expect(linux.status).toBe('error');
    expect(linux.hint).toContain('sudo dnf install nodejs');
    expect(linux.hint).toContain('https://nodejs.org/en/download');
    expect(core.evaluateNode('20.0.0', 'win32').step.hint).toContain('winget install OpenJS.NodeJS.LTS');
  });
});

describe('plataforma', () => {
  it('linux e win32 são ok; darwin é aviso de não testado', () => {
    expect(core.evaluatePlatform({ platform: 'linux', release: 'x', arch: 'x64' }).step.status).toBe('ok');
    expect(core.evaluatePlatform({ platform: 'win32', release: '10.0', arch: 'x64' }).step.status).toBe('ok');
    const mac = core.evaluatePlatform({ platform: 'darwin', release: '23', arch: 'arm64' }).step;
    expect(mac.status).toBe('warn');
    expect(mac.message).toContain('não testado');
  });
});

describe('gerenciador de pacotes', () => {
  it.each([
    ['pnpm/10.18.0 npm/? node/v24.18.0 linux x64', 'pnpm'],
    ['npm/11.16.0 node/v24.18.0 linux x64', 'npm'],
    ['yarn/1.22.22 npm/? node/v24.18.0', 'unknown'],
    ['', 'unknown'],
  ])('user-agent %j -> %s', (ua, invoker) => {
    expect(core.detectInvoker({ npm_config_user_agent: ua })).toBe(invoker);
  });

  it('detecta por npm_execpath quando o user-agent falta', () => {
    expect(core.detectInvoker({ npm_execpath: '/x/pnpm/bin/pnpm.cjs' })).toBe('pnpm');
    expect(core.detectInvoker({ npm_execpath: '/usr/lib/node_modules/npm/bin/npm-cli.js' })).toBe('npm');
  });

  it('bloqueia npm e yarn; permite pnpm e ausência de user-agent', () => {
    expect(core.checkPackageManagerInvocation({ npm_config_user_agent: 'pnpm/10.18.0 npm/?' }).allowed).toBe(true);
    expect(core.checkPackageManagerInvocation({}).allowed).toBe(true);
    const npm = core.checkPackageManagerInvocation({ npm_config_user_agent: 'npm/11.0.0 node/v24' });
    expect(npm.allowed).toBe(false);
    expect(npm.message).toContain('Este projeto usa pnpm (lockfile pnpm-lock.yaml)');
    expect(core.checkPackageManagerInvocation({ npm_config_user_agent: 'yarn/1.22' }).allowed).toBe(false);
  });

  it('FSLM_ALLOW_NPM_INSTALL=1 permite npm', () => {
    const env = { npm_config_user_agent: 'npm/11.0.0', FSLM_ALLOW_NPM_INSTALL: '1' };
    expect(core.checkPackageManagerInvocation(env).allowed).toBe(true);
  });

  it('separa hash Corepack da versão do gerenciador', () => {
    const pinned = `pnpm@10.34.0+sha512.${'a'.repeat(128)}`;
    expect(core.parsePackageManagerField(pinned)).toEqual({ name: 'pnpm', version: '10.34.0' });
    expect(core.evaluatePackageManager({ packageManagerField: pinned }).packageManager.version).toBe('10.34.0');
  });

  it.each(['pnpm@10.34.0+sha512.abc', 'pnpm@10.34.0&calc.exe', 'pnpm@10.34.0;echo', 'pnpm@10.34.0+invalido', 'pnpm@latest'])('recusa versão ou integridade insegura: %s', (field) => {
    expect(core.parsePackageManagerField(field)).toBeNull();
  });

  it('avisa sobre lockfiles de outros gerenciadores sem apagar nada', () => {
    const { packageManager, step } = core.evaluatePackageManager({
      env: {},
      rootEntries: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'],
      packageManagerField: PNPM_FIELD,
    });
    expect(step.status).toBe('warn');
    expect(packageManager.conflictingLockfiles).toEqual(['package-lock.json', 'yarn.lock']);
    expect(packageManager.version).toBe('10.18.0');
    expect(core.evaluatePackageManager({ rootEntries: ['pnpm-lock.yaml'], packageManagerField: PNPM_FIELD }).step.status).toBe('ok');
  });
});

describe('estado das dependências', () => {
  function project(files: Record<string, string | null>): string {
    const root = tempDir();
    for (const [rel, content] of Object.entries(files)) {
      if (content === null) continue;
      const full = join(root, rel);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content);
    }
    return root;
  }
  const pkgs = (root: string, names: string[]) =>
    Object.fromEntries(names.map((name) => [`node_modules/${name}/package.json`, '{}']));
  const LOCK = 'lockfileVersion: 9\n';

  it('missing quando node_modules não existe', () => {
    expect(core.checkDependencyState({ root: project({ 'pnpm-lock.yaml': LOCK }) }).state).toBe('missing');
  });

  it('foreign quando node_modules existe sem .pnpm', () => {
    const root = project({ 'pnpm-lock.yaml': LOCK, ...pkgs('', core.REQUIRED_PACKAGES) });
    expect(core.checkDependencyState({ root }).state).toBe('foreign');
  });

  it('missing quando falta pacote obrigatório', () => {
    const root = project({ 'pnpm-lock.yaml': LOCK, 'node_modules/.pnpm/lock.yaml': LOCK, ...pkgs('', ['next']) });
    const result = core.checkDependencyState({ root });
    expect(result.state).toBe('missing');
    expect(result.reason).toContain('tsx');
  });

  it('outdated quando o lock instalado difere ou está ausente', () => {
    const base = { 'pnpm-lock.yaml': LOCK, ...pkgs('', core.REQUIRED_PACKAGES) };
    expect(core.checkDependencyState({ root: project({ ...base, 'node_modules/.pnpm/lock.yaml': 'outro\n' }) }).state).toBe('outdated');
    expect(core.checkDependencyState({ root: project({ ...base, 'node_modules/.pnpm/x': '' }) }).state).toBe('outdated');
  });

  it('ok quando lock é byte-igual e pacotes existem', () => {
    const root = project({ 'pnpm-lock.yaml': LOCK, 'node_modules/.pnpm/lock.yaml': LOCK, ...pkgs('', core.REQUIRED_PACKAGES) });
    expect(core.checkDependencyState({ root }).state).toBe('ok');
  });
});

describe('planInstallCommand', () => {
  const linuxExists = (present: string[]) => (p: string) => present.includes(p);
  const base = { packageManagerField: PNPM_FIELD, execPath: '/usr/bin/node' };
  const CJS = '/home/u/.local/lib/node_modules/pnpm/bin/pnpm.cjs';

  it('(a) usa o pnpm que executa este script', () => {
    const plan = core.planInstallCommand({ ...base, platform: 'linux', env: { npm_execpath: '/x/pnpm.cjs' }, fileExists: asFn(linuxExists([])) });
    expect(plan).toEqual({ command: '/usr/bin/node', args: ['/x/pnpm.cjs', 'install', '--frozen-lockfile'], shell: false, description: 'pnpm (este processo)' });
  });

  it('(b) pnpm no PATH resolvido para pnpm.cjs via Node (linux)', () => {
    const plan = core.planInstallCommand({
      ...base,
      platform: 'linux',
      env: { PATH: '/home/u/.local/bin' },
      fileExists: asFn(linuxExists(['/home/u/.local/bin/pnpm'])),
      realpath: asFn(() => CJS),
    });
    expect(plan.command).toBe('/usr/bin/node');
    expect(plan.args).toEqual([CJS, 'install', '--frozen-lockfile']);
    expect(plan.shell).toBe(false);
  });

  it('(b) win32 com pnpm.cmd do npm global usa pnpm.cjs; sem cjs usa shell com args fixos', () => {
    const dir = 'C:\\Users\\u\\AppData\\Roaming\\npm';
    const cmd = `${dir}\\pnpm.cmd`;
    const cjs = `${dir}\\node_modules\\pnpm\\bin\\pnpm.cjs`;
    const withCjs = core.planInstallCommand({
      ...base,
      platform: 'win32',
      execPath: 'C:\\node\\node.exe',
      env: { PATH: dir, PATHEXT: '.COM;.EXE;.CMD' },
      fileExists: asFn(linuxExists([cmd, cjs])),
    });
    expect(withCjs).toMatchObject({ command: 'C:\\node\\node.exe', args: [cjs, 'install', '--frozen-lockfile'], shell: false });
    const withoutCjs = core.planInstallCommand({
      ...base,
      platform: 'win32',
      env: { PATH: dir, PATHEXT: '.COM;.EXE;.CMD' },
      fileExists: asFn(linuxExists([cmd])),
    });
    expect(withoutCjs).toMatchObject({ command: 'pnpm', args: ['install', '--frozen-lockfile'], shell: true });
  });

  it('(b) win32 pnpm.exe roda sem shell', () => {
    const exe = 'C:\\tools\\pnpm.exe';
    const plan = core.planInstallCommand({
      ...base,
      platform: 'win32',
      env: { PATH: 'C:\\tools', PATHEXT: '.EXE;.CMD' },
      fileExists: asFn(linuxExists([exe])),
    });
    expect(plan).toMatchObject({ command: exe, shell: false });
  });

  it('(c) corepack quando não há pnpm', () => {
    const plan = core.planInstallCommand({
      ...base,
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      fileExists: asFn(linuxExists(['/usr/bin/corepack'])),
      realpath: asFn(() => '/usr/bin/corepack'),
    });
    expect(plan).toMatchObject({ command: 'corepack', args: ['pnpm', 'install', '--frozen-lockfile'], shell: false });
  });

  it('(d) npm exec pnpm@<versão> quando npm_execpath é npm-cli.js', () => {
    const plan = core.planInstallCommand({
      ...base,
      platform: 'linux',
      env: { npm_execpath: '/usr/lib/node_modules/npm/bin/npm-cli.js' },
      fileExists: asFn(linuxExists([])),
    });
    expect(plan.command).toBe('/usr/bin/node');
    expect(plan.args).toEqual([
      '/usr/lib/node_modules/npm/bin/npm-cli.js',
      'exec',
      '--yes',
      'pnpm@10.18.0',
      '--',
      'install',
      '--frozen-lockfile',
    ]);
  });

  it('(d) npm no PATH no Windows usa shell; sem nenhum gerenciador retorna null', () => {
    const win = core.planInstallCommand({
      ...base,
      platform: 'win32',
      env: { PATH: 'C:\\n', PATHEXT: '.CMD' },
      fileExists: asFn(linuxExists(['C:\\n\\npm.cmd'])),
    });
    expect(win).toMatchObject({ command: 'npm', shell: true });
    expect(win.args).toEqual(['exec', '--yes', 'pnpm@10.18.0', '--', 'install', '--frozen-lockfile']);
    expect(core.planInstallCommand({ ...base, platform: 'linux', env: {}, fileExists: asFn(linuxExists([])) })).toBeNull();
  });

  it('fallback npm fixa a versão sem enviar o hash Corepack ao registro', () => {
    const plan = core.planInstallCommand({
      ...base,
      packageManagerField: `pnpm@10.34.0+sha512.${'a'.repeat(128)}`,
      platform: 'linux',
      env: { npm_execpath: '/usr/lib/node_modules/npm/bin/npm-cli.js' },
      fileExists: asFn(linuxExists([])),
    });
    expect(plan.args).toEqual(['/usr/lib/node_modules/npm/bin/npm-cli.js', 'exec', '--yes', 'pnpm@10.34.0', '--', 'install', '--frozen-lockfile']);
    expect(plan.description).toBe('npm exec pnpm@10.34.0');
  });

  it('exige campo packageManager pnpm@versão', () => {
    expect(() => core.planInstallCommand({ platform: 'linux', env: {}, fileExists: asFn(linuxExists([])) })).toThrow();
  });
});

describe('consentimento para instalar', () => {
  it('flags e env', () => {
    expect(core.decideInstallConsent({ args: { yes: true } }).action).toBe('install');
    expect(core.decideInstallConsent({ env: { FSLM_AUTO_INSTALL: '1' } }).action).toBe('install');
    expect(core.decideInstallConsent({ args: { noInstall: true } }).action).toBe('refuse');
    expect(core.decideInstallConsent({ env: { FSLM_AUTO_INSTALL: '0' }, args: { yes: true } }).action).toBe('refuse');
  });

  it('TTY em stdin e stdout pergunta; sem TTY recusa', () => {
    expect(core.decideInstallConsent({ stdinIsTTY: true, stdoutIsTTY: true }).action).toBe('ask');
    expect(core.decideInstallConsent({ stdinIsTTY: true, stdoutIsTTY: false }).action).toBe('refuse');
    expect(core.decideInstallConsent({}).action).toBe('refuse');
  });

  it('resposta do prompt [S/n]', () => {
    expect(core.isYesAnswer('')).toBe(true);
    expect(core.isYesAnswer(' S ')).toBe(true);
    expect(core.isYesAnswer('sim')).toBe(true);
    expect(core.isYesAnswer('n')).toBe(false);
    expect(core.isYesAnswer('não')).toBe(false);
  });
});

describe('conectividade com o registro', () => {
  it('usa o host de npm_config_registry e cai no padrão se inválido', () => {
    expect(core.resolveRegistryHost({})).toBe('registry.npmjs.org');
    expect(core.resolveRegistryHost({ npm_config_registry: 'https://npm.empresa.local/' })).toBe('npm.empresa.local');
    expect(core.resolveRegistryHost({ npm_config_registry: 'não-é-url' })).toBe('registry.npmjs.org');
  });

  it('ok, falha e timeout (sem instalar nada)', async () => {
    const okDns = { lookup: async () => ({ address: '1.2.3.4' }) };
    const failDns = { lookup: async () => Promise.reject(new Error('ENOTFOUND')) };
    const hangDns = { lookup: () => new Promise(() => undefined) };
    await expect(core.checkRegistryReachable({ dns: asFn(okDns) })).resolves.toEqual({ ok: true, host: 'registry.npmjs.org' });
    const failed = await core.checkRegistryReachable({ dns: asFn(failDns) });
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain('ENOTFOUND');
    const timedOut = await core.checkRegistryReachable({ dns: asFn(hangDns), timeoutMs: 30 });
    expect(timedOut.ok).toBe(false);
    expect(timedOut.error).toContain('tempo esgotado');
  });
});

describe('migrations destrutivas', () => {
  it('detecta DELETE FROM da 0003 e ignora ALTER ... ADD da 0001', () => {
    const sql0003 = readFileSync(join(ROOT, 'drizzle/0003_demo_legacy_cleanup.sql'), 'utf8');
    const found0003 = core.findDestructiveStatements(sql0003);
    expect(found0003.length).toBeGreaterThanOrEqual(3);
    expect(found0003.every((item: { kind: string }) => item.kind === 'DELETE FROM')).toBe(true);
    const sql0001 = readFileSync(join(ROOT, 'drizzle/0001_instance_demo_flag.sql'), 'utf8');
    expect(core.findDestructiveStatements(sql0001)).toEqual([]);
  });

  it('reconhece DROP TABLE, DROP COLUMN e ALTER ... DROP', () => {
    expect(core.findDestructiveStatements('DROP TABLE `a`;')[0].kind).toBe('DROP TABLE');
    expect(core.findDestructiveStatements('ALTER TABLE `a` DROP COLUMN `b`;')[0].kind).toBe('DROP COLUMN');
    expect(core.findDestructiveStatements('ALTER TABLE `a` RENAME TO `b`;')).toEqual([]);
  });

  it('ignora comentários e texto dentro de literais', () => {
    const sql = "-- DELETE FROM x\n/* DROP TABLE y */\nINSERT INTO t VALUES ('DELETE FROM z; DROP TABLE w');\n--> statement-breakpoint\n";
    expect(core.findDestructiveStatements(sql)).toEqual([]);
  });

  it('pendentes são as entradas do journal após as aplicadas', () => {
    const journal = { entries: [{ tag: '0000' }, { tag: '0001' }, { tag: '0002' }] };
    expect(core.pendingTags(journal, 1)).toEqual(['0001', '0002']);
    expect(core.pendingTags(journal, 3)).toEqual([]);
    expect(core.pendingTags(journal, 0)).toHaveLength(3);
  });

  it('retenção mantém os 5 mais recentes do prefixo de pré-migração', () => {
    const names = [
      'fslm-pre-migration-2026-01-01T00-00-00-000Z.db',
      'fslm-pre-migration-2026-01-02T00-00-00-000Z.db',
      'fslm-pre-migration-2026-01-03T00-00-00-000Z.db',
      'fslm-pre-migration-2026-01-04T00-00-00-000Z.db',
      'fslm-pre-migration-2026-01-05T00-00-00-000Z.db',
      'fslm-pre-migration-2026-01-06T00-00-00-000Z.db',
      'fslm-2026-01-01T00-00-00-000Z.db',
    ];
    const pruned = core.backupsToPrune({ names, keep: 5 });
    expect(pruned).toEqual(['fslm-pre-migration-2026-01-01T00-00-00-000Z.db']);
  });
});

describe('lock e servidor já em execução', () => {
  it('trata EPERM como processo vivo e ESRCH como morto', () => {
    expect(core.isProcessAlive(1, () => undefined)).toBe(true);
    expect(core.isProcessAlive(1, () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); })).toBe(true);
    expect(core.isProcessAlive(1, () => { throw Object.assign(new Error('x'), { code: 'ESRCH' }); })).toBe(false);
  });

  it('lock inválido vira null', () => {
    expect(core.parseLockFile('não é json')).toBeNull();
    expect(core.parseLockFile(JSON.stringify({ pid: 0, port: 3000 }))).toBeNull();
    expect(core.parseLockFile(JSON.stringify({ pid: 10, port: 3000 }))?.pid).toBe(10);
  });

  it('lock velho (processo morto) não é tratado como em execução', async () => {
    const lock = { pid: 999999, port: 3000 };
    const result = await core.checkRunningApp({ lock, isAlive: () => false, probe: async () => ({ db: 'ok' }) });
    expect(result.running).toBe(false);
  });

  it('lock vivo mas sem resposta do app = não em execução; com /api/health = em execução', async () => {
    const lock = { pid: 10, port: 3000 };
    const silent = await core.checkRunningApp({ lock, isAlive: () => true, probe: async () => null });
    expect(silent.running).toBe(false);
    const alive = await core.checkRunningApp({ lock, isAlive: () => true, probe: async () => ({ db: 'ok' }) });
    expect(alive).toMatchObject({ running: true, url: 'http://127.0.0.1:3000' });
    const other = await core.checkRunningApp({ lock, isAlive: () => true, probe: async () => ({ outro: 1 }) });
    expect(other.running).toBe(false);
  });
});

describe('navegador, encerramento e mensagens', () => {
  it('linux só abre com DISPLAY ou WAYLAND_DISPLAY', () => {
    expect(core.buildOpenCommand({ platform: 'linux', env: {}, url: 'http://x' })).toBeNull();
    expect(core.buildOpenCommand({ platform: 'linux', env: { DISPLAY: ':0' }, url: 'http://x' })).toEqual({ command: 'xdg-open', args: ['http://x'] });
    expect(core.buildOpenCommand({ platform: 'linux', env: { WAYLAND_DISPLAY: 'w' }, url: 'u' })?.command).toBe('xdg-open');
    expect(core.buildOpenCommand({ platform: 'darwin', env: {}, url: 'u' })?.command).toBe('open');
    expect(core.buildOpenCommand({ platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, url: 'u' })).toEqual({ command: 'C:\\Windows\\System32\\rundll32.exe', args: ['C:\\Windows\\System32\\url.dll,FileProtocolHandler', 'u'] });
  });

  it('win32 encerra a árvore com taskkill (args fixos); POSIX usa child.kill', () => {
    expect(core.buildStopCommand({ platform: 'win32', pid: 42, env: { SystemRoot: 'C:\\Windows' } })).toEqual({ command: 'C:\\Windows\\System32\\taskkill.exe', args: ['/pid', '42', '/T', '/F'] });
    expect(core.buildStopCommand({ platform: 'linux', pid: 42 })).toBeNull();
  });

  it.each([undefined, '', 'Windows', 'C:Windows', '\\Windows', '\\\\host\\share', 'C:\\Windows\\..\\plantado'])('Windows com SystemRoot inválido (%s) não recorre ao PATH', (SystemRoot) => {
    const env = { SystemRoot, PATH: '.' };
    expect(core.buildOpenCommand({ platform: 'win32', env, url: 'u' })).toBeNull();
    expect(core.buildStopCommand({ platform: 'win32', env, pid: 42 })).toBeNull();
  });

  it('SystemRoot alternativo com espaços mantém exe e DLL absolutos', () => {
    const env = { SystemRoot: 'D:\\Windows Local', PATH: '.' };
    expect(core.buildOpenCommand({ platform: 'win32', env, url: 'u' })).toEqual({
      command: 'D:\\Windows Local\\System32\\rundll32.exe',
      args: ['D:\\Windows Local\\System32\\url.dll,FileProtocolHandler', 'u'],
    });
    expect(core.buildStopCommand({ platform: 'win32', env, pid: undefined })).toBeNull();
  });

  it('erro de formatação tem etapa, causa e "Como resolver"', () => {
    const [first, second] = core.formatError({ stage: 'dependências', cause: 'falhou', hint: 'rode de novo' });
    expect(first).toBe('[fslm] ERRO na etapa "dependências": falhou');
    expect(second).toBe('[fslm] Como resolver: rode de novo');
  });

  it('cofre: ok se algum backend disponível; aviso sem valores quando nenhum', () => {
    expect(core.evaluateVault({ results: [{ backend: 'a', available: true }], platform: 'linux' }).status).toBe('ok');
    const none = core.evaluateVault({ results: [{ backend: 'a', available: false, reason: 'x' }], platform: 'linux' });
    expect(none.status).toBe('warn');
    expect(none.hint).toContain('libsecret');
    for (const platform of ['linux', 'win32', 'darwin']) {
      expect(core.vaultHint(platform)).toContain('fora da pasta do projeto');
      expect(core.vaultHint(platform)).not.toContain('no .env');
    }
    expect(core.evaluateVault({ results: null, platform: 'win32' }).message).toContain('não verificado');
  });

  it('argumentos: flags conhecidas e desconhecidas', () => {
    expect(core.parseArgs(['--prepare-only', '--yes', '--x'])).toEqual({ prepareOnly: true, yes: true, noInstall: false, unknown: ['--x'] });
  });
});

describe('status e escrita atômica', () => {
  it('documento só tem campos permitidos e steps sem campos extras', () => {
    const doc = core.buildStatusDocument({
      startedAt: 'a',
      updatedAt: 'b',
      phase: 'ready',
      mode: 'dev',
      steps: [{ id: 'node', label: 'Node', status: 'ok', message: 'ok', extra: 'secret-like' }],
      FSLM_SECRET_KEY: 'nao-deve-aparecer',
    });
    expect(Object.keys(doc).sort()).toEqual(['dependencies', 'database', 'mode', 'node', 'packageManager', 'phase', 'platform', 'port', 'startedAt', 'steps', 'updatedAt', 'version'].sort());
    expect(doc.steps[0]).toEqual({ id: 'node', label: 'Node', status: 'ok', message: 'ok' });
    expect(JSON.stringify(doc)).not.toContain('nao-deve-aparecer');
  });

  it('escrita atômica grava com modo 0600, substitui e não deixa .tmp', () => {
    const dir = tempDir();
    const file = join(dir, 'bootstrap-status.json');
    core.writeFileAtomic(file, '{"a":1}\n');
    core.writeFileAtomic(file, '{"a":2}\n');
    expect(readFileSync(file, 'utf8')).toBe('{"a":2}\n');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, 'bootstrap-status.json'), 'utf8')).not.toContain('tmp');
  });
});

describe('migrations destrutivas revisadas', () => {
  const sql0003 = readFileSync(join(process.cwd(), 'drizzle', '0003_demo_legacy_cleanup.sql'), 'utf8');

  it('0003 revisada não bloqueia, com LF ou CRLF', () => {
    for (const text of [sql0003, sql0003.replace(/\n/g, '\r\n')]) {
      const [item] = core.scanPendingMigrations({ tags: ['0003_demo_legacy_cleanup'], readSql: () => text });
      expect(item).toMatchObject({ reviewed: true, destructive: [] });
    }
  });

  it('0003 alterada perde a revisão e volta a bloquear', () => {
    const [item] = core.scanPendingMigrations({
      tags: ['0003_demo_legacy_cleanup'],
      readSql: () => `${sql0003}\n--> statement-breakpoint\nDROP TABLE \`instances\`;`,
    });
    expect(item.reviewed).toBe(false);
    expect(item.destructive.length).toBeGreaterThan(0);
  });

  it('outra tag com o mesmo SQL não é considerada revisada', () => {
    const [item] = core.scanPendingMigrations({ tags: ['0099_outra'], readSql: () => sql0003 });
    expect(item.reviewed).toBe(false);
    expect(item.destructive).toHaveLength(3);
  });
});
