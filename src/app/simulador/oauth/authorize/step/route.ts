import { isSimulatorEnabled, SIMULATOR_HEADER } from '@/lib/simulator/config';
import { decide, liveFlow, SSO_COOKIE, submitLogin, submitMfa } from '@/lib/simulator/provider';

export const dynamic = 'force-dynamic';

/** Passos do formulário do simulador (login, MFA, consentimento). Sempre 303; nunca redireciona para host externo. */
function see(location: string, setCookie?: string): Response {
  const headers: Record<string, string> = { location, ...SIMULATOR_HEADER };
  if (setCookie) headers['set-cookie'] = setCookie;
  return new Response(null, { status: 303, headers });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSimulatorEnabled()) return new Response(null, { status: 404 });
  const form = await request.formData();
  const flowId = String(form.get('flow') ?? '');
  const flow = liveFlow(flowId);
  if (!flow) return see(`/simulador/oauth/authorize?flow=${encodeURIComponent(flowId)}`);
  const back = `/simulador/oauth/authorize?flow=${encodeURIComponent(flow.id)}`;
  const step = form.get('step');

  if (step === 'login' && flow.step === 'login') {
    const sessionId = submitLogin(flow, String(form.get('email') ?? ''), String(form.get('password') ?? ''));
    const cookie = sessionId
      ? `${SSO_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`
      : undefined;
    return see(back, cookie);
  }
  if (step === 'mfa' && flow.step === 'mfa') {
    submitMfa(flow, String(form.get('code') ?? ''));
    return see(back);
  }
  if (step === 'consent' && flow.step === 'consent') {
    return see(decide(flow, form.get('decision') === 'allow'));
  }
  return see(back);
}
