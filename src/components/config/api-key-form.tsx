'use client';

import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { readApiError } from '@/lib/ui/api-error';

const FALLBACK = 'Não foi possível salvar a chave de API.';

const MODES = [
  {
    value: 'api_key_personal',
    label: 'API key pessoal',
    hint: 'Usa a chave de um agente. As ações ficam ligadas a esse agente.',
  },
  {
    value: 'api_key_integration',
    label: 'Usuário de integração',
    hint: 'Identidade técnica, separada de qualquer agente. Recomendada para sincronizações.',
  },
] as const;

/**
 * Chave de API (POST /api/connection/api-key). A chave fica só no campo até o envio: depois o campo é limpo
 * e a chave nunca é reexibida. O Integration User é uma identidade técnica (docs/AUTH.md, seção 5).
 */
export function ApiKeyForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = { mode: String(data.get('mode') ?? ''), api_key: String(data.get('api_key') ?? '') };

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/connection/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setMessage({ tone: 'error', text: await readApiError(response, FALLBACK) });
        return;
      }
      // A rota responde 200 também quando a validação recusa a chave ("Nada foi salvo" vem na mensagem).
      // Só 'connected' e 'no_permission' significam chave salva (mesmo critério de saveApiKey).
      const result = (await response.json()) as { status?: string; message?: string };
      if (result.status !== 'connected' && result.status !== 'no_permission') {
        setMessage({ tone: 'error', text: result.message ?? FALLBACK });
        return;
      }
      form.reset();
      setMessage({ tone: 'ok', text: 'Chave salva. Ela não é exibida novamente.' });
    } catch {
      setMessage({ tone: 'error', text: FALLBACK });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-3" aria-label="Configurar chave de API">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">Tipo de identidade</legend>
        {MODES.map((mode, index) => (
          <label key={mode.value} className="flex items-start gap-2 rounded-lg border border-border p-2.5 text-sm">
            <input
              type="radio"
              name="mode"
              value={mode.value}
              defaultChecked={index === 0}
              className="mt-1 h-4 w-4 accent-[var(--color-primary)]"
            />
            <span>
              <span className="font-medium text-foreground">{mode.label}</span>
              <span className="block text-xs text-muted-foreground">{mode.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground">
        Chave de API
        <Input name="api_key" type="password" required autoComplete="off" spellCheck={false} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy} aria-busy={busy}>
          Salvar chave
        </Button>
        {message && (
          <p role={message.tone === 'error' ? 'alert' : 'status'} className={message.tone === 'error' ? 'text-sm text-danger' : 'text-sm text-success'}>
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
