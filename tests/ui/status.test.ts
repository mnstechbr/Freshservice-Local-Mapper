import { describe, expect, it } from 'vitest';
import { readApiError, UNAVAILABLE_MESSAGE } from '@/lib/ui/api-error';
import {
  changeTypeInfo,
  connectionStatusInfo,
  describeChange,
  isConnected,
  resourceStatusInfo,
} from '@/lib/ui/status';

describe('connectionStatusInfo', () => {
  it('mapeia cada estado real para rótulo e tom', () => {
    expect(connectionStatusInfo('connected')).toEqual({ label: 'Conectado', tone: 'success' });
    expect(connectionStatusInfo('session_expired').tone).toBe('warning');
    expect(connectionStatusInfo('no_permission').tone).toBe('danger');
    expect(connectionStatusInfo('disconnected').tone).toBe('neutral');
  });

  it('nunca mostra "Conectado" sem estado conhecido', () => {
    expect(connectionStatusInfo(undefined).label).not.toBe('Conectado');
    expect(connectionStatusInfo('qualquer_coisa').label).toBe('Estado desconhecido');
    expect(isConnected('awaiting_authentication')).toBe(false);
    expect(isConnected(undefined)).toBe(false);
    expect(isConnected('connected')).toBe(true);
  });
});

describe('changeTypeInfo', () => {
  it('cobre os seis tipos de diferença', () => {
    expect(changeTypeInfo('possible_id_change')).toEqual({ label: 'ID alterado', tone: 'orange' });
    expect(changeTypeInfo('removed').label).toBe('Removido ou não encontrado');
    for (const type of ['name_changed', 'added', 'not_observed', 'fields_changed'] as const) {
      expect(changeTypeInfo(type).label.length).toBeGreaterThan(0);
    }
  });
});

describe('resourceStatusInfo', () => {
  it('mapeia novo, atualizado e sem alteração', () => {
    expect(resourceStatusInfo('new').label).toBe('Novo');
    expect(resourceStatusInfo('updated').tone).toBe('success');
    expect(resourceStatusInfo('unchanged').label).toBe('Sem alteração');
  });
});

describe('describeChange', () => {
  it('mostra antes e depois quando os dois lados existem', () => {
    expect(
      describeChange({
        previousExternalId: '32',
        previousName: 'Instalação de software',
        currentExternalId: '25',
        currentName: 'Instalação de software',
      }),
    ).toBe('ID 32 - Instalação de software → ID 25 - Instalação de software');
  });

  it('mostra só o lado que existe (novo ou removido)', () => {
    expect(
      describeChange({ previousExternalId: null, previousName: null, currentExternalId: '78', currentName: 'Solicitação de notebook' }),
    ).toBe('ID 78 - Solicitação de notebook');
    expect(
      describeChange({ previousExternalId: '19', previousName: 'Criação de e-mail', currentExternalId: null, currentName: null }),
    ).toBe('ID 19 - Criação de e-mail');
    expect(
      describeChange({ previousExternalId: null, previousName: null, currentExternalId: null, currentName: null }),
    ).toBe('—');
  });
});

describe('readApiError', () => {
  it('404 vira mensagem de funcionalidade ainda indisponível', async () => {
    expect(await readApiError(new Response('{}', { status: 404 }), 'padrão')).toBe(UNAVAILABLE_MESSAGE);
  });

  it('usa a mensagem do corpo de erro e cai na mensagem padrão quando não há JSON', async () => {
    const withMessage = new Response(JSON.stringify({ error: { code: 'x', message: 'Link inválido.' } }), {
      status: 400,
    });
    expect(await readApiError(withMessage, 'padrão')).toBe('Link inválido.');
    expect(await readApiError(new Response('<html>', { status: 500 }), 'padrão')).toBe('padrão');
  });
});
