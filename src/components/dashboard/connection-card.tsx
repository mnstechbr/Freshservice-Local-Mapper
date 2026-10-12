'use client';

import {
  Activity,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  ExternalLink,
  Info,
  Link2,
  LoaderCircle,
  Lock,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
  Unplug,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ExitDemoButton } from '@/components/demo/exit-demo-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { readApiError } from '@/lib/ui/api-error';
import {
  canOpenAuthWindow,
  normalizeBaseUrl,
  PREFLIGHT_DEBOUNCE_MS,
  type PreflightView,
  preflightPath,
} from '@/lib/ui/auth-preflight';
import { connectionStatusInfo, isConnected, type Tone } from '@/lib/ui/status';
import { cn } from '@/lib/utils';

/** Forma de GET /api/connection/status (StatusView). Nunca contém segredos nem tokens. */
interface ConnectionView {
  status: string;
  message: string;
  account_label: string | null;
  instance: { id: number; display_name: string; origin: string } | null;
  profile: { id: number; name: string } | null;
  oauth_configured: boolean;
  last_error: string | null;
}

interface FlowLink {
  href: string;
  label: string;
  external?: boolean;
}

/** Aviso exibido abaixo do formulário: erro de ação, configuração ausente, sucesso ou tempo esgotado. */
interface Flow {
  tone: 'danger' | 'warning' | 'success';
  message: string;
  link?: FlowLink;
  /** Impede a conexão até uma ação externa (perfil ausente, host errado): anunciado como alerta. */
  blocking?: boolean;
}

/** Espera pela autorização: início (para o limite de 10 min) e estado antes do clique (para detectar mudança). */
interface Awaiting {
  startedAt: number;
  baseline: string | null;
}

type ActionKey = 'test' | 'disconnect' | 'connect';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
/** Canal usado pelo /auth/concluido para avisar que a autorização terminou. */
const AUTH_CHANNEL = 'fslm-auth';
const POLL_INTERVAL_MS = 2000;
const AWAIT_LIMIT_MS = 10 * 60 * 1000;
/** Estados em que a autorização ainda não terminou. Qualquer outro estado encerra a espera. */
const PENDING_STATUSES = new Set(['disconnected', 'awaiting_authorization', 'awaiting_authentication']);
const SETTINGS_ADMIN_HREF = '/configuracoes#administracao-integracao';
const IDENTITY_MISSING = 'Identidade não informada pelo provedor';
const NETWORK_ERROR = 'Não foi possível falar com o aplicativo local. Verifique se ele continua em execução.';
const POPUP_BLOCKED = 'O navegador bloqueou a janela de autorização. Use o link abaixo para abri-la.';
const URL_INVALID = 'Informe um link válido do Freshservice, por exemplo https://cliente.freshservice.com.';
const TIMEOUT_MESSAGE =
  'A autorização não foi concluída em 10 minutos. Clique em Conectar conta autenticada para tentar de novo.';

const FLOW_STYLE: Record<Flow['tone'], string> = {
  danger: 'border-danger/30 bg-danger-soft',
  warning: 'border-warning/30 bg-warning-soft',
  success: 'border-success/30 bg-success-soft',
};

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-muted-foreground',
  info: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  orange: 'text-orange-text',
};

/** Ícone por estado (apenas Lucide). Estados desconhecidos usam o ícone neutro. */
function statusIcon(status: string): LucideIcon {
  switch (status) {
    case 'connected':
      return CircleCheck;
    case 'awaiting_authorization':
      return LoaderCircle;
    case 'awaiting_authentication':
    case 'session_expired':
      return Clock;
    case 'admin_config_missing':
      return Settings;
    case 'no_permission':
      return ShieldX;
    case 'insufficient_scope':
      return ShieldAlert;
    case 'authorization_denied':
      return CircleX;
    case 'connection_error':
      return TriangleAlert;
    case 'demo':
      return Info;
    case 'disconnected':
      return CircleDashed;
    default:
      return CircleAlert;
  }
}

