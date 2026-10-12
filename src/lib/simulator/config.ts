/**
 * SIMULADOR LOCAL (não é Freshworks nem Freshservice). Ativo somente com FSLM_SIMULATOR=1 no runtime
 * do servidor. Sem a variável, nenhuma rota /simulador responde, os hosts simulados são recusados pelos
 * validadores de URL e nenhum caminho de código do simulador é alcançado.
 */
export function isSimulatorEnabled(): boolean {
  return process.env.FSLM_SIMULATOR === '1';
}

/** Hosts com TLD .invalid (RFC 6761): nunca resolvem na internet. Só valem com o simulador ligado. */
export const SIMULATOR_INSTANCE_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.freshservice\.simulador\.invalid$/;
export const SIMULATOR_ORG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myfreshworks\.simulador\.invalid$/;

export const SIMULATOR_BANNER_TEXT =
  'SIMULADOR — autenticação fictícia, não é Freshworks nem Freshservice. Nenhum dado real é usado.';
export const SIMULATOR_HEADER = { 'x-simulador': '1' } as const;

export function isSimulatorInstanceHost(hostname: string): boolean {
  return isSimulatorEnabled() && SIMULATOR_INSTANCE_RE.test(hostname.toLowerCase());
}

export function isSimulatorOrgHost(hostname: string): boolean {
  return isSimulatorEnabled() && SIMULATOR_ORG_RE.test(hostname.toLowerCase());
}

/** Host atendido em processo (sem socket e sem DNS). Único predicado usado pelos hooks de segurança. */
export function isSimulatedHost(hostname: string): boolean {
  return isSimulatorInstanceHost(hostname) || isSimulatorOrgHost(hostname);
}

/**
 * Hook do authorize: para organização simulada, devolve a página local do simulador (mesmo host do
 * redirect_uri, para o cookie de estado valer). Para qualquer outra organização devolve null.
 */
export function simulatorAuthorizeBase(orgOrigin: string, appOrigin: string): string | null {
  let host: string;
  try {
    host = new URL(orgOrigin).hostname;
  } catch {
    return null;
  }
  return isSimulatorOrgHost(host) ? `${appOrigin}/simulador/oauth/authorize` : null;
}
