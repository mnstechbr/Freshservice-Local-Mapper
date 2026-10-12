/**
 * Checagem simples de Origin para rotas que alteram estado local. Aceita somente a própria
 * aplicação, em 127.0.0.1 ou localhost, na mesma porta da requisição.
 */
export function isAllowedLocalOrigin(origin: string | null, port: string): boolean {
  if (!origin || !port) return false;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}
