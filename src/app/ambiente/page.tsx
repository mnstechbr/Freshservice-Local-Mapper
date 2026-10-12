import { MonitorCog, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { BootstrapSection } from '@/components/environment/bootstrap-section';
import { formatIsoDateTime } from '@/components/environment/format';
import { EnvironmentSummary, IssuesCard } from '@/components/environment/environment-overview';
import {
  DataDirSection,
  DatabaseSection,
  DependenciesSection,
  NodeSection,
  SystemSection,
  VaultSection,
} from '@/components/environment/environment-sections';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import { collectEnvironmentDiagnostics } from '@/lib/environment/diagnostics';

// Lê a máquina, o banco e o cofre a cada acesso. Nunca é pré-renderizado no build.
export const dynamic = 'force-dynamic';

export default async function AmbientePage() {
  const report = await collectEnvironmentDiagnostics();

  return (
    <div className="flex min-w-0 flex-col gap-[15px]">
      <PageHeader
        icon={<MonitorCog />}
        title="Ambiente local"
        description={
          <>
            Diagnóstico do computador onde o app roda (Node.js, dependências, SQLite, cofre de credenciais). Não testa a
            conexão com o Freshservice — para isso, use{' '}
            <Link href="/configuracoes" className="text-primary hover:underline">
              Configurações
            </Link>
            .
          </>
        }
        aside={
          <Link href="/ambiente" prefetch={false} className={buttonVariants({ variant: 'outline' })}>
            <RefreshCw />
            Atualizar
          </Link>
        }
      />

      <EnvironmentSummary issues={report.issues} />
      <IssuesCard issues={report.issues} />

      <div className="grid min-w-0 gap-[15px] lg:grid-cols-2">
        <SystemSection os={report.os} />
        <NodeSection node={report.node} />
        <DependenciesSection deps={report.dependencies} />
        <DatabaseSection database={report.database} />
        <VaultSection vault={report.vault} />
        <DataDirSection dataDir={report.dataDir} />
      </div>

      <BootstrapSection bootstrap={report.bootstrap} />

      <footer className="text-xs text-muted-foreground">Gerado em {formatIsoDateTime(report.generatedAt)}.</footer>
    </div>
  );
}
