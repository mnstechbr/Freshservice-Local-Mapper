import { Building2, ChevronDown, Database, KeyRound, Layers, Settings, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { ApiKeyForm } from '@/components/config/api-key-form';
import { InstanceForm } from '@/components/config/instance-form';
import { IntegrationAdmin } from '@/components/config/integration-admin';
import { PreferencesForm } from '@/components/config/preferences-form';
import { DemoToggle } from '@/components/dashboard/demo-toggle';
import { PageHeader } from '@/components/layout/page-header';
import { NO_INSTANCE_MESSAGE } from '@/components/modules/module-page';
import { ModuleStatusPanel } from '@/components/modules/module-status-panel';
import { ResourceTable } from '@/components/resources/resource-table';
import { Card, CardTitle } from '@/components/ui/card';
import { resolveDataDir } from '@/lib/config/paths';
import { getDb } from '@/lib/db/client';
import { getActiveInstance } from '@/lib/queries/instances';
import { loadModulePage } from '@/lib/queries/module-pages';
import type { SearchParams } from '@/lib/queries/params';
import { endpointKeysOf } from '@/lib/modules/catalog';

// Lê o banco a cada requisição e nunca é pré-renderizado no build.
export const dynamic = 'force-dynamic';

const MODULE_KEYS = endpointKeysOf('settings');

/** Caminho do diretório de dados (não é segredo). Se não puder ser resolvido, mostra um aviso. */
function dataDirLabel(): string {
  try {
    return resolveDataDir();
  } catch {
    return 'Diretório indisponível.';
  }
}

export default async function ConfiguracoesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const db = getDb();
  const instance = getActiveInstance(db);
  const data = loadModulePage(db, instance, params, { moduleKey: 'settings', moduleKeys: MODULE_KEYS });

  return (
    <div className="flex min-w-0 flex-col gap-[15px]">
      <PageHeader
        icon={<Settings />}
        title="Configurações"
        description="Coleta, administração da integração, modo demonstrativo e dados locais. Segredos nunca são exibidos."
      />

      <div className="grid min-w-0 gap-[15px] lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-[15px]">
          <div className="min-w-0">
            <ResourceTable
              title="Configurações mapeadas"
              icon={<Settings />}
              result={data.resources}
              query={data.query}
              basePath="/configuracoes"
              emptyMessage={
                instance
                  ? 'Nenhuma configuração mapeada na última execução.'
                  : NO_INSTANCE_MESSAGE
              }
            />
          </div>

          <Card aria-labelledby="instance-title" className="min-w-0">
            <CardTitle icon={<Building2 />}><span id="instance-title">Instância Freshservice</span></CardTitle>
            <InstanceForm initialUrl={instance?.isDemo ? '' : instance?.baseUrl ?? ''} />
          </Card>

          {/* (a) Configurações gerais e operacionais: uso diário, sem dados de integração. */}
          <Card aria-labelledby="preferencias-title" className="min-w-0">
            <CardTitle icon={<SlidersHorizontal />}>
              <span id="preferencias-title">Preferências de coleta</span>
            </CardTitle>
            <div className="mt-3">
              <PreferencesForm />
            </div>
          </Card>

          {/* (b) Configuração única por organização do cliente: responsabilidade do administrador. */}
          <Card aria-labelledby="admin-title" id="administracao-integracao" className="min-w-0 scroll-mt-4" data-testid="integration-admin-section">
            <CardTitle icon={<Building2 />}>
              <span id="admin-title">
                Administração da integração{' '}
                <span className="text-base font-normal text-muted-foreground">
                  (configuração única por organização do cliente)
                </span>
              </span>
            </CardTitle>
            <p className="mt-3 flex min-w-0 items-start gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-sm text-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 break-words">
                <strong className="font-semibold">Responsabilidade do administrador — o analista não precisa preencher isto.</strong>{' '}
                No dia a dia, o analista informa só o link do cliente e conecta a conta autenticada.
              </span>
            </p>
            <div className="mt-4 min-w-0">
              <IntegrationAdmin />
            </div>
          </Card>

          {/* (c) Opção técnica avançada: recolhida por padrão e fora do fluxo OAuth principal. */}
          <Card aria-labelledby="apikey-title" className="min-w-0" data-testid="advanced-api-key-section">
            <details className="group">
              <summary className="flex min-w-0 cursor-pointer list-none items-center justify-between gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary [&_svg]:size-[18px]"
                  >
                    <KeyRound />
                  </span>
                  <span id="apikey-title" className="min-w-0 text-lg font-semibold text-foreground">
                    Opção técnica avançada: API key
                  </span>
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="mt-3 flex min-w-0 flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  Não é necessária para o fluxo principal de OAuth. Use apenas se um responsável técnico orientar.
                </p>
                <ApiKeyForm />
              </div>
            </details>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-[15px]">
          <ModuleStatusPanel moduleKeys={MODULE_KEYS} rows={data.apiRows} hasInstance={instance !== null} />

          <Card aria-labelledby="demo-title" className="min-w-0">
            <CardTitle icon={<Layers />}>
              <span id="demo-title">Modo demonstrativo</span>
            </CardTitle>
            <DemoToggle isDemo={instance?.isDemo ?? false} />
          </Card>

          <Card aria-labelledby="dados-title" className="min-w-0">
            <CardTitle icon={<Database />}>
              <span id="dados-title">Dados locais</span>
            </CardTitle>
            <p className="mt-3 text-sm text-muted-foreground">Diretório do banco local:</p>
            <p className="mt-1 break-all font-mono text-xs text-foreground">{dataDirLabel()}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
