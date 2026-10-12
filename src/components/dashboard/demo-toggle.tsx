'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { readApiError } from '@/lib/ui/api-error';

/** Ativa ou remove o modo demonstrativo (POST /api/demo). Link discreto abaixo do cartão, sem alterar dados reais. */
export function DemoToggle({ isDemo }: { isDemo: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: isDemo ? 'remover' : 'ativar' }),
      });
      if (!response.ok) {
        setError(await readApiError(response, 'Não foi possível atualizar o modo demonstrativo.'));
        return;
      }
      router.refresh();
    } catch {
      setError('Não foi possível atualizar o modo demonstrativo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        title="Dados fictícios para visualizar o painel. Nada é consultado no Freshservice."
        className="font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
      >
        {isDemo ? 'Remover dados de demonstração' : 'Ativar modo demonstrativo'}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
