'use client';

import { Check, Copy, LoaderCircle, ShieldAlert } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OAUTH_PATH_PREFIX_DEFAULT } from '@/lib/oauth-path';
import { readApiError } from '@/lib/ui/api-error';
import { cn } from '@/lib/utils';

/** Forma de um perfil em GET/POST/PUT /api/admin/integration-profiles. Nunca inclui o client_secret. */
export interface ProfileView {
  id: number;
  name: string;
  org_url: string;
  client_id: string;
  scopes: string[];
  path_prefix: string;
  token_path_prefix: string;
  redirect_host: string;
  redirect_uri: string;
  freshservice_domains: string[];
  allow_manage_scopes: boolean;
  has_secret: boolean;
}

export interface ProfileWarning {
  code: string;
  message: string;
  scopes: string[];
}

/** Listas que o servidor define (escopos padrão, hosts e prefixos aceitos). */
export interface ProfileOptions {
  default_scopes: string[];
  redirect_hosts: string[];
  path_prefixes: string[];
}

interface IntegrationProfileFormProps {
  /** null = criação. */
  profile: ProfileView | null;
  options: ProfileOptions;
  onSaved: (profile: ProfileView, warnings: ProfileWarning[]) => void;
  onCancel: () => void;
}

interface FormState {
  name: string;
  orgUrl: string;
  clientId: string;
  clientSecret: string;
  domains: string;
  scopeChecks: Record<string, boolean>;
  extraScopes: string;
  allowManage: boolean;
  pathPrefix: string;
  tokenPathPrefix: string;
  redirectHost: string;
}

/** Padrão do servidor para token_path_prefix (src/lib/auth/profiles.ts, TOKEN_PATH_PREFIX_DEFAULT). */
const TOKEN_PATH_PREFIX_DEFAULT = '';

/** Mesmo caminho de OAUTH_CALLBACK_PATH no servidor (prévia do endereço antes de salvar). */
const CALLBACK_PATH = '/api/auth/oauth/callback';
const NETWORK_ERROR = 'Não foi possível falar com o aplicativo local. Verifique se ele continua em execução.';
const CONTROL =
  'w-full min-w-0 rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-60';

/** Lista separada por quebra de linha, vírgula ou ponto e vírgula. Remove vazios e repetidos. */
export function parseList(text: string): string[] {
  return [...new Set(text.split(/[\n,;\s]+/).map((item) => item.trim()).filter((item) => item !== ''))];
}

function initialState(profile: ProfileView | null, options: ProfileOptions): FormState {
  const extra = profile ? profile.scopes.filter((scope) => !options.default_scopes.includes(scope)) : [];
  return {
    name: profile?.name ?? '',
    orgUrl: profile?.org_url ?? '',
    clientId: profile?.client_id ?? '',
    clientSecret: '',
    domains: profile?.freshservice_domains.join('\n') ?? '',
    scopeChecks: Object.fromEntries(
      options.default_scopes.map((scope) => [scope, profile ? profile.scopes.includes(scope) : true]),
    ),
    extraScopes: extra.join('\n'),
    allowManage: profile?.allow_manage_scopes ?? false,
    pathPrefix: profile?.path_prefix ?? OAUTH_PATH_PREFIX_DEFAULT,
    tokenPathPrefix: profile?.token_path_prefix ?? TOKEN_PATH_PREFIX_DEFAULT,
    redirectHost: profile?.redirect_host ?? 'localhost',
  };
}

