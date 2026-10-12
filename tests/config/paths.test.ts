import { describe, expect, it } from 'vitest';
import { ConfigError, parseEnv } from '../../src/lib/config/env';
import {
  BACKUPS_DIR_NAME,
  BOOTSTRAP_STATUS_FILE,
  DataDirError,
  WINDOWS_APP_DIR_NAME,
  assertSafeDataDir,
  resolveDataDir,
} from '../../src/lib/config/paths';

const base = {
  platform: 'linux' as const,
  homeDir: '/home/ana',
  tmpDir: '/tmp',
  projectRoot: '/srv/app',
};

describe('resolveDataDir: padrão por sistema operacional', () => {
  it('Linux usa XDG_DATA_HOME quando é absoluto', () => {
    expect(resolveDataDir({ ...base, env: { XDG_DATA_HOME: '/home/ana/dados' } })).toBe(
      '/home/ana/dados/freshservice-local-mapper',
    );
  });

  it('Linux ignora XDG_DATA_HOME relativo e usa ~/.local/share', () => {
    expect(resolveDataDir({ ...base, env: { XDG_DATA_HOME: 'relativo' } })).toBe(
      '/home/ana/.local/share/freshservice-local-mapper',
    );
  });

  it('macOS usa ~/Library/Application Support', () => {
    expect(
      resolveDataDir({ ...base, platform: 'darwin', homeDir: '/Users/ana', env: {} }),
    ).toBe('/Users/ana/Library/Application Support/freshservice-local-mapper');
  });

  it('Windows usa %LOCALAPPDATA%\\FreshserviceLocalMapper', () => {
    expect(
      resolveDataDir({
        ...base,
        platform: 'win32',
        homeDir: 'C:\\Users\\Ana',
        env: { LOCALAPPDATA: 'C:\\Users\\Ana\\AppData\\Local' },
      }),
    ).toBe(`C:\\Users\\Ana\\AppData\\Local\\${WINDOWS_APP_DIR_NAME}`);
    expect(WINDOWS_APP_DIR_NAME).toBe('FreshserviceLocalMapper');
  });

  it('Windows aceita LOCALAPPDATA com espaços e acentos', () => {
    expect(
      resolveDataDir({
        ...base,
        platform: 'win32',
        homeDir: 'C:\\Users\\João Silva',
        env: { LOCALAPPDATA: 'C:\\Users\\João Silva\\AppData\\Local' },
      }),
    ).toBe('C:\\Users\\João Silva\\AppData\\Local\\FreshserviceLocalMapper');
  });

  it('Windows sem LOCALAPPDATA cai em <perfil>\\AppData\\Local', () => {
    expect(
      resolveDataDir({ ...base, platform: 'win32', homeDir: 'C:\\Users\\Ana', env: {} }),
    ).toBe('C:\\Users\\Ana\\AppData\\Local\\FreshserviceLocalMapper');
  });

  it('constantes de arquivos e pastas do bootstrap', () => {
    expect(BOOTSTRAP_STATUS_FILE).toBe('bootstrap-status.json');
    expect(BACKUPS_DIR_NAME).toBe('backups');
  });

  it('FSLM_DATA_DIR absoluto e seguro é aceito', () => {
    expect(resolveDataDir({ ...base, env: { FSLM_DATA_DIR: '/home/ana/fslm-dados' } })).toBe(
      '/home/ana/fslm-dados',
    );
  });

  it('FSLM_DATA_DIR com ~ é expandido para a pasta pessoal', () => {
    expect(resolveDataDir({ ...base, env: { FSLM_DATA_DIR: '~/fslm' } })).toBe('/home/ana/fslm');
  });

  it('FSLM_DATA_DIR relativo é rejeitado', () => {
    expect(() => resolveDataDir({ ...base, env: { FSLM_DATA_DIR: 'dados' } })).toThrow(DataDirError);
  });
});

