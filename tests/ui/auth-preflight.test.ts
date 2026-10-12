import { describe, expect, it } from 'vitest';
import { canOpenAuthWindow, normalizeBaseUrl, preflightPath } from '../../src/lib/ui/auth-preflight';

describe('card de conexão: link digitado', () => {
  it('aceita só https e guarda apenas a origem', () => {
    expect(normalizeBaseUrl('https://acme.freshservice.com/agents?x=1#a')).toBe('https://acme.freshservice.com');
    expect(normalizeBaseUrl('  acme.freshservice.com  ')).toBe('https://acme.freshservice.com');
    expect(normalizeBaseUrl('http://acme.freshservice.com')).toBeNull();
    expect(normalizeBaseUrl('https://usuario:senha@acme.freshservice.com')).toBeNull();
    expect(normalizeBaseUrl('   ')).toBeNull();
  });

  it('a pré-verificação por link codifica o endereço inteiro na query', () => {
    expect(preflightPath('https://acme.freshservice.com')).toBe(
      '/api/auth/oauth/preflight?url=https%3A%2F%2Facme.freshservice.com',
    );
  });
});

describe('card de conexão: quando a aba pode abrir antes do salvamento', () => {
  it('com perfil pronto e hosts locais', () => {
    expect(canOpenAuthWindow({ ready: true, redirect_host: '127.0.0.1' }, '127.0.0.1')).toBe(true);
    expect(canOpenAuthWindow({ ready: true, redirect_host: '127.0.0.1' }, 'localhost')).toBe(true);
  });

  it('perfil ausente (admin_config_missing) nunca abre aba antecipadamente', () => {
    expect(canOpenAuthWindow({ ready: false, redirect_host: null }, '127.0.0.1')).toBe(false);
  });
});