/** Pré-verificação de um link digitado (não grava nada). Falha de rede ou link recusado devolve null: não cacheia. */
async function fetchPreflightForUrl(target: string): Promise<PreflightView | null> {
  try {
    const response = await fetch(preflightPath(target), { cache: 'no-store' });
    return response.ok ? ((await response.json()) as PreflightView) : null;
  } catch {
    return null;
  }
}

async function fetchStatus(): Promise<{ data?: ConnectionView; error?: string }> {
  try {
    const response = await fetch('/api/connection/status', { cache: 'no-store' });
    if (!response.ok) return { error: await readApiError(response, 'Não foi possível verificar a conexão.') };
    return { data: (await response.json()) as ConnectionView };
  } catch {
    return { error: NETWORK_ERROR };
  }
}

/** Leva a janela já aberta ao endereço de autorização. Se falhar, fecha a janela e devolve false. */
function openAuthWindow(popup: Window, url: string): boolean {
  try {
    popup.opener = null;
    popup.location.href = url;
    return true;
  } catch {
    popup.close();
    return false;
  }
}

function adminMissingFlow(message: string): Flow {
  return {
    tone: 'warning',
    message,
    link: { href: SETTINGS_ADMIN_HREF, label: 'Abrir Configurações → Administração da integração' },
    blocking: true,
  };
}

