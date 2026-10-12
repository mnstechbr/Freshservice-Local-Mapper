import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { isSimulatorEnabled } from '@/lib/simulator/config';
import { FIXTURE } from '@/lib/simulator/fixtures';
import { checkAuthorize, liveFlow, SSO_COOKIE, startFlow } from '@/lib/simulator/provider';
import { simState } from '@/lib/simulator/state';

export const dynamic = 'force-dynamic';

/**
 * Os formulários (login, MFA, consentimento) são POST de navegação. Com Referrer-Policy no-referrer (global,
 * src/lib/security/headers.ts) o navegador envia Origin "null" e o guarda local recusa (forbidden_origin).
 * same-origin só afeta a própria página do simulador; a política global não muda.
 */
export const metadata: Metadata = { referrer: 'same-origin' };

type Search = Promise<Record<string, string | string[] | undefined>>;

const pageStyle = { fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '32px auto', padding: 16 } as const;

function ErrorView({ message }: { message: string }) {
  return (
    <main style={pageStyle}>
      <h1 data-testid="sim-error">{message}</h1>
      <p>Simulador: nenhum redirecionamento foi feito.</p>
    </main>
  );
}

export default async function AuthorizePage({ searchParams }: { searchParams: Search }) {
  if (!isSimulatorEnabled()) notFound();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') query.set(key, value);
  }

  const flowId = query.get('flow');
  if (flowId === null) {
    const check = checkAuthorize(query);
    if (check.kind === 'fatal') return <ErrorView message={check.message} />;
    if (check.kind === 'redirect') {
      const url = new URL(check.redirectUri);
      if (check.state !== null) url.searchParams.set('state', check.state);
      url.searchParams.set('error', check.error);
      redirect(url.toString());
    }
    const flow = startFlow(check.params, (await cookies()).get(SSO_COOKIE)?.value);
    redirect(`/simulador/oauth/authorize?flow=${encodeURIComponent(flow.id)}`);
  }

  const flow = liveFlow(flowId);
  if (!flow) return <ErrorView message="Fluxo expirado ou inexistente. Inicie a autorização novamente." />;
  const st = simState();
  const app = st.apps.get(flow.params.clientId);
  const user = st.users.find((candidate) => candidate.id === flow.userId);
  const errorText =
    flow.error === 'credenciais' ? 'Email ou senha fictícios incorretos.'
      : flow.error === 'mfa' ? 'Código de verificação incorreto.'
        : null;
  const action = '/simulador/oauth/authorize/step';

  return (
    <main style={pageStyle}>
      <h1>Autorização do aplicativo (simulada)</h1>
      <p>Esta tela é do SIMULADOR. Não é o login da Freshworks.</p>
      {errorText && <p role="alert" data-testid="sim-step-error">{errorText}</p>}

      {flow.step === 'login' && (
        <form method="post" action={action} data-testid="sim-login-form">
          <input type="hidden" name="flow" value={flow.id} />
          <input type="hidden" name="step" value="login" />
          <p data-testid="sim-credentials-hint">
            Usuário fictício: {FIXTURE.userEmail}<br />Senha fictícia: {FIXTURE.userPassword}
          </p>
          <label>Email <input name="email" type="email" required data-testid="sim-email" /></label>
          <br />
          <label>Senha <input name="password" type="password" required data-testid="sim-password" /></label>
          <br />
          <button type="submit" data-testid="sim-login-submit">Entrar</button>
        </form>
      )}

      {flow.step === 'mfa' && (
        <form method="post" action={action} data-testid="sim-mfa-form">
          <input type="hidden" name="flow" value={flow.id} />
          <input type="hidden" name="step" value="mfa" />
          <p>Código de verificação simulado: <strong data-testid="sim-mfa-code">{user?.mfaCode}</strong></p>
          <label>Código <input name="code" inputMode="numeric" required data-testid="sim-mfa-input" /></label>
          <br />
          <button type="submit" data-testid="sim-mfa-submit">Verificar</button>
        </form>
      )}

      {flow.step === 'consent' && app && (
        <form method="post" action={action} data-testid="sim-consent-form">
          <input type="hidden" name="flow" value={flow.id} />
          <input type="hidden" name="step" value="consent" />
          <p>
            Aplicativo <strong>{app.name}</strong> ({app.clientId}) pede acesso à conta fictícia de{' '}
            {user?.name ?? 'usuário'}:
          </p>
          <ul>
            {flow.params.scopes.map((scope) => <li key={scope}>{scope}</li>)}
          </ul>
          <button type="submit" name="decision" value="allow" data-testid="sim-allow">Autorizar</button>{' '}
          <button type="submit" name="decision" value="deny" data-testid="sim-deny">Negar</button>
        </form>
      )}
    </main>
  );
}
