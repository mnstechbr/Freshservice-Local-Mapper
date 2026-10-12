import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { QUICK_CHECK_MAX_BYTES, collectEnvironmentDiagnostics, type EnvironmentDeps, parseBootstrapStatus } from '../../src/lib/environment/diagnostics';
import { prepareDatabase } from '../../src/lib/db/bootstrap';
import { type CommandRunner } from '../../src/lib/secrets/command';
import { probeSecretBackends } from '../../src/lib/secrets/probe';

// Testes: nenhum acesso ao banco real (~/.local/share/...) nem ao cofre real. Tudo em mkdtemp.
const MIGRATIONS = join(process.cwd(), 'drizzle');
const TAGS = ['0000_init_schema', '0001_instance_demo_flag', '0002_sync_observations', '0003_demo_legacy_cleanup', '0004_integration_profiles', '0005_oauth_endpoints_states'];
const FEDORA = 'NAME="Fedora Linux"\nPRETTY_NAME="Fedora Linux 44 (Workstation Edition)"\nID=fedora\n';
const LOCK = "lockfileVersion: '9.0'\n";
const SECRET_KEY = 'c2VudGluZWxhLXNlZ3JlZG8tbXVpdG8tbG9uZ2EtMTIzNDU2Nzg5MDEyMzQ1Njc4OTA=';

interface Fixture {
  root: string;
  project: string;
  dataDir: string;
}
const fixtures: Fixture[] = [];
const openHandles: Database.Database[] = [];

afterEach(() => {
  for (const handle of openHandles.splice(0)) handle.close();
  for (const fx of fixtures.splice(0)) rmSync(fx.root, { recursive: true, force: true });
});

