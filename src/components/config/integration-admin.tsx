'use client';

import { LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  IntegrationProfileForm,
  type ProfileOptions,
  type ProfileView,
  type ProfileWarning,
} from '@/components/config/integration-profile-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { readApiError } from '@/lib/ui/api-error';
import { cn } from '@/lib/utils';

/** Resposta de GET /api/admin/integration-profiles. */
interface AdminData extends ProfileOptions {
  profiles: ProfileView[];
}

interface Notice {
  tone: 'success' | 'danger';
  message: string;
}

const NETWORK_ERROR = 'Não foi possível falar com o aplicativo local. Verifique se ele continua em execução.';

async function fetchAdmin(): Promise<{ data?: AdminData; error?: string }> {
  try {
    const response = await fetch('/api/admin/integration-profiles', { cache: 'no-store' });
    if (!response.ok) {
      return { error: await readApiError(response, 'Não foi possível carregar os perfis de integração.') };
    }
    return { data: (await response.json()) as AdminData };
  } catch {
    return { error: NETWORK_ERROR };
  }
}

function upsertProfile(list: ProfileView[], profile: ProfileView): ProfileView[] {
  return list.some((item) => item.id === profile.id)
    ? list.map((item) => (item.id === profile.id ? profile : item))
    : [...list, profile];
}

/**
 * Lista de perfis de integração e formulário de criação/edição (Configurações → Administração da integração).
 * Fica fora do fluxo diário do analista.
 */
export function IntegrationAdmin() {
  const [data, setData] = useState<AdminData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // null = formulário fechado; { profile: null } = criação; { profile } = edição.
  const [editor, setEditor] = useState<{ profile: ProfileView | null } | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [warnings, setWarnings] = useState<ProfileWarning[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void fetchAdmin().then((result) => {
      if (!active) return;
      if (result.data) {
        setData(result.data);
        setLoadError(null);
      } else {
        setLoadError(result.error ?? NETWORK_ERROR);
      }
    });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  function openEditor(profile: ProfileView | null): void {
    setEditor({ profile });
    setFormKey((key) => key + 1);
    setNotice(null);
    setWarnings([]);
  }

  function handleSaved(profile: ProfileView, saved: ProfileWarning[]): void {
    setData((previous) => (previous ? { ...previous, profiles: upsertProfile(previous.profiles, profile) } : previous));
    // Após criar, o formulário passa para a edição do perfil salvo, com o endereço de redirecionamento visível.
    setEditor({ profile });
    setFormKey((key) => key + 1);
    setWarnings(saved);
    setNotice({ tone: 'success', message: 'Perfil salvo.' });
  }

  async function removeProfile(profile: ProfileView): Promise<void> {
    const confirmed = window.confirm(
      `Remover o perfil de integração "${profile.name}"? As instâncias cobertas por ele deixarão de autenticar até que outro perfil seja cadastrado.`,
    );
    if (!confirmed) return;
    setBusyId(profile.id);
    setNotice(null);
    setWarnings([]);
    try {
      const response = await fetch(`/api/admin/integration-profiles/${profile.id}`, {
        method: 'DELETE',
        cache: 'no-store',
      });
      if (!response.ok) {
        setNotice({ tone: 'danger', message: await readApiError(response, 'Não foi possível remover o perfil.') });
        return;
      }
      setData((previous) =>
        previous ? { ...previous, profiles: previous.profiles.filter((item) => item.id !== profile.id) } : previous,
      );
      setEditor((current) => (current?.profile?.id === profile.id ? null : current));
      setNotice({ tone: 'success', message: `Perfil "${profile.name}" removido.` });
    } catch {
      setNotice({ tone: 'danger', message: NETWORK_ERROR });
    } finally {
      setBusyId(null);
    }
  }

  if (!data) {
    return loadError ? (
      <div className="flex flex-col items-start gap-2" data-testid="integration-admin-error">
        <p role="alert" className="break-words text-sm text-danger">
          {loadError}
        </p>
        <Button variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
          <RefreshCw />
          Tentar novamente
        </Button>
      </div>
    ) : (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        Carregando perfis de integração…
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="integration-admin">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-muted-foreground">
          {data.profiles.length === 0
            ? 'Nenhum perfil cadastrado. Sem perfil, o analista verá "Configuração administrativa ausente" ao conectar.'
            : `${data.profiles.length} perfil(is) cadastrado(s).`}
        </p>
        {editor === null && (
          <Button onClick={() => openEditor(null)} data-testid="integration-admin-new">
            <Plus />
            Novo perfil de integração
          </Button>
        )}
      </div>

      {data.profiles.length > 0 && (
        <ul className="flex min-w-0 flex-col gap-2" aria-label="Perfis de integração cadastrados">
          {data.profiles.map((profile) => (
            <li
              key={profile.id}
              className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
              data-testid="integration-profile-row"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold text-foreground">{profile.name}</p>
                <p className="break-all text-xs text-muted-foreground">{profile.org_url}</p>
                <p className="break-all text-xs text-muted-foreground">
                  Domínios: {profile.freshservice_domains.join(', ') || '—'}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Badge tone={profile.has_secret ? 'success' : 'warning'}>
                    {profile.has_secret ? 'Segredo cadastrado' : 'Sem segredo'}
                  </Badge>
                  <Badge tone="neutral">{profile.scopes.length} escopo(s)</Badge>
                  {profile.allow_manage_scopes && <Badge tone="warning">.manage permitido</Badge>}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEditor(profile)}
                  disabled={busyId !== null}
                  aria-label={`Editar perfil ${profile.name}`}
                >
                  <Pencil />
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void removeProfile(profile)}
                  disabled={busyId !== null}
                  aria-label={`Remover perfil ${profile.name}`}
                >
                  {busyId === profile.id ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                  Remover
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {notice && (
        <p
          role={notice.tone === 'danger' ? 'alert' : 'status'}
          className={cn('break-words text-sm', notice.tone === 'danger' ? 'text-danger' : 'text-success')}
        >
          {notice.message}
        </p>
      )}

      {warnings.length > 0 && (
        <div
          role="status"
          className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-foreground"
          data-testid="integration-profile-warnings"
        >
          <p className="font-medium">Avisos do perfil</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`} className="break-words">
                {warning.message}
                {warning.scopes.length > 0 && (
                  <span className="mt-0.5 block break-all font-mono text-xs text-muted-foreground">
                    {warning.scopes.join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {editor && (
        <IntegrationProfileForm
          key={formKey}
          profile={editor.profile}
          options={data}
          onSaved={handleSaved}
          onCancel={() => setEditor(null)}
        />
      )}
    </div>
  );
}
