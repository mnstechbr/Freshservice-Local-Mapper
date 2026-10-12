import { SIMULATOR_BANNER_TEXT } from './config';

/**
 * Altura fixa da faixa, em px (inclui a borda inferior). O layout raiz a publica em --simulator-banner-height
 * (só com o simulador ativo) e o AppShell reserva esse espaço para a barra lateral e a barra móvel.
 */
export const SIMULATOR_BANNER_HEIGHT_PX = 42;

/**
 * Faixa fixa e visível em todas as telas do simulador. Componente de servidor, sem JavaScript.
 * Tem altura fixa: o texto completo fica no DOM e no title; em telas estreitas é cortado com reticências.
 */
export function SimulatorBanner() {
  return (
    <div
      role="alert"
      data-testid="simulator-banner"
      title={SIMULATOR_BANNER_TEXT}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        height: SIMULATOR_BANNER_HEIGHT_PX,
        background: '#b45309',
        color: '#ffffff',
        padding: '0 16px',
        fontWeight: 700,
        borderBottom: '3px solid #7c2d12',
      }}
    >
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {SIMULATOR_BANNER_TEXT}
      </span>
    </div>
  );
}
