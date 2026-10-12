'use client';

import { Ban, Clock, Database, FileText, LayoutGrid, LoaderCircle, Play, RefreshCw, Stethoscope } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { formatInt } from '@/lib/format';
import { readApiError } from '@/lib/ui/api-error';
import { cn } from '@/lib/utils';

/** Indicadores calculados no servidor (getDashboardStats). Sem execução concluída, os valores são zero. */
export interface SyncSummary {
  hasInstance: boolean;
  /** Último mapeamento formatado ("hoje 15:42"). Null quando nunca houve um concluído. */
  lastRunLabel: string | null;
  /** Última execução terminou cancelada: mostra badge "Cancelada" no tile de último mapeamento. */
  lastRunCancelled: boolean;
  itemsCollected: number;
  changesDetected: number;
  /** Grupos com pelo menos um endpoint acessível (número do indicador). */
  accessibleModules: number;
  /** Endpoints acessíveis e diagnosticados, para o subtítulo "N de M endpoints". */
  accessibleEndpoints: number;
  totalEndpoints: number;
}

/** Forma esperada de GET /api/sync/status, quando a rota existir. */
interface SyncProgress {
  running: boolean;
  percent?: number | null;
  message?: string | null;
}

/** Forma resumida de GET /api/diagnostics (um item por endpoint). */
interface DiagnosticsView {
  running: boolean;
  modules?: Array<{ accessStatus: string; docStatus?: string }>;
}

/** Contagem do diagnóstico: só endpoints consultáveis, separando 403 dos demais resultados. */
function summarizeDiagnostics(modules: DiagnosticsView['modules'] = []): string {
  const tested = modules.filter((item) => item.docStatus !== 'unsupported');
  const accessible = tested.filter((item) => item.accessStatus === 'accessible').length;
  const forbidden = tested.filter((item) => item.accessStatus === 'forbidden').length;
  const other = tested.length - accessible - forbidden;
  return `${formatInt(accessible)} de ${formatInt(tested.length)} endpoints acessíveis · ${formatInt(forbidden)} sem permissão (403) · ${formatInt(other)} com outro resultado`;
}

type StatTone = 'default' | 'warning' | 'success';

function StatTile({
  icon,
  label,
  value,
  hint,
  badge,
  tone = 'default',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  /** Somente tooltip (ex.: "22 de 25 endpoints"), sem linha extra no tile. */
  hint?: string;
  badge?: ReactNode;
  tone?: StatTone;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border px-3 py-2" title={hint}>
      <span
        aria-hidden="true"
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary [&_svg]:size-5',
          tone === 'warning' && 'bg-warning-soft text-warning',
          tone === 'success' && 'bg-success-soft text-success',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <span className="truncate">{label}</span>
          {badge}
        </p>
        <p className={cn('truncate text-base font-semibold text-foreground', tone === 'warning' && 'text-warning')}>
          {value}
        </p>
      </div>
    </div>
  );
}

