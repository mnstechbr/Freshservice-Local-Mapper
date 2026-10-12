'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { readApiError } from '@/lib/ui/api-error';

const FALLBACK = 'Não foi possível repetir os módulos com falha.';

/** Repete os módulos com falha desta execução (POST /api/sync/retry). Após sucesso, atualiza a página. */
export function RetryFailedButton({ runId, failedCount }: { runId: number; failedCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function retry(): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const response = await fetch('/api/sync/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
      if (!response.ok) {
        setError(await readApiError(response, FALLBACK));
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError(FALLBACK);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={() => void retry()} disabled={busy} aria-busy={busy} className="w-full sm:w-auto">
        <RefreshCw aria-hidden="true" />
        Repetir módulos com falha ({failedCount})
      </Button>
      {done && (
        <p role="status" className="text-sm text-success">
          Repetição solicitada. Atualize a página para ver o resultado.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
