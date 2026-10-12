import { CloudOff } from 'lucide-react';
import { formatDateTime } from '@/lib/format';

/** Aviso de modo offline: a conexão não está ativa, mas há dados da última coleta concluída. */
export function OfflineNotice({ collectedAt }: { collectedAt: number }) {
  return (
    <div
      role="status"
      className="mb-4 flex min-w-0 items-center gap-2.5 rounded-lg border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-sm text-warning"
    >
      <CloudOff className="size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 break-words">Modo offline — exibindo dados coletados em {formatDateTime(collectedAt)}.</p>
    </div>
  );
}
