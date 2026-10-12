import type { NextConfig } from 'next';
import { parseEnv } from './src/lib/config/env';
import { localhostPageRedirectRule } from './src/lib/security/origin';

// Telemetria do Next.js: desativada por NEXT_TELEMETRY_DISABLED=1 nos scripts
// (build/start no package.json) e no processo filho de scripts/start-dev.mjs.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Next 16 gera AGENTS.md na raiz por padrão. Desativado: documentação não solicitada no repositório.
  agentRules: false,
  // better-sqlite3 é módulo nativo: deve ser carregado pelo Node, nunca empacotado pelo bundler.
  serverExternalPackages: ['better-sqlite3'],
  // Páginas em localhost:PORT vão para 127.0.0.1:PORT (ver localhostPageRedirectRule, D1).
  // A porta vem do ambiente no build/dev: deve ser a mesma no build e no start.
  async redirects() {
    const { PORT: port } = parseEnv(process.env);
    return [localhostPageRedirectRule(port)];
  },
};

export default nextConfig;
