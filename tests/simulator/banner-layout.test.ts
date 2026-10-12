import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SIMULATOR_BANNER_HEIGHT_PX, SimulatorBanner } from '@/lib/simulator/banner';
import { SIMULATOR_BANNER_TEXT } from '@/lib/simulator/config';

describe('faixa do simulador: ocupa o próprio espaço no layout', () => {
  const html = renderToStaticMarkup(createElement(SimulatorBanner));

  it('é sticky no topo, com z-index 1000 e altura fixa (a mesma publicada em --simulator-banner-height)', () => {
    expect(html).toContain('data-testid="simulator-banner"');
    expect(html).toContain('position:sticky');
    expect(html).toContain('top:0');
    expect(html).toContain('z-index:1000');
    expect(html).toContain(`height:${SIMULATOR_BANNER_HEIGHT_PX}px`);
  });

  it('mantém o texto completo no DOM (o corte em telas estreitas é só visual)', () => {
    expect(html).toContain(SIMULATOR_BANNER_TEXT);
    expect(html).toContain('text-overflow:ellipsis');
  });
});
