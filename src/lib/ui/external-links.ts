/*
 * Link "Abrir no Freshservice". Função pura, testada em tests/ui/external-links.test.ts.
 * Só gera link se: instância real (não demo), base https sem credenciais e módulo com caminho conhecido.
 * Qualquer outro caso retorna null, e a página omite o link.
 */

/** Caminho da interface do Freshservice por módulo (após a origem). Módulos fora deste mapa não têm link. */
const UI_PATHS: ReadonlyMap<string, string> = new Map([
  ['tickets', '/helpdesk/tickets/'],
  ['assets', '/cmdb/items/'],
]);

/** Identificador externo numérico ou alfanumérico simples. Evita caminhos com barras ou espaços. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface ExternalLinkInput {
  baseUrl: string;
  isDemo: boolean;
  moduleKey: string;
  externalId: string;
}

export function freshserviceResourceUrl(input: ExternalLinkInput): string | null {
  if (input.isDemo) return null;
  const prefix = UI_PATHS.get(input.moduleKey);
  if (!prefix || !SAFE_ID.test(input.externalId)) return null;

  let base: URL;
  try {
    base = new URL(input.baseUrl);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' || base.username !== '' || base.password !== '') return null;

  // origin descarta qualquer caminho guardado na base; o identificador já passou pela validação.
  return `${base.origin}${prefix}${input.externalId}`;
}