function makeFixture(tags: string[] = TAGS): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'fslm-env-test-'));
  const project = join(root, 'app');
  const dataDir = join(root, 'dados');
  mkdirSync(join(project, 'drizzle', 'meta'), { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  const entries = tags.map((tag, idx) => ({ idx, version: '6', when: 0, tag, breakpoints: true }));
  writeFileSync(join(project, 'drizzle', 'meta', '_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries }));
  writeFileSync(join(project, 'pnpm-lock.yaml'), LOCK);
  writeFileSync(join(project, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.18.0+sha512.abc' }));
  const fx = { root, project, dataDir };
  fixtures.push(fx);
  return fx;
}

/** Banco de teste criado com prepareDatabase em pasta temporária (sem getDbHandle nem banco real). */
function prepareTestDb(fx: Fixture): { sqlite: Database.Database; dbPath: string } {
  const prepared = prepareDatabase({ dataDir: fx.dataDir, migrationsFolder: MIGRATIONS });
  const sqlite = new Database(prepared.dbPath, { fileMustExist: true });
  openHandles.push(sqlite);
  return { sqlite, dbPath: prepared.dbPath };
}

const AVAILABLE = async () => [{ backend: 'encrypted-file' as const, available: true, preferred: true }];

/** Dependências injetadas: plataforma, SO, Node, banco e cofre controlados pelo teste. */
function deps(fx: Fixture, overrides: Partial<EnvironmentDeps> = {}): Partial<EnvironmentDeps> {
  return {
    now: () => new Date('2026-10-11T12:00:00.000Z'),
    platform: 'linux',
    osRelease: '7.2.9-200.fc44.x86_64',
    arch: 'x64',
    nodeVersion: '24.18.0',
    projectRoot: fx.project,
    env: {},
    readOsRelease: () => FEDORA,
    resolveDataDirectory: () => fx.dataDir,
    getDatabase: () => prepareTestDb(fx),
    probeSecrets: AVAILABLE,
    quickCheckMaxBytes: QUICK_CHECK_MAX_BYTES,
    ...overrides,
  };
}

const VALID_STATUS = {
  version: 1,
  startedAt: '2026-10-11T12:00:00.000Z',
  updatedAt: '2026-10-11T12:00:05.000Z',
  phase: 'server-running',
  mode: 'dev',
  platform: { os: 'linux', release: '7.2.9', arch: 'x64' },
  node: { version: '24.18.0', minimum: '22.12.0', ok: true },
  packageManager: {
    canonical: 'pnpm',
    version: '10.18.0',
    invokedBy: 'npm',
    lockfile: 'pnpm-lock.yaml',
    conflictingLockfiles: ['package-lock.json'],
  },
  dependencies: { state: 'ok', installedNow: false },
  database: { createdNow: false, migrationsApplied: 4, migrationsTotal: 4, backupFile: null },
  port: 3000,
  steps: [
    { id: 'node', label: 'Versão do Node.js', status: 'ok', message: 'Node 24.18.0' },
    { id: 'vault', label: 'Cofre de segredos', status: 'warn', message: 'Secret Service indisponível', hint: 'Instale libsecret' },
    { id: 'port', label: 'Porta', status: 'error', message: 'Porta 3000 ocupada' },
  ],
  campoExtra: 'tolerado',
};

describe('sistema operacional e Node.js', () => {
  it('Linux usa PRETTY_NAME do /etc/os-release e é suportado', async () => {
    const fx = makeFixture();
    const report = await collectEnvironmentDiagnostics(deps(fx));
    expect(report.os).toMatchObject({ platform: 'linux', label: 'Fedora Linux 44 (Workstation Edition)', supported: true });
  });

  it('Linux sem /etc/os-release cai em "Linux"', async () => {
    const fx = makeFixture();
    const report = await collectEnvironmentDiagnostics(deps(fx, { readOsRelease: () => null }));
    expect(report.os.label).toBe('Linux');
  });

  it('Windows: build 22000 ou maior é Windows 11; menor é Windows 10', async () => {
    const fx = makeFixture();
    const win11 = await collectEnvironmentDiagnostics(deps(fx, { platform: 'win32', osRelease: '10.0.22631' }));
    const win10 = await collectEnvironmentDiagnostics(deps(fx, { platform: 'win32', osRelease: '10.0.19045' }));
    expect(win11.os).toMatchObject({ label: 'Windows 11', supported: true });
    expect(win10.os).toMatchObject({ label: 'Windows 10', supported: true });
    expect(win11.issues.some((issue) => issue.area === 'Sistema operacional')).toBe(false);
  });

  it('macOS é marcado como fora do alvo validado, com aviso', async () => {
    const fx = makeFixture();
    const report = await collectEnvironmentDiagnostics(deps(fx, { platform: 'darwin', osRelease: '25.0.0' }));
    expect(report.os.supported).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({ severity: 'warning', area: 'Sistema operacional' }));
  });

  it('Node abaixo de 22.12.0 gera erro; 24.18.0 é aceito', async () => {
    const fx = makeFixture();
    const old = await collectEnvironmentDiagnostics(deps(fx, { nodeVersion: '22.11.0' }));
    const current = await collectEnvironmentDiagnostics(deps(fx, { nodeVersion: '24.18.0' }));
    expect(old.node).toMatchObject({ minimum: '22.12.0', ok: false });
    expect(old.issues).toContainEqual(expect.objectContaining({ severity: 'error', area: 'Node.js' }));
    expect(current.node.ok).toBe(true);
  });
});

describe('dependências (pnpm)', () => {
  it('sem node_modules: missing', async () => {
    const fx = makeFixture();
    const report = await collectEnvironmentDiagnostics(deps(fx));
    expect(report.dependencies.state).toBe('missing');
    expect(report.dependencies).toMatchObject({ canonicalManager: 'pnpm', lockfile: 'pnpm-lock.yaml', managerVersion: '10.18.0' });
  });

  it('node_modules sem .pnpm (instalado por outro gerenciador): foreign com erro', async () => {
    const fx = makeFixture();
    mkdirSync(join(fx.project, 'node_modules'));
    const report = await collectEnvironmentDiagnostics(deps(fx));
    expect(report.dependencies.state).toBe('foreign');
    expect(report.issues).toContainEqual(expect.objectContaining({ severity: 'error', area: 'Dependências' }));
  });

  it('node_modules/.pnpm/lock.yaml igual ao pnpm-lock.yaml: ok; diferente: outdated', async () => {
    const fx = makeFixture();
    mkdirSync(join(fx.project, 'node_modules', '.pnpm'), { recursive: true });
    writeFileSync(join(fx.project, 'node_modules', '.pnpm', 'lock.yaml'), LOCK);
    expect((await collectEnvironmentDiagnostics(deps(fx))).dependencies.state).toBe('ok');

    writeFileSync(join(fx.project, 'node_modules', '.pnpm', 'lock.yaml'), "lockfileVersion: '8.0'\n");
    const outdated = await collectEnvironmentDiagnostics(deps(fx));
    expect(outdated.dependencies.state).toBe('outdated');
    expect(outdated.issues).toContainEqual(expect.objectContaining({ severity: 'warning', fix: 'Rode pnpm install.' }));
  });

  it('lockfiles de outros gerenciadores na raiz são listados com aviso', async () => {
    const fx = makeFixture();
    writeFileSync(join(fx.project, 'package-lock.json'), '{}');
    const report = await collectEnvironmentDiagnostics(deps(fx));
    expect(report.dependencies.conflictingLockfiles).toEqual(['package-lock.json']);
    expect(report.issues.some((issue) => issue.message.includes('package-lock.json'))).toBe(true);
  });
});

describe('banco de dados', () => {
  it('banco migrado: status ok, migrações aplicadas = total, última tag do journal e quick_check ok', async () => {
    const fx = makeFixture();
    const report = await collectEnvironmentDiagnostics(deps(fx));
    expect(report.database).toMatchObject({
      status: 'ok',
      migrationsApplied: 6,
      migrationsTotal: 6,
      latestMigration: '0005_oauth_endpoints_states',
      quickCheck: 'ok',
    });
    expect(report.database.sizeBytes).toBeGreaterThan(0);
    expect(report.database.journalMode).toEqual(expect.any(String));
  });

  it('quick_check não roda acima do limite de tamanho (null)', async () => {
    const fx = makeFixture();
    const report = await collectEnvironmentDiagnostics(deps(fx, { quickCheckMaxBytes: 0 }));
    expect(report.database.quickCheck).toBeNull();
    expect(report.database.status).toBe('ok');
  });

  it('migração pendente no journal: status error com aviso', async () => {
    const fx = makeFixture([...TAGS, '0006_extra_pendente']);
    const report = await collectEnvironmentDiagnostics(deps(fx));
    expect(report.database).toMatchObject({ status: 'error', migrationsApplied: 6, migrationsTotal: 7 });
    expect(report.issues).toContainEqual(expect.objectContaining({ severity: 'error', area: 'Banco de dados' }));
  });

  it('falha ao abrir o banco: status error, mensagem curta e sem stack', async () => {
    const fx = makeFixture();
    const report = await collectEnvironmentDiagnostics(
      deps(fx, {
        getDatabase: () => {
          throw new Error('módulo nativo não carregou\n    at Object.<anonymous> (/x/y.js:1:1)');
        },
      }),
    );
    expect(report.database.status).toBe('error');
    const issue = report.issues.find((item) => item.area === 'Banco de dados');
    expect(issue?.message).toBe('Não foi possível abrir o banco: módulo nativo não carregou');
    expect(JSON.stringify(report)).not.toContain('at Object');
  });
});

describe('pasta de dados', () => {
  it('pasta existente e gravável: exists e writable; inexistente: aviso', async () => {
    const fx = makeFixture();
    const ok = await collectEnvironmentDiagnostics(deps(fx));
    expect(ok.dataDir).toEqual({ path: fx.dataDir, exists: true, writable: true });

    const missing = await collectEnvironmentDiagnostics(deps(fx, { resolveDataDirectory: () => join(fx.root, 'nao-existe') }));
    expect(missing.dataDir).toMatchObject({ exists: false, writable: false });
    expect(missing.issues).toContainEqual(expect.objectContaining({ severity: 'warning', area: 'Pasta de dados' }));
  });

  it('caminho recusado pelas regras: não ecoa o valor de FSLM_DATA_DIR', async () => {
    const fx = makeFixture();
    const report = await collectEnvironmentDiagnostics(
      deps(fx, {
        env: { FSLM_DATA_DIR: '/tmp/SEGREDO-CAMINHO' },
        resolveDataDirectory: () => {
          throw new Error('FSLM_DATA_DIR inválido: "/tmp/SEGREDO-CAMINHO"');
        },
      }),
    );
    expect(report.dataDir.path).toBe('');
    expect(report.issues).toContainEqual(expect.objectContaining({ severity: 'error', area: 'Pasta de dados' }));
    expect(JSON.stringify(report)).not.toContain('SEGREDO-CAMINHO');
  });
});

describe('cofre de segredos', () => {
  it('nenhum cofre disponível: unavailable com aviso e orientação por SO', async () => {
    const fx = makeFixture();
    const probe = [{ backend: 'linux-secret-service' as const, available: false, reason: 'secret-tool não instalado', preferred: false }];
    const report = await collectEnvironmentDiagnostics(deps(fx, { probeSecrets: async () => probe }));
    expect(report.vault.status).toBe('unavailable');
    const issue = report.issues.find((item) => item.area === 'Cofre de segredos');
    expect(issue).toMatchObject({ severity: 'warning' });
    expect(issue?.fix).toContain('sudo dnf install libsecret gnome-keyring');
    expect(issue?.fix).toContain('FSLM_SECRET_KEY');
    expect(issue?.fix).toContain('fora da pasta do projeto');
  });

  it('sonda real com runner simulado: secret-tool ausente, arquivo cifrado preferido', async () => {
    const fx = makeFixture();
    const missing: CommandRunner = async () => {
      throw Object.assign(new Error('spawn secret-tool ENOENT'), { code: 'ENOENT' });
    };
    const report = await collectEnvironmentDiagnostics(
      deps(fx, {
        env: { FSLM_SECRET_KEY: SECRET_KEY },
        probeSecrets: (options) => probeSecretBackends({ ...options, runner: missing }),
      }),
    );
    expect(report.vault.status).toBe('ok');
    expect(report.vault.backends.find((probe) => probe.preferred)?.backend).toBe('encrypted-file');
    expect(report.issues.some((item) => item.area === 'Cofre de segredos')).toBe(false);
  });

  it('o relatório nunca contém o valor de FSLM_SECRET_KEY nem outros valores de ambiente', async () => {
    const fx = makeFixture();
    const missing: CommandRunner = async () => {
      throw Object.assign(new Error('spawn secret-tool ENOENT'), { code: 'ENOENT' });
    };
    const report = await collectEnvironmentDiagnostics(
      deps(fx, {
        env: { FSLM_SECRET_KEY: SECRET_KEY, FSLM_NO_BROWSER: '1' },
        probeSecrets: (options) => probeSecretBackends({ ...options, runner: missing }),
      }),
    );
    expect(JSON.stringify(report)).not.toContain(SECRET_KEY);
  });
});

describe('bootstrap-status.json', () => {
  it('arquivo válido: campos validados, tolera extras e gera issues de passos warn/error', async () => {
    const fx = makeFixture();
    writeFileSync(join(fx.dataDir, 'bootstrap-status.json'), JSON.stringify(VALID_STATUS));
    const report = await collectEnvironmentDiagnostics(deps(fx));
    expect(report.bootstrap?.phase).toBe('server-running');
    expect(report.bootstrap).not.toHaveProperty('campoExtra');
    expect(report.issues).toContainEqual({
      severity: 'warning',
      area: 'Cofre de segredos',
      message: 'Secret Service indisponível',
      fix: 'Instale libsecret',
    });
    expect(report.issues).toContainEqual(expect.objectContaining({ severity: 'error', area: 'Porta', message: 'Porta 3000 ocupada' }));
  });

  it('JSON quebrado: bootstrap null e aviso "arquivo de status ilegível"', async () => {
    const fx = makeFixture();
    writeFileSync(join(fx.dataDir, 'bootstrap-status.json'), '{ quebrado');
    const report = await collectEnvironmentDiagnostics(deps(fx));
    expect(report.bootstrap).toBeNull();
    expect(report.issues).toContainEqual(expect.objectContaining({ severity: 'warning', message: 'arquivo de status ilegível' }));
  });

  it('contrato violado (phase desconhecida): bootstrap null e aviso', async () => {
    const fx = makeFixture();
    writeFileSync(join(fx.dataDir, 'bootstrap-status.json'), JSON.stringify({ ...VALID_STATUS, phase: 'bogus' }));
    const report = await collectEnvironmentDiagnostics(deps(fx));
    expect(report.bootstrap).toBeNull();
    expect(report.issues.some((item) => item.message === 'arquivo de status ilegível')).toBe(true);
  });

  it('arquivo ausente: bootstrap null sem aviso', async () => {
    const fx = makeFixture();
    const report = await collectEnvironmentDiagnostics(deps(fx));
    expect(report.bootstrap).toBeNull();
    expect(report.issues.some((item) => item.area === 'Bootstrap')).toBe(false);
  });

  it('parseBootstrapStatus recusa texto que não é JSON sem lançar', () => {
    expect(parseBootstrapStatus('não é json')).toBeNull();
  });
});
