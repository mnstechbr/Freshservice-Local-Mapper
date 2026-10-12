export interface SecurityHeaderOptions {
  dev: boolean;
  port: number;
  /** Rotas /api: sem cache. */
  api: boolean;
}

/**
 * CSP restritiva: default-src e connect-src 'self', object-src 'none', frame-ancestors 'none'.
 * script-src e style-src recebem 'unsafe-inline' porque o App Router injeta scripts inline e
 * páginas estáticas não têm nonce (o nonce exige renderização dinâmica; ver docs/AUTH.md).
 * 'unsafe-eval' e o WebSocket do HMR só existem em dev.
 * Sem upgrade-insecure-requests: o app roda em http://127.0.0.1.
 */
export function buildContentSecurityPolicy(options: { dev: boolean; port: number }): string {
  const scriptSrc = ["'self'", "'unsafe-inline'", ...(options.dev ? ["'unsafe-eval'"] : [])];
  const connectSrc = [
    "'self'",
    ...(options.dev ? [`ws://127.0.0.1:${options.port}`, `ws://localhost:${options.port}`] : []),
  ];
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function applySecurityHeaders(headers: Headers, options: SecurityHeaderOptions): void {
  headers.set('Content-Security-Policy', buildContentSecurityPolicy(options));
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (options.api) headers.set('Cache-Control', 'no-store');
}
