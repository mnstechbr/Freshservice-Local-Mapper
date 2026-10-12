import '@fontsource-variable/inter/index.css';
import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { getDb } from '@/lib/db/client';
import { getAuthDeps } from '@/lib/auth/context';
import { getStatus } from '@/lib/auth/connection';
import { SIMULATOR_BANNER_HEIGHT_PX, SimulatorBanner } from '@/lib/simulator/banner';
import { isSimulatorEnabled } from '@/lib/simulator/config';
import { isConnected } from '@/lib/ui/status';
import { getActiveInstance } from '@/lib/queries/instances';
import { getLatestFinishedRun } from '@/lib/queries/runs';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mapeador Local Freshservice',
  description: 'Inventário, sincronização e detecção de mudanças, tudo local no seu computador.',
};

// Lê a instância ativa a cada requisição (banner de demonstração).
export const dynamic = 'force-dynamic';

function isDemoActive(): boolean {
  try {
    return getActiveInstance(getDb())?.isDemo === true;
  } catch {
    return false;
  }
}

/** Data da última coleta concluída quando a conexão não está ativa (modo offline). Null nos demais casos. */
function offlineCollectedAt(): number | null {
  try {
    const db = getDb();
    const instance = getActiveInstance(db);
    if (!instance || instance.isDemo) return null;
    if (isConnected(getStatus(getAuthDeps()).status)) return null;
    return getLatestFinishedRun(db, instance.id)?.finishedAt ?? null;
  } catch {
    return null;
  }
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const isDemo = isDemoActive();
  const simulator = isSimulatorEnabled();
  // Só com o simulador ativo: publica a altura da faixa. Sem ela, a barra lateral e o shell usam fallback 0px.
  const simulatorVars = simulator
    ? ({ '--simulator-banner-height': `${SIMULATOR_BANNER_HEIGHT_PX}px` } as CSSProperties)
    : undefined;

  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased" style={simulatorVars}>
        {simulator ? <SimulatorBanner /> : null}
        <AppShell isDemo={isDemo} offlineCollectedAt={offlineCollectedAt()}>{children}</AppShell>
      </body>
    </html>
  );
}
