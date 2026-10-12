'use client';

import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

/*
 * Erro de rota (dentro do AppShell). Não mostra a mensagem interna do erro: só um texto genérico
 * e o código de referência (digest), que aparece nos logs do servidor.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        <TriangleAlert className="size-6" />
      </span>
      <h1 className="text-2xl font-bold text-foreground sm:text-[30px]">Algo deu errado</h1>
      <p className="max-w-md text-[15px] text-muted-foreground">
        Não foi possível carregar esta página. Tente novamente. Se o problema continuar, reinicie o aplicativo.
      </p>
      <Button onClick={() => reset()}>
        <RotateCcw aria-hidden="true" />
        Tentar novamente
      </Button>
      {error.digest && <p className="text-xs text-muted-foreground">Código de referência: {error.digest}</p>}
    </div>
  );
}