export function SyncCard({ summary }: { summary: SyncSummary }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagSummary, setDiagSummary] = useState<string | null>(null);

  // Acompanha o progresso enquanto houver execução. Sem a rota (404), mostra a mensagem amigável e para.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch('/api/sync/status', { cache: 'no-store' });
        if (!response.ok) {
          setNotice(await readApiError(response, 'Não foi possível acompanhar o progresso.'));
          setRunning(false);
          return;
        }
        const data = (await response.json()) as SyncProgress;
        setProgress(data);
        if (!data.running) {
          setRunning(false);
          setCancelling(false);
          router.refresh();
        }
      } catch {
        setNotice('Não foi possível acompanhar o progresso agora.');
        setRunning(false);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [running, router]);

  async function start(key: 'full' | 'resync', url: string, fallback: string): Promise<void> {
    setBusy(key);
    setNotice(null);
    try {
      const response = await fetch(url, { method: 'POST', cache: 'no-store' });
      if (!response.ok) {
        setNotice(await readApiError(response, fallback));
        return;
      }
      setProgress({ running: true });
      setRunning(true);
    } catch {
      setNotice('Não foi possível falar com o aplicativo local.');
    } finally {
      setBusy(null);
    }
  }

  const disabled = !summary.hasInstance || busy !== null || running;

  // Ao abrir a página, retoma o acompanhamento se já houver execução em andamento.
  useEffect(() => {
    if (!summary.hasInstance) return;
    fetch('/api/sync/status', { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<SyncProgress>) : null))
      .then((data) => {
        if (data?.running) {
          setProgress(data);
          setRunning(true);
        }
      })
      .catch(() => undefined);
  }, [summary.hasInstance]);

  // Acompanha o diagnóstico (GET /api/diagnostics) até terminar e mostra a contagem.
  useEffect(() => {
    if (!diagnosing) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch('/api/diagnostics', { cache: 'no-store' });
        if (!response.ok) {
          setNotice(await readApiError(response, 'Não foi possível ler o diagnóstico.'));
          setDiagnosing(false);
          return;
        }
        const data = (await response.json()) as DiagnosticsView;
        if (data.running) return;
        setDiagnosing(false);
        setDiagSummary(summarizeDiagnostics(data.modules));
        router.refresh();
      } catch {
        setNotice('Não foi possível ler o diagnóstico agora.');
        setDiagnosing(false);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [diagnosing, router]);

  async function cancelRun(): Promise<void> {
    setCancelling(true);
    setNotice(null);
    try {
      const response = await fetch('/api/sync/cancel', { method: 'POST', cache: 'no-store' });
      if (!response.ok) {
        setNotice(await readApiError(response, 'Não foi possível cancelar a execução.'));
        setCancelling(false);
        return;
      }
      setNotice('Cancelamento solicitado. O mapeamento para após o passo atual.');
    } catch {
      setNotice('Não foi possível falar com o aplicativo local.');
      setCancelling(false);
    }
  }

  async function runDiagnostics(): Promise<void> {
    setBusy('diagnose');
    setNotice(null);
    setDiagSummary(null);
    try {
      const response = await fetch('/api/diagnostics', { method: 'POST', cache: 'no-store' });
      if (!response.ok) {
        setNotice(await readApiError(response, 'Não foi possível iniciar o diagnóstico.'));
        return;
      }
      setDiagnosing(true);
    } catch {
      setNotice('Não foi possível falar com o aplicativo local.');
    } finally {
      setBusy(null);
    }
  }
  const runLabel = summary.lastRunLabel;

  return (
    <Card aria-labelledby="sync-title" className="p-3">
      <CardTitle
        icon={<RefreshCw />}
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={disabled} onClick={() => void start('full', '/api/sync/full', 'Não foi possível iniciar o mapeamento.')}>
              {busy === 'full' ? <LoaderCircle className="animate-spin" /> : <Play />}
              Mapear tudo
            </Button>
            <Button
              variant="secondary"
              disabled={disabled}
              onClick={() => void start('resync', '/api/sync/resync', 'Não foi possível sincronizar novamente.')}
            >
              {busy === 'resync' ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              Sincronizar novamente
            </Button>
            {running && (
              <Button variant="secondary" disabled={cancelling} onClick={() => void cancelRun()}>
                {cancelling ? <LoaderCircle className="animate-spin" /> : <Ban />}
                Cancelar
              </Button>
            )}
            <Link href="/historico" className={buttonVariants({ variant: 'secondary' })}>
              <Clock />
              Ver histórico
            </Link>
            <Button
              variant="ghost"

              onClick={() => void runDiagnostics()}
              disabled={disabled || diagnosing}
            >
              {busy === 'diagnose' || diagnosing ? <LoaderCircle className="animate-spin" /> : <Stethoscope />}
              Diagnosticar acesso
            </Button>
          </div>
        }
      >
        Sincronização e mapeamento
      </CardTitle>

      {!summary.hasInstance && (
        <p className="mt-3 text-sm text-muted-foreground">Conecte uma instância para habilitar o mapeamento.</p>
      )}

      {running && (
        <div role="status" aria-live="polite" className="mt-3 rounded-lg bg-secondary px-4 py-3 text-sm text-foreground">
          <p className="font-medium">
            Mapeamento em andamento{progress?.message ? `: ${progress.message}` : '…'}
          </p>
          <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-card">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${Math.min(100, Math.max(5, progress?.percent ?? 5))}%` }}
            />
          </div>
        </div>
      )}

      {diagSummary && (
        <p role="status" className="mt-3 text-sm text-foreground">
          Diagnóstico concluído: {diagSummary}
        </p>
      )}
      {notice && (
        <p role="alert" className="mt-3 text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={<Clock />}
          label="Último mapeamento:"
          value={runLabel ?? 'Nenhum ainda'}
          badge={summary.lastRunCancelled ? <Badge tone="neutral" size="sm">Cancelada</Badge> : null}
        />
        <StatTile icon={<Database />} label="Itens coletados:" value={runLabel ? formatInt(summary.itemsCollected) : '—'} />
        <StatTile
          icon={<FileText />}
          label="Mudanças detectadas:"
          value={formatInt(summary.changesDetected)}
          tone={summary.changesDetected > 0 ? 'warning' : 'default'}
        />
        <StatTile
          icon={<LayoutGrid />}
          label="Módulos acessíveis:"
          value={summary.hasInstance ? formatInt(summary.accessibleModules) : '—'}
          hint={
            summary.hasInstance
              ? `${formatInt(summary.accessibleEndpoints)} de ${formatInt(summary.totalEndpoints)} endpoints · grupos com ao menos um acessível`
              : undefined
          }
          tone="success"
        />
      </div>
    </Card>
  );
}
