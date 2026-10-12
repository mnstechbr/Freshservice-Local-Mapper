'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { moduleLabel, syncableEndpointKeys } from '@/lib/modules/catalog';
import { readApiError } from '@/lib/ui/api-error';

interface Preferences {
  modules: string[];
  metadataOnly: Record<string, boolean>;
  storeRaw: boolean;
}

const NOT_AVAILABLE = 'Preferências de coleta ainda não estão disponíveis nesta versão.';
const LOAD_ERROR = 'Não foi possível carregar as preferências de coleta.';
const SAVE_ERROR = 'Não foi possível salvar as preferências de coleta.';
const CHECKBOX = 'h-4 w-4 accent-[var(--color-primary)]';

/** Preferências de coleta (GET/PUT /api/sync/preferences). 404 mostra uma mensagem amigável. */
/** Chaves de endpoint consultáveis (o motor usa chaves exatas em modules e metadataOnly). */
const SYNC_ENDPOINTS = syncableEndpointKeys().map((key) => ({ key, label: moduleLabel(key) }));

export function PreferencesForm() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/sync/preferences', { cache: 'no-store' })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 404) {
          setState('unavailable');
          return;
        }
        if (!response.ok) {
          setMessage(await readApiError(response, LOAD_ERROR));
          setState('error');
          return;
        }
        const body = (await response.json()) as Partial<Preferences>;
        setPrefs({
          modules: Array.isArray(body.modules) ? body.modules : [],
          metadataOnly: body.metadataOnly ?? {},
          storeRaw: body.storeRaw === true,
        });
        setState('ready');
      })
      .catch(() => {
        if (active) {
          setMessage(LOAD_ERROR);
          setState('error');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function toggleModule(key: string, checked: boolean): void {
    setPrefs((current) => {
      if (!current) return current;
      const modules = checked ? [...current.modules, key] : current.modules.filter((item) => item !== key);
      return { ...current, modules: [...new Set(modules)] };
    });
  }

  function toggleMetadata(key: string, checked: boolean): void {
    setPrefs((current) =>
      current ? { ...current, metadataOnly: { ...current.metadataOnly, [key]: checked } } : current,
    );
  }

  async function save(): Promise<void> {
    if (!prefs) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/sync/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      });
      setMessage(response.ok ? 'Preferências salvas.' : await readApiError(response, SAVE_ERROR));
    } catch {
      setMessage(SAVE_ERROR);
    } finally {
      setSaving(false);
    }
  }

  if (state === 'loading') return <p className="text-sm text-muted-foreground">Carregando preferências…</p>;
  if (state === 'unavailable') return <p role="status" className="text-sm text-muted-foreground">{NOT_AVAILABLE}</p>;
  if (state === 'error' || !prefs) return <p role="alert" className="text-sm text-danger">{message ?? LOAD_ERROR}</p>;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="min-w-0">
        <legend className="text-sm font-medium text-foreground">Módulos coletados</legend>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {SYNC_ENDPOINTS.map((module) => (
            <li key={module.key} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border p-2.5 text-sm">
              <label className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={prefs.modules.includes(module.key)}
                  onChange={(event) => toggleModule(module.key, event.target.checked)}
                />
                <span className="min-w-0 truncate">{module.label}</span>
              </label>
              <label className="flex items-center gap-2 pl-6 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={prefs.metadataOnly[module.key] === true}
                  onChange={(event) => toggleMetadata(module.key, event.target.checked)}
                />
                Somente metadados
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <label className="flex items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          className={`${CHECKBOX} mt-0.5`}
          checked={prefs.storeRaw}
          onChange={(event) => setPrefs((current) => (current ? { ...current, storeRaw: event.target.checked } : current))}
        />
        <span>
          Guardar a resposta original da API no banco local
          <span className="block text-xs text-muted-foreground">Desmarcado, o banco guarda só a versão normalizada.</span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={saving} aria-busy={saving}>
          Salvar preferências
        </Button>
        {message && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
