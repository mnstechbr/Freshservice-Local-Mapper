'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { readApiError } from '@/lib/ui/api-error';
import { cn } from '@/lib/utils';

export const EXIT_DEMO_CONFIRM =
  'Sair da demonstração? Isto apaga apenas os dados fictícios de demonstração. Seus dados reais não são alterados.';

const FALLBACK_ERROR = 'Não foi possível sair da demonstração.';

/**
 * Sai do modo demonstrativo: confirma, chama POST /api/demo {"action":"remover"} e atualiza a página.
 * Usado no banner âmbar do shell e no cartão de conexão. Só apaga a instância is_demo = 1.
 */
export function ExitDemoButton({ className, tone = 'card' }: { className?: string; tone?: 'banner' | 'card' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exitDemo(): Promise<void> {
    if (!window.confirm(EXIT_DEMO_CONFIRM)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remover' }),
      });
      if (!response.ok) {
        setError(await readApiError(response, FALLBACK_ERROR));
        return;
      }
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn('flex flex-col gap-1', tone === 'banner' ? 'items-center' : 'items-start', className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void exitDemo()}
        disabled={busy}
        className={cn(
          tone === 'banner'
            ? 'border-amber-500 bg-white text-amber-900 hover:bg-amber-50'
            : 'h-6 px-2 text-xs',
        )}
      >
        <LogOut aria-hidden="true" />
        {busy ? 'Saindo…' : 'Sair da demonstração'}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
