import 'server-only';
import type { z } from 'zod';
import { UrlValidationError } from '../security/url';
import { AuthError } from './errors';

export const MAX_BODY_CHARS = 16 * 1024;

/** Resposta JSON sem cache. setCookie, quando presente, é enviado junto (fluxo OAuth). */
export function jsonResponse(body: unknown, status = 200, setCookie?: string): Response {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (setCookie) headers.append('Set-Cookie', setCookie);
  return Response.json(body, { status, headers });
}

/** Erro de validação de campos. Lista só os nomes dos campos, nunca os valores. */
export function invalidFields(error: z.ZodError): AuthError {
  const fields = [...new Set(error.issues.map((issue) => issue.path.join('.') || 'corpo'))];
  return new AuthError('invalid_input', 400, `Campos inválidos: ${fields.join(', ')}.`);
}

/** Lê o corpo como JSON. Exige application/json (um form cruzado não consegue enviar esse tipo). */
export async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new AuthError('unsupported_media', 415, 'Envie o corpo como application/json.');
  }
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) {
    throw new AuthError('invalid_input', 413, 'Corpo da requisição grande demais.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AuthError('invalid_input', 400, 'Corpo JSON inválido.');
  }
}

/** Converte qualquer erro em resposta. Erros inesperados não vazam detalhes. */
export function errorResponse(error: unknown): Response {
  if (error instanceof AuthError) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, error.httpStatus);
  }
  if (error instanceof UrlValidationError) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, 400);
  }
  console.error(
    '[fslm] Erro inesperado na API de conexão:',
    error instanceof Error ? error.name : typeof error,
  );
  return jsonResponse(
    { error: { code: 'internal_error', message: 'Erro interno. Veja o terminal do servidor.' } },
    500,
  );
}

/** Lê um cookie pelo nome, a partir do cabeçalho Cookie. */
export function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}
