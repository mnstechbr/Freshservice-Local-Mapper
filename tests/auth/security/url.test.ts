import { describe, expect, it } from 'vitest';
import {
  UrlValidationError,
  normalizeFreshworksOrgUrl,
  normalizeInstanceUrl,
} from '../../../src/lib/security/url';

const rejects = (input: unknown, options?: { allowCustomDomain?: boolean }) => {
  expect(() => normalizeInstanceUrl(input, options)).toThrow(UrlValidationError);
};

describe('normalizeInstanceUrl: aceitos', () => {
  it('aceita *.freshservice.com e devolve a origem', () => {
    expect(normalizeInstanceUrl('https://acme.freshservice.com')).toEqual({
      origin: 'https://acme.freshservice.com',
      hostname: 'acme.freshservice.com',
      kind: 'freshservice',
    });
  });

  it('normaliza caminho, query, fragmento, maiúsculas e porta 443 implícita para a origem', () => {
    expect(
      normalizeInstanceUrl('  HTTPS://ACME.freshservice.com:443/tickets/12?page=2#topo  ').origin,
    ).toBe('https://acme.freshservice.com');
  });
});

describe('normalizeInstanceUrl: recusados', () => {
  it('recusa http e outros protocolos', () => {
    rejects('http://acme.freshservice.com');
    rejects('ftp://acme.freshservice.com');
    rejects('acme.freshservice.com');
  });

  it('recusa credenciais na URL', () => {
    rejects('https://usuario:senha@acme.freshservice.com');
    rejects('https://usuario@acme.freshservice.com');
  });

  it('recusa porta diferente da padrão', () => {
    rejects('https://acme.freshservice.com:8443');
  });

  it('recusa IPs (públicos, privados, link-local, metadados e formas numéricas)', () => {
    rejects('https://127.0.0.1');
    rejects('https://10.0.0.5');
    rejects('https://192.168.1.10');
    rejects('https://169.254.169.254');
    rejects('https://[::1]');
    rejects('https://2130706433');
    rejects('https://8.8.8.8');
  });

  it('recusa localhost e nomes internos', () => {
    rejects('https://localhost');
    rejects('https://api.localhost');
    rejects('https://printer.local');
    rejects('https://svc.internal');
    rejects('https://metadata.google.internal');
    rejects('https://intranet.corp');
    rejects('https://router.home.arpa');
  });

  it('recusa nomes sem domínio completo', () => {
    rejects('https://acme');
    rejects('https://acme.freshservice.com.');
  });

  it('recusa domínio fora da allowlist sem a flag explícita', () => {
    rejects('https://evil.example.com');
    rejects('https://acme.freshservice.com.evil.example.com');
    rejects('https://freshservice.com');
  });

  it('recusa IDN e caracteres não ASCII (punycode e Unicode)', () => {
    rejects('https://xn--acm-fslm.freshservice.com');
    rejects('https://açaí.freshservice.com');
  });

  it('recusa espaços e barras invertidas', () => {
    rejects('https://acme .freshservice.com');
    rejects('https://acme.freshservice.com\\evil');
  });

  it('recusa valores que não são texto', () => {
    rejects(undefined);
    rejects(42);
    rejects('');
  });
});

describe('normalizeInstanceUrl: domínio customizado (flag explícita)', () => {
  it('aceita com allowCustomDomain e marca como custom', () => {
    expect(
      normalizeInstanceUrl('https://helpdesk.empresa.com.br/painel', { allowCustomDomain: true }),
    ).toEqual({
      origin: 'https://helpdesk.empresa.com.br',
      hostname: 'helpdesk.empresa.com.br',
      kind: 'custom',
    });
  });

  it('mesmo com a flag, continua recusando http, IP, localhost e IDN', () => {
    const options = { allowCustomDomain: true };
    rejects('http://helpdesk.empresa.com.br', options);
    rejects('https://192.168.0.1', options);
    rejects('https://localhost', options);
    rejects('https://xn--helpdesk-zya.com', options);
    rejects('https://freshservice.com', options);
  });
});

describe('normalizeFreshworksOrgUrl', () => {
  it('aceita <empresa>.myfreshworks.com e <empresa>.freshworks.com', () => {
    expect(normalizeFreshworksOrgUrl('https://fslm-org.myfreshworks.com/org').origin).toBe(
      'https://fslm-org.myfreshworks.com',
    );
    expect(normalizeFreshworksOrgUrl('https://org.freshworks.com').origin).toBe(
      'https://org.freshworks.com',
    );
  });

  it('recusa outros hosts, apex e http', () => {
    expect(() => normalizeFreshworksOrgUrl('https://evil.example.com')).toThrow(UrlValidationError);
    expect(() => normalizeFreshworksOrgUrl('https://myfreshworks.com')).toThrow(UrlValidationError);
    expect(() => normalizeFreshworksOrgUrl('http://org.myfreshworks.com')).toThrow(
      UrlValidationError,
    );
  });
});