function prefixLabel(value: string): string {
  return value === '' ? 'Sem prefixo (raiz)' : value;
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Criação e edição de um perfil de integração OAuth. O client_secret nunca é pré-preenchido. */
export function IntegrationProfileForm({ profile, options, onSaved, onCancel }: IntegrationProfileFormProps) {
  const [form, setForm] = useState<FormState>(() => initialState(profile, options));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const manageInExtra = parseList(form.extraScopes).filter((scope) => !scope.endsWith('.view'));
  const manageBlocked = manageInExtra.length > 0 && !form.allowManage;

  // Endereço exato que deve ser cadastrado no Portal do Desenvolvedor. Porta lida da própria aplicação.
  const port = typeof window === 'undefined' ? '' : window.location.port;
  const hostChanged = profile === null || form.redirectHost !== profile.redirect_host;
  const localRedirectUri = `http://${form.redirectHost}${port ? `:${port}` : ''}${CALLBACK_PATH}`;
  const redirectUri = profile !== null && !hostChanged ? profile.redirect_uri : localRedirectUri;

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function copyRedirectUri(): Promise<void> {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (manageBlocked) {
      setError('Os escopos fora de .view (.manage/.edit) digitados exigem marcar "Permitir escopos de gestão ou escrita" antes de salvar.');
      return;
    }
    const body = {
      name: form.name.trim(),
      org_url: form.orgUrl.trim(),
      client_id: form.clientId.trim(),
      // Em branco na edição = manter o segredo já guardado no cofre.
      client_secret: form.clientSecret,
      freshservice_domains: parseList(form.domains),
      scopes: [...options.default_scopes.filter((scope) => form.scopeChecks[scope]), ...parseList(form.extraScopes)],
      allow_manage_scopes: form.allowManage,
      path_prefix: form.pathPrefix,
      token_path_prefix: form.tokenPathPrefix,
      redirect_host: form.redirectHost,
    };
    setSaving(true);
    try {
      const response = await fetch(profile ? `/api/admin/integration-profiles/${profile.id}` : '/api/admin/integration-profiles', {
        method: profile ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      if (!response.ok) {
        setError(await readApiError(response, 'Não foi possível salvar o perfil de integração.'));
        return;
      }
      const result = (await response.json()) as { profile: ProfileView; warnings?: ProfileWarning[] };
      onSaved(result.profile, result.warnings ?? []);
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-labelledby="integration-profile-form-title"
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-4"
      data-testid="integration-profile-form"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 id="integration-profile-form-title" className="text-base font-semibold text-foreground">
          {profile !== null ? `Editar perfil: ${profile.name}` : 'Novo perfil de integração'}
        </h4>
        {profile !== null && (
          <Badge tone={profile.has_secret ? 'success' : 'warning'} data-testid="integration-profile-secret-badge">
            {profile.has_secret ? 'Segredo cadastrado' : 'Sem segredo cadastrado'}
          </Badge>
        )}
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <Field id="ip-name" label="Nome do perfil" hint="Ex.: ACME produção. Aparece na lista e no status da conexão.">
          <Input
            id="ip-name"
            name="name"
            className={CONTROL}
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            required
            autoComplete="off"
            aria-describedby="ip-name-hint"
          />
        </Field>

        <Field
          id="ip-org"
          label="URL da organização no Freshworks"
          hint="Não é derivada do domínio do Freshservice. Encontre-a no seletor de organizações (org switcher) do Freshworks, no formato https://sua-org.myfreshworks.com."
        >
          <Input
            id="ip-org"
            name="org_url"
            type="url"
            inputMode="url"
            className={CONTROL}
            placeholder="https://sua-org.myfreshworks.com"
            value={form.orgUrl}
            onChange={(event) => update('orgUrl', event.target.value)}
            required
            autoComplete="off"
            aria-describedby="ip-org-hint"
          />
        </Field>

        <Field id="ip-client-id" label="Client ID">
          <Input
            id="ip-client-id"
            name="client_id"
            className={CONTROL}
            value={form.clientId}
            onChange={(event) => update('clientId', event.target.value)}
            required
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <Field
          id="ip-client-secret"
          label="Client secret"
          hint={
            profile?.has_secret
              ? 'Já cadastrado e não exibido. Deixe em branco para manter.'
              : 'Obrigatório na criação. Fica no cofre local, nunca no banco nem na tela.'
          }
        >
          <Input
            id="ip-client-secret"
            name="client_secret"
            type="password"
            className={CONTROL}
            value={form.clientSecret}
            onChange={(event) => update('clientSecret', event.target.value)}
            required={profile === null}
            autoComplete="new-password"
            placeholder={profile?.has_secret ? '•••••••• (sem alteração)' : ''}
            aria-describedby="ip-client-secret-hint"
          />
        </Field>

        <Field id="ip-domains" label="Domínios do Freshservice" hint="Um por linha ou separados por vírgula, por exemplo acme.freshservice.com.">
          <textarea
            id="ip-domains"
            name="freshservice_domains"
            rows={2}
            className={cn(CONTROL, 'resize-y font-mono text-xs')}
            value={form.domains}
            onChange={(event) => update('domains', event.target.value)}
            required
            spellCheck={false}
            aria-describedby="ip-domains-hint"
          />
        </Field>

        <div className="grid min-w-0 gap-4">
          <Field
            id="ip-redirect-host"
            label="Host do redirecionamento"
            hint="localhost é o padrão documentado. Use 127.0.0.1 só se localhost não resolver neste computador."
          >
            <select
              id="ip-redirect-host"
              name="redirect_host"
              className={CONTROL}
              value={form.redirectHost}
              onChange={(event) => update('redirectHost', event.target.value)}
              aria-describedby="ip-redirect-host-hint"
            >
              {options.redirect_hosts.map((host) => (
                <option key={host} value={host}>
                  {host}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {/* Endpoints OAuth: fechado por padrão e fora do fluxo do analista (só a administração usa este formulário). */}
      <details className="min-w-0 rounded-lg border border-border p-3" data-testid="integration-profile-advanced">
        <summary className="cursor-pointer text-sm font-medium text-foreground">Avançado (endpoints)</summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Altere só com orientação do responsável pela integração. Referência: documentação oficial Freshworks, &quot;Implement
          OAuth authorization flow in external apps&quot;, etapas &quot;Place authorization-code request&quot; e &quot;Place
          access-token request&quot;.
        </p>
        <div className="mt-3 grid min-w-0 gap-4 sm:grid-cols-2">
          <Field
            id="ip-path-prefix"
            label="Prefixo do caminho de autorização"
            hint="Padrão /org, como nos exemplos da documentação. Sem prefixo, o caminho é /oauth/v2/authorize."
          >
            <select
              id="ip-path-prefix"
              name="path_prefix"
              className={CONTROL}
              value={form.pathPrefix}
              onChange={(event) => update('pathPrefix', event.target.value)}
              aria-describedby="ip-path-prefix-hint"
            >
              {options.path_prefixes.map((value) => (
                <option key={value || 'raiz'} value={value}>
                  {prefixLabel(value)}
                </option>
              ))}
            </select>
          </Field>

          <Field
            id="ip-token-path-prefix"
            label="Prefixo do caminho do token"
            hint="Padrão sem prefixo: /oauth/v2/token, como no texto da documentação. Os exemplos da mesma página usam /org/oauth/v2/token; escolha /org só se o responsável indicar."
          >
            <select
              id="ip-token-path-prefix"
              name="token_path_prefix"
              className={CONTROL}
              value={form.tokenPathPrefix}
              onChange={(event) => update('tokenPathPrefix', event.target.value)}
              aria-describedby="ip-token-path-prefix-hint"
            >
              {options.path_prefixes.map((value) => (
                <option key={value || 'raiz'} value={value}>
                  {prefixLabel(value)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </details>

      <fieldset className="min-w-0 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium text-foreground">Escopos de leitura (padrão, pré-marcados)</legend>
        <p className="mb-2 text-xs text-muted-foreground">Somente leitura (.view). Desmarque os que não forem necessários.</p>
        <div className="grid max-h-56 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
          {options.default_scopes.map((scope) => (
            <label key={scope} className="flex min-w-0 items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                name="scopes"
                value={scope}
                className="size-4 shrink-0 accent-primary"
                checked={form.scopeChecks[scope] ?? false}
                onChange={(event) => update('scopeChecks', { ...form.scopeChecks, [scope]: event.target.checked })}
              />
              <span className="min-w-0 break-all font-mono">{scope}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field
        id="ip-extra-scopes"
        label="Escopos adicionais"
        hint="Um por linha ou separados por vírgula. Escopos fora de .view (.manage/.edit) só são aceitos com a permissão abaixo."
      >
        <textarea
          id="ip-extra-scopes"
          name="extra_scopes"
          rows={2}
          className={cn(CONTROL, 'resize-y font-mono text-xs')}
          value={form.extraScopes}
          onChange={(event) => update('extraScopes', event.target.value)}
          spellCheck={false}
          aria-describedby="ip-extra-scopes-hint"
        />
      </Field>
      {manageBlocked && (
        <p className="-mt-2 text-sm text-danger" role="alert">
          Há escopos fora de .view (.manage/.edit) digitados ({manageInExtra.join(', ')}). Marque a permissão abaixo para aceitá-los.
        </p>
      )}

      <div
        className={cn(
          'rounded-lg border p-3',
          form.allowManage ? 'border-warning/50 bg-warning-soft' : 'border-border bg-card',
        )}
      >
        <label className="flex min-w-0 items-start gap-2 text-sm text-foreground">
          <input
            id="ip-allow-manage"
            name="allow_manage_scopes"
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-warning"
            checked={form.allowManage}
            onChange={(event) => update('allowManage', event.target.checked)}
            aria-describedby="ip-allow-manage-hint"
            data-testid="integration-profile-allow-manage"
          />
          <span className="min-w-0 break-words font-medium">
            Permitir escopos de gestão ou escrita (.manage/.edit; podem conceder escrita)
          </span>
        </label>
        <p id="ip-allow-manage-hint" className="mt-2 flex items-start gap-1.5 text-xs text-warning">
          <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">
            Atenção: escopos fora de .view (.manage/.edit) podem conceder permissão de escrita no Freshservice. Marque somente com a autorização do cliente.
          </span>
        </p>
      </div>

      <div className="min-w-0 rounded-lg border border-border bg-secondary/40 p-3">
        <p className="text-sm font-medium text-foreground">Endereço de redirecionamento</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Cadastre exatamente este endereço no Portal do Desenvolvedor Freshworks.
          {hostChanged && ' Prévia: vale depois de salvar o perfil.'}
        </p>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
          <code
            className="min-w-0 flex-1 break-all rounded-md bg-card px-2 py-1.5 font-mono text-xs text-foreground"
            data-testid="integration-profile-redirect-uri"
          >
            {redirectUri}
          </code>
          <Button variant="outline" size="sm" onClick={() => void copyRedirectUri()} aria-label="Copiar endereço de redirecionamento">
            {copyState === 'copied' ? <Check /> : <Copy />}
            Copiar
          </Button>
        </div>
        <p aria-live="polite" className="mt-1 min-h-4 text-xs text-muted-foreground">
          {copyState === 'copied' && 'Endereço copiado.'}
          {copyState === 'failed' && 'Não foi possível copiar. Selecione o endereço e copie manualmente.'}
        </p>
      </div>

      {error && (
        <p role="alert" className="break-words text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving || manageBlocked} data-testid="integration-profile-save">
          {saving && <LoaderCircle className="animate-spin" />}
          {profile !== null ? 'Salvar alterações' : 'Criar perfil'}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