/** Instância demonstrativa: nunca aparece como conectada e as ações reais ficam desabilitadas. */
export function ConnectionCard({ initialBaseUrl, isDemo = false }: { initialBaseUrl: string; isDemo?: boolean }) {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [view, setView] = useState<ConnectionView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ActionKey | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [awaiting, setAwaiting] = useState<Awaiting | null>(null);
  const [authLink, setAuthLink] = useState<string | null>(null);
  /** Última pré-verificação de cada link normalizado. Decide se a aba pode abrir antes do salvamento. */
  const preflightCache = useRef(new Map<string, PreflightView>());

  async function refreshStatus(): Promise<ConnectionView | null> {
    const result = await fetchStatus();
    if (result.data) {
      setView(result.data);
      setLoadError(null);
      return result.data;
    }
    setLoadError(result.error ?? NETWORK_ERROR);
    return null;
  }

  // Recarrega ao trocar a instância no servidor (ex.: remover a demonstração faz router.refresh com novos props).
  useEffect(() => {
    let active = true;
    void fetchStatus().then((result) => {
      if (!active) return;
      if (result.data) {
        setView(result.data);
        setLoadError(null);
      } else {
        setLoadError(result.error ?? NETWORK_ERROR);
      }
    });
    return () => {
      active = false;
    };
  }, [initialBaseUrl, isDemo]);

  // Retorno com ?conn= (callback que terminou nesta aba): o parâmetro sai da URL e o estado vem do servidor.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('conn')) return;
    url.searchParams.delete('conn');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    void fetchStatus().then((result) => {
      if (result.data) {
        setView(result.data);
        setLoadError(null);
        if (result.data.status === 'connected') setFlow({ tone: 'success', message: 'Autorização concluída. Conta conectada.' });
      } else {
        setLoadError(result.error ?? NETWORK_ERROR);
      }
    });
  }, []);

  // Pré-verifica o link digitado após a pausa de digitação e de novo ao voltar o foco (o admin pode ter cadastrado o perfil).
  useEffect(() => {
    const target = normalizeBaseUrl(baseUrl);
    if (!target || isDemo) return;
    const refresh = () => {
      void fetchPreflightForUrl(target).then((result) => {
        if (result) preflightCache.current.set(target, result);
      });
    };
    const timer = window.setTimeout(refresh, PREFLIGHT_DEBOUNCE_MS);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [baseUrl, isDemo]);

  // Espera pela autorização: sinal do BroadcastChannel, verificação a cada 2 s e ao voltar o foco, até 10 min.
  useEffect(() => {
    if (!awaiting) return;
    let active = true;
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(AUTH_CHANNEL) : null;

    async function check(fromSignal: boolean): Promise<void> {
      const result = await fetchStatus();
      if (!active) return;
      if (!result.data) {
        setLoadError(result.error ?? NETWORK_ERROR);
        return;
      }
      const next = result.data;
      setView(next);
      setLoadError(null);
      // Com o mesmo estado de antes (ex.: reconexão), só o sinal do callback encerra a espera.
      const finished = !PENDING_STATUSES.has(next.status) && (fromSignal || next.status !== awaiting?.baseline);
      if (finished) {
        setAwaiting(null);
        setFlow(next.status === 'connected' ? { tone: 'success', message: 'Autorização concluída. Conta conectada.' } : null);
        router.refresh();
      } else if (awaiting && Date.now() - awaiting.startedAt >= AWAIT_LIMIT_MS) {
        setAwaiting(null);
        setFlow({ tone: 'warning', message: TIMEOUT_MESSAGE });
      }
    }

    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        if ((event.data as { type?: unknown } | null)?.type === 'auth-complete') void check(true);
      };
    }
    const onFocus = () => void check(false);
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => void check(false), POLL_INTERVAL_MS);
    void check(false);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      channel?.close();
    };
  }, [awaiting, router]);

  /**
   * Fluxo do botão: valida o link, salva a instância, confere o perfil e só então abre a autorização.
   * A aba só é aberta antes da checagem (de forma síncrona no clique, evitando o bloqueio de pop-up) quando a
   * última pré-verificação deste link já estava pronta. Caso contrário nenhuma aba abre antes da checagem:
   * perfil ausente não abre aba; perfil pronto abre a aba depois e, se bloqueada, o link "use este link" serve.
   */
  async function connect(): Promise<void> {
    const target = normalizeBaseUrl(baseUrl);
    if (!target) {
      setFlow({ tone: 'danger', message: URL_INVALID });
      return;
    }
    setBusy('connect');
    setFlow(null);
    setAuthLink(null);
    const baseline = view?.status ?? null;
    const cached = preflightCache.current.get(target);
    const preOpen = cached !== undefined && canOpenAuthWindow(cached, window.location.hostname);
    const popup = preOpen ? window.open('about:blank', '_blank') : null;
    try {
      const saved = await fetch('/api/instances', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ base_url: target }),
      });
      if (!saved.ok) {
        popup?.close();
        setFlow({ tone: 'danger', message: await readApiError(saved, 'Não foi possível salvar o link do cliente.') });
        return;
      }
      const preResponse = await fetch('/api/auth/oauth/preflight', { cache: 'no-store' });
      if (!preResponse.ok) {
        popup?.close();
        setFlow({
          tone: 'danger',
          message: await readApiError(preResponse, 'Não foi possível verificar a configuração de autenticação.'),
        });
        return;
      }
      const pre = (await preResponse.json()) as PreflightView;
      if (!pre.ready || !pre.start_url || !pre.redirect_host || !pre.app_url) {
        popup?.close();
        setFlow(
          pre.status === 'admin_config_missing'
            ? adminMissingFlow(pre.message)
            : { tone: 'danger', message: pre.message || NETWORK_ERROR },
        );
        await refreshStatus();
        return;
      }
      // POST com Origin local emite uma passagem de uso único para o host do callback.
      const launchResponse = await fetch('/api/auth/oauth/launch', { method: 'POST', headers: JSON_HEADERS });
      if (!launchResponse.ok) {
        popup?.close();
        setFlow({ tone: 'danger', message: await readApiError(launchResponse, NETWORK_ERROR) });
        return;
      }
      const { launch_url: launchUrl } = await launchResponse.json() as { launch_url: string };
      setAuthLink(launchUrl);
      if (popup) {
        if (!openAuthWindow(popup, launchUrl)) {
          setFlow({ tone: 'warning', message: 'Não foi possível abrir a janela de autorização. Use o link abaixo.' });
        }
      } else {
        // Sem aba antecipada: abre agora. Se o navegador bloquear, o link "use este link" fica disponível.
        const opened = window.open(launchUrl, '_blank');
        if (opened) {
          try {
            opened.opener = null;
          } catch {
            // Janela fora da origem do painel: a referência fica como está.
          }
        } else {
          setFlow({ tone: 'warning', message: POPUP_BLOCKED });
        }
      }
      setAwaiting({ startedAt: Date.now(), baseline });
      await refreshStatus();
      router.refresh();
    } catch {
      popup?.close();
      setFlow({ tone: 'danger', message: NETWORK_ERROR });
    } finally {
      setBusy(null);
    }
  }

  async function runAction(key: Exclude<ActionKey, 'connect'>, url: string, fallback: string): Promise<void> {
    setBusy(key);
    setFlow(null);
    try {
      const response = await fetch(url, { method: 'POST', cache: 'no-store' });
      if (!response.ok) {
        setFlow({ tone: 'danger', message: await readApiError(response, fallback) });
        return;
      }
      await refreshStatus();
      router.refresh();
    } catch {
      setFlow({ tone: 'danger', message: NETWORK_ERROR });
    } finally {
      setBusy(null);
    }
  }

  function disconnect(): void {
    if (window.confirm('Desconectar a conta deste Freshservice?')) {
      setAwaiting(null);
      setAuthLink(null);
      void runAction('disconnect', '/api/connection/disconnect', 'Não foi possível desconectar.');
    }
  }

  const hasInstance = view?.instance != null;
  const connected = hasInstance && isConnected(view?.status);
  const waiting = awaiting !== null;
  const actionsDisabled = busy !== null || !hasInstance || isDemo;

  let pill: { label: string; tone: Tone };
  if (isDemo) pill = { label: 'Demonstração', tone: 'warning' };
  else if (!view) pill = loadError ? { label: 'indisponível', tone: 'danger' } : { label: 'Verificando…', tone: 'neutral' };
  else if (!hasInstance) pill = { label: 'Nenhuma instância configurada', tone: 'neutral' };
  else if (waiting && PENDING_STATUSES.has(view.status)) pill = connectionStatusInfo('awaiting_authorization');
  else pill = connectionStatusInfo(view.status);

  const StatusIcon = view ? statusIcon(view.status) : CircleDashed;
  const showServerMessage = !isDemo && hasInstance && view !== null && flow === null && !connected;
  const adminMissing = !isDemo && view?.status === 'admin_config_missing';
  const urlInvalid = flow?.message === URL_INVALID;
  const FlowIcon = flow?.tone === 'success' ? CircleCheck : CircleAlert;

  return (
    <Card aria-labelledby="connection-title" className="p-3" data-testid="connection-card">
      <CardTitle icon={<Link2 />}>
        <span id="connection-title">Conexão com o Freshservice</span>
      </CardTitle>

      <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="base-url" className="mb-1 block text-sm font-medium text-foreground">
            Link do Freshservice do cliente
          </label>
          <Input
            id="base-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            className="h-9"
            placeholder="https://cliente.freshservice.com"
            disabled={isDemo}
            value={baseUrl}
            aria-invalid={urlInvalid || undefined}
            onChange={(event) => setBaseUrl(event.target.value)}
            data-testid="connection-base-url"
          />
        </div>

        <div className="flex flex-col gap-1 lg:items-center">
          <Button
            onClick={() => void connect()}
            disabled={busy !== null || baseUrl.trim() === '' || isDemo}
            title={isDemo ? 'Modo demonstrativo' : undefined}
            aria-describedby="connect-hint"
            className="h-9 w-full lg:w-auto"
            data-testid="connection-connect"
          >
            {busy === 'connect' ? <LoaderCircle className="animate-spin" /> : <Link2 />}
            Conectar conta autenticada
          </Button>
          <span id="connect-hint" className="text-center text-xs text-muted-foreground">
            abre em outra aba
          </span>
        </div>

        <Badge
          tone={pill.tone}
          size="lg"
          role="status"
          aria-live="polite"
          className="max-w-full self-start lg:self-end"
          data-testid="connection-status"
        >
          <span className="size-2.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
          <span className="min-w-0 truncate">Status: {pill.label}</span>
        </Badge>
      </div>

      {showServerMessage && view && (
        <p className="mt-3 flex min-w-0 items-start gap-2 text-sm text-foreground" aria-live="polite" data-testid="connection-message">
          <StatusIcon className={cn('mt-0.5 size-4 shrink-0', TONE_TEXT[pill.tone])} aria-hidden="true" />
          <span className="min-w-0 break-words">{view.message}</span>
        </p>
      )}

      {connected && view && (
        <dl className="mt-3 flex min-w-0 flex-wrap gap-x-6 gap-y-1 text-sm" data-testid="connection-identity">
          <div className="flex min-w-0 gap-1.5">
            <dt className="text-muted-foreground">Conta:</dt>
            <dd className="min-w-0 break-words font-medium text-foreground">{view.account_label ?? IDENTITY_MISSING}</dd>
          </div>
          {view.profile && (
            <div className="flex min-w-0 gap-1.5">
              <dt className="text-muted-foreground">Perfil de integração:</dt>
              <dd className="min-w-0 break-words font-medium text-foreground">{view.profile.name}</dd>
            </div>
          )}
        </dl>
      )}

      {waiting && (
        <div
          className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-sm text-foreground"
          aria-live="polite"
          data-testid="connection-waiting"
        >
          <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
          <span className="min-w-0 break-words">
            Aguardando autorização. Esta tela atualiza sozinha quando a autorização terminar.
          </span>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAwaiting(null)}>
            Parar de aguardar
          </Button>
        </div>
      )}

      {waiting && authLink && (
        <p className="mt-2 text-sm text-muted-foreground">
          Se a janela de autorização não abrir,{' '}
          <a
            href={authLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
            data-testid="connection-auth-link"
          >
            use este link
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
          .
        </p>
      )}

      {flow && (
        <div
          role={flow.tone === 'danger' || flow.blocking ? 'alert' : undefined}
          aria-live={flow.tone === 'danger' || flow.blocking ? undefined : 'polite'}
          className={cn('mt-3 flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2 text-sm text-foreground', FLOW_STYLE[flow.tone])}
          data-testid="connection-flow"
        >
          <FlowIcon className={cn('mt-0.5 size-4 shrink-0', TONE_TEXT[flow.tone])} aria-hidden="true" />
          <div className="min-w-0 break-words">
            <p>{flow.message}</p>
            {flow.link &&
              (flow.link.external ? (
                <a
                  href={flow.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex max-w-full items-center gap-1 break-all font-medium text-primary underline underline-offset-2"
                >
                  {flow.link.label}
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                </a>
              ) : (
                <Link
                  href={flow.link.href}
                  className="mt-1 inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
                  data-testid="connection-admin-link"
                >
                  {flow.link.label}
                </Link>
              ))}
          </div>
        </div>
      )}

      {adminMissing && flow?.link === undefined && (
        <p className="mt-2 text-sm text-muted-foreground">
          Quem administra a integração cadastra o perfil uma única vez em{' '}
          <Link
            href={SETTINGS_ADMIN_HREF}
            className="font-medium text-primary underline underline-offset-2"
            data-testid="connection-admin-link"
          >
            Configurações → Administração da integração
          </Link>
          . O analista não precisa preencher nada aqui.
        </p>
      )}

      {view && !connected && view.last_error && view.last_error !== view.message && flow === null && (
        <p className="mt-2 break-words text-sm text-danger">{view.last_error}</p>
      )}

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
            Todas as chamadas API saem do usuário autenticado
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-4 shrink-0" aria-hidden="true" />
            Dados armazenados apenas localmente
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={actionsDisabled}
            onClick={() => void runAction('test', '/api/connection/test', 'Não foi possível testar a conexão.')}
            data-testid="connection-test"
          >
            {busy === 'test' ? <LoaderCircle className="animate-spin" /> : <Activity />}
            Testar conexão
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={actionsDisabled}
            onClick={disconnect}
            data-testid="connection-disconnect"
          >
            {busy === 'disconnect' ? <LoaderCircle className="animate-spin" /> : <Unplug />}
            Desconectar
          </Button>
          {isDemo && <ExitDemoButton tone="card" />}
        </div>
      </div>
    </Card>
  );
}
