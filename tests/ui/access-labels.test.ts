import { describe, expect, it } from 'vitest';
import { apiAccessInfo, moduleResultInfo, reviewStatusInfo, syncRunStatusInfo } from '@/lib/ui/status';

describe('apiAccessInfo', () => {
  it('mapeia cada estado de acesso para um rótulo e um tom', () => {
    expect(apiAccessInfo('accessible')).toEqual({ label: 'Acessível', tone: 'success' });
    expect(apiAccessInfo('forbidden')).toEqual({ label: 'Sem permissão', tone: 'danger' });
    expect(apiAccessInfo('not_found')).toEqual({ label: 'Não encontrado', tone: 'warning' });
    expect(apiAccessInfo('unsupported')).toEqual({ label: 'Não suportado', tone: 'neutral' });
    expect(apiAccessInfo('temporarily_unavailable')).toEqual({ label: 'Temporariamente indisponível', tone: 'warning' });
    expect(apiAccessInfo('untested')).toEqual({ label: 'Não testado', tone: 'neutral' });
  });

  it('sem registro vira "Não testado", nunca "Acessível"', () => {
    expect(apiAccessInfo(undefined).label).toBe('Não testado');
    expect(apiAccessInfo(null).label).toBe('Não testado');
  });
});

describe('status de revisão, execução e módulo', () => {
  it('rótulos de revisão', () => {
    expect(reviewStatusInfo('pending').label).toBe('Pendente');
    expect(reviewStatusInfo('confirmed').tone).toBe('success');
    expect(reviewStatusInfo('rejected').tone).toBe('danger');
  });

  it('rótulos de execução em português', () => {
    expect(syncRunStatusInfo('completed').label).toBe('Concluída');
    expect(syncRunStatusInfo('partial').label).toBe('Parcial');
    expect(syncRunStatusInfo('failed').label).toBe('Falhou');
    expect(syncRunStatusInfo('cancelled').label).toBe('Cancelada');
  });

  it('rótulos de resultado por módulo', () => {
    expect(moduleResultInfo('skipped').label).toBe('Ignorado');
    expect(moduleResultInfo('failed').tone).toBe('danger');
  });
});
