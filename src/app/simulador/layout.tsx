import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { isSimulatorEnabled } from '@/lib/simulator/config';

export const dynamic = 'force-dynamic';

/** Sem FSLM_SIMULATOR=1, toda página /simulador responde 404. A faixa "SIMULADOR" vem do layout raiz. */
export default function SimuladorLayout({ children }: { children: ReactNode }) {
  if (!isSimulatorEnabled()) notFound();
  return <div>{children}</div>;
}
