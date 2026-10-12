export const UNAVAILABLE_MESSAGE = 'Esta ação ainda não está disponível nesta versão.';

/**
 * Mensagem amigável para respostas de erro da API. Um 404 significa rota ainda não implementada.
 * O texto vem do corpo {"error": {"message"}} ou {"error": "..."}, sempre sanitizado pelo servidor.
 */
export async function readApiError(response: Response, fallback: string): Promise<string> {
  if (response.status === 404) return UNAVAILABLE_MESSAGE;
  try {
    const body = (await response.json()) as { error?: unknown };
    const error = body.error;
    if (typeof error === 'string' && error) return error;
    if (typeof error === 'object' && error !== null) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message) return message;
    }
  } catch {
    // Corpo que não é JSON: usa a mensagem padrão abaixo.
  }
  return fallback;
}