describe('assertSafeDataDir: rejeita tmp, public/ e pastas de nuvem', () => {
  it.each([
    ['pasta temporária', '/tmp/fslm-dados'],
    ['public/ do projeto', '/srv/app/public/dados'],
    ['OneDrive', '/home/ana/OneDrive/fslm'],
    ['OneDrive corporativo', '/home/ana/OneDrive - Empresa/fslm'],
    ['Dropbox', '/home/ana/Dropbox/fslm'],
    ['Google Drive', '/home/ana/Google Drive/fslm'],
    ['iCloud (macOS)', '/Users/ana/Library/Mobile Documents/com~apple~CloudDocs/fslm'],
    ['CloudStorage (macOS)', '/Users/ana/Library/CloudStorage/GoogleDrive-ana@exemplo.com/fslm'],
  ])('rejeita %s', (_label, dir) => {
    expect(() => assertSafeDataDir(dir, base)).toThrow(DataDirError);
  });

  it('aceita pasta fora dessas áreas', () => {
    expect(() => assertSafeDataDir('/home/ana/.local/share/fslm', base)).not.toThrow();
  });

  it('recusa caminhos UNC de rede no Windows (SQLite em rede corrompe)', () => {
    const win = { ...base, platform: 'win32' as const, tmpDir: 'C:\\Temp', projectRoot: 'C:\\app' };
    expect(() => assertSafeDataDir('\\\\servidor\\share\\fslm', win)).toThrow(DataDirError);
    expect(() => assertSafeDataDir('\\\\?\\C:\\fslm', win)).toThrow(DataDirError);
    expect(() => assertSafeDataDir('C:\\Users\\Ana\\AppData\\Local\\fslm', win)).not.toThrow();
    expect(() => assertSafeDataDir('\\\\servidor\\share\\fslm', win)).toThrow(/rede/);
  });

  it('FSLM_DATA_DIR em UNC é recusado, com a explicação do SQLite em rede', () => {
    const win = { platform: 'win32' as const, homeDir: 'C:\\Users\\Ana', tmpDir: 'C:\\Temp', projectRoot: 'C:\\app' };
    expect(() =>
      resolveDataDir({ ...win, env: { FSLM_DATA_DIR: '\\\\servidor\\share\\fslm' } }),
    ).toThrow(/SQLite/);
  });

  it('LOCALAPPDATA em UNC também é recusado (o padrão não pode cair em rede)', () => {
    const win = { platform: 'win32' as const, homeDir: 'C:\\Users\\Ana', tmpDir: 'C:\\Temp', projectRoot: 'C:\\app' };
    expect(() =>
      resolveDataDir({ ...win, env: { LOCALAPPDATA: '\\\\servidor\\perfis\\Ana\\Local' } }),
    ).toThrow(DataDirError);
  });

  it('a mensagem de tmp e de nuvem explica o motivo', () => {
    expect(() => assertSafeDataDir('/home/ana/Dropbox/fslm', base)).toThrow(/nuvem/);
    expect(() => assertSafeDataDir('/tmp/fslm', base)).toThrow(/temporária/);
  });
});

describe('parseEnv (Zod)', () => {
  it('aplica padrões: PORT 3000 e navegador habilitado', () => {
    const env = parseEnv({});
    expect(env.PORT).toBe(3000);
    expect(env.FSLM_NO_BROWSER).toBe(false);
  });

  it('FSLM_NO_BROWSER=1 desativa a abertura do navegador', () => {
    expect(parseEnv({ FSLM_NO_BROWSER: '1' }).FSLM_NO_BROWSER).toBe(true);
  });

  it('PORT vazia usa o padrão', () => {
    expect(parseEnv({ PORT: '' }).PORT).toBe(3000);
  });

  it('PORT inválida gera ConfigError', () => {
    expect(() => parseEnv({ PORT: 'abc' })).toThrow(ConfigError);
    expect(() => parseEnv({ PORT: '70000' })).toThrow(ConfigError);
  });
});
