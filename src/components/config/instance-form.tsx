'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';

/** Salva a seleção local; autenticação é uma ação independente. */
export function InstanceForm({ initialUrl }: { initialUrl: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/instances', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ base_url: url.trim() }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Não foi possível salvar a instância.');
        return;
      }
      setMessage('Instância salva. Conecte por OAuth no dashboard ou informe a API key abaixo.');
      router.refresh();
    } catch {
      setError('Não foi possível falar com o aplicativo local. Verifique se ele continua em execução.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-3 flex flex-col gap-3" data-testid="instance-save-form">
      <label htmlFor="instance-url" className="text-sm font-medium">URL da instância Freshservice</label>
      <input id="instance-url" type="url" required value={url} onChange={(event) => setUrl(event.target.value)}
        placeholder="https://cliente.freshservice.com" disabled={busy}
        className="rounded-lg border border-input bg-card px-3 py-2 text-sm" />
      <p className="text-xs text-muted-foreground">Salvar a URL não abre login e não exige um perfil OAuth. Use o domínio original *.freshservice.com.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {message && <p role="status" className="text-sm">{message}</p>}
      <Button type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar instância'}</Button>
    </form>
  );
}
