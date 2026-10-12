import { Database, FolderOpen, Hexagon, Monitor, Package, ShieldCheck } from 'lucide-react';
import { DetailItem, MonoText } from '@/components/environment/detail-item';
import { backendLabel, DEPENDENCY_STATE, formatBytes, formatMigrations, yesNo } from '@/components/environment/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import type { EnvironmentReport } from '@/lib/environment/types';

type Report = EnvironmentReport;

const DETAILS_GRID = 'mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2';

export function SystemSection({ os }: { os: Report['os'] }) {
  return (
    <Card aria-labelledby="sistema-title" className="min-w-0">
      <CardTitle icon={<Monitor />}>
        <span id="sistema-title">Sistema</span>
      </CardTitle>
      <dl className={DETAILS_GRID}>
        <DetailItem label="Sistema operacional">{os.label}</DetailItem>
        <DetailItem label="Suportado">
          {os.supported ? <Badge tone="success">Sim</Badge> : <Badge tone="warning">Não testado</Badge>}
        </DetailItem>
        <DetailItem label="Release">
          <MonoText>{os.release || '—'}</MonoText>
        </DetailItem>
        <DetailItem label="Arquitetura">
          <MonoText>{os.arch || '—'}</MonoText>
        </DetailItem>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        Alvos de validação: Fedora Linux e Windows 11. macOS e outros sistemas não foram testados.
      </p>
    </Card>
  );
}

export function NodeSection({ node }: { node: Report['node'] }) {
  return (
    <Card aria-labelledby="node-title" className="min-w-0">
      <CardTitle icon={<Hexagon />}>
        <span id="node-title">Node.js</span>
      </CardTitle>
      <dl className={DETAILS_GRID}>
        <DetailItem label="Versão instalada">
          <MonoText>{node.version}</MonoText>
        </DetailItem>
        <DetailItem label="Mínimo exigido">
          <MonoText>{node.minimum}</MonoText>
        </DetailItem>
        <DetailItem label="Situação">
          {node.ok ? <Badge tone="success">Atende ao mínimo</Badge> : <Badge tone="danger">Abaixo do mínimo</Badge>}
        </DetailItem>
      </dl>
    </Card>
  );
}

export function DependenciesSection({ deps }: { deps: Report['dependencies'] }) {
  const state = DEPENDENCY_STATE[deps.state];
  return (
    <Card aria-labelledby="deps-title" className="min-w-0">
      <CardTitle icon={<Package />}>
        <span id="deps-title">Dependências</span>
      </CardTitle>
      <dl className={DETAILS_GRID}>
        <DetailItem label="Estado">
          <Badge tone={state.tone} className="whitespace-normal">
            {state.label}
          </Badge>
        </DetailItem>
        <DetailItem label="Gerenciador canônico">
          {deps.canonicalManager}
          {deps.managerVersion && (
            <>
              {' '}
              <MonoText>{deps.managerVersion}</MonoText>
            </>
          )}
        </DetailItem>
        <DetailItem label="Lockfile">
          <MonoText>{deps.lockfile}</MonoText>
        </DetailItem>
        <DetailItem label="Lockfiles em conflito">
          {deps.conflictingLockfiles.length > 0 ? <MonoText>{deps.conflictingLockfiles.join(', ')}</MonoText> : 'Nenhum'}
        </DetailItem>
      </dl>
    </Card>
  );
}

export function DatabaseSection({ database }: { database: Report['database'] }) {
  return (
    <Card aria-labelledby="db-title" className="min-w-0">
      <CardTitle icon={<Database />}>
        <span id="db-title">Banco SQLite</span>
      </CardTitle>
      <dl className={DETAILS_GRID}>
        <DetailItem label="Status">
          {database.status === 'ok' ? <Badge tone="success">OK</Badge> : <Badge tone="danger">Com erro</Badge>}
        </DetailItem>
        <DetailItem label="Tamanho">{formatBytes(database.sizeBytes)}</DetailItem>
        <DetailItem label="Caminho" className="sm:col-span-2">
          <MonoText>{database.path || '—'}</MonoText>
        </DetailItem>
        <DetailItem label="Modo de journal">
          {database.journalMode ? <MonoText>{database.journalMode}</MonoText> : '—'}
        </DetailItem>
        <DetailItem label="Migrações aplicadas">
          {formatMigrations(database.migrationsApplied, database.migrationsTotal)}
        </DetailItem>
        <DetailItem label="Última migração">
          {database.latestMigration ? <MonoText>{database.latestMigration}</MonoText> : '—'}
        </DetailItem>
        <DetailItem label="Integridade (quick_check)">
          <QuickCheckBadge value={database.quickCheck} />
        </DetailItem>
      </dl>
    </Card>
  );
}

function QuickCheckBadge({ value }: { value: Report['database']['quickCheck'] }) {
  if (value === 'ok') return <Badge tone="success">OK</Badge>;
  if (value === 'error') return <Badge tone="danger">Falhou</Badge>;
  return <Badge tone="neutral">Não executado</Badge>;
}

/** Tabela ocupa a largura inteira do grid para caber as colunas em telas médias. */
export function VaultSection({ vault }: { vault: Report['vault'] }) {
  const available = vault.status === 'ok';
  return (
    <Card aria-labelledby="vault-title" className="min-w-0 lg:col-span-2">
      <CardTitle icon={<ShieldCheck />}>
        <span id="vault-title">Cofre de credenciais</span>
      </CardTitle>
      <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>Situação geral:</span>
        {available ? <Badge tone="success">Disponível</Badge> : <Badge tone="danger">Indisponível</Badge>}
      </p>
      <div className="mt-3 min-w-0 overflow-x-auto">
        <table aria-label="Backends de cofre verificados" className="w-full min-w-[520px] border-collapse text-sm">
          <thead className="border-b border-border text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th scope="col" className="px-2 py-2">Backend</th>
              <th scope="col" className="px-2 py-2">Disponível</th>
              <th scope="col" className="px-2 py-2">Preferido</th>
              <th scope="col" className="px-2 py-2">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {vault.backends.map((backend) => (
              <tr key={backend.backend} className="border-b border-border/70 align-top last:border-0">
                <th scope="row" className="px-2 py-2.5 text-left font-medium text-foreground">
                  {backendLabel(backend.backend)}
                </th>
                <td className="px-2 py-2.5">
                  {backend.available ? <Badge tone="success">Sim</Badge> : <Badge tone="danger">Não</Badge>}
                </td>
                <td className="px-2 py-2.5">
                  <Badge tone={backend.preferred ? 'info' : 'neutral'}>{yesNo(backend.preferred)}</Badge>
                </td>
                <td className="break-words px-2 py-2.5 text-muted-foreground">{backend.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function DataDirSection({ dataDir }: { dataDir: Report['dataDir'] }) {
  return (
    <Card aria-labelledby="dir-title" className="min-w-0">
      <CardTitle icon={<FolderOpen />}>
        <span id="dir-title">Diretório de dados</span>
      </CardTitle>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <DetailItem label="Caminho" className="sm:col-span-3">
          <MonoText>{dataDir.path || '—'}</MonoText>
        </DetailItem>
        <DetailItem label="Existe">
          <Badge tone={dataDir.exists ? 'success' : 'warning'}>{yesNo(dataDir.exists)}</Badge>
        </DetailItem>
        <DetailItem label="Gravável">
          <Badge tone={dataDir.writable ? 'success' : 'danger'}>{yesNo(dataDir.writable)}</Badge>
        </DetailItem>
      </dl>
    </Card>
  );
}
