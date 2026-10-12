'use client';

import { useEffect, useState } from 'react';

/** Mensagens curtas por estado de conexão (vindo de /api/auth/oauth/callback?conn=...). */
const MESSAGES: Record<string, string> = {
  connected: 'Conexão concluída. Pode voltar ao painel.',
  authorization_denied: 'A autorização foi negada no Freshworks. Nada foi conectado.',
  insufficient_scope: 'Escopo insuficiente: o perfil de integração não concede os escopos necessários.',
  no_permission: 'Sem permissão para a verificação. Confira o papel do agente que autorizou.',
  session_expired: 'Sessão expirada. Conecte de novo.',
  connection_error: 'Não foi possível concluir a conexão. Tente de novo depois.',
  error: 'Não foi possível concluir a autorização. Feche esta aba e tente de novo.',
};

/**
 * Página de conclusão do OAuth. Avisa o painel aberto por BroadcastChannel('fslm-auth') e tenta
 * fechar a aba. Não contém segredos nem dados da URL além do estado.
 */
export default function AuthDonePage() {
  const [conn, setConn] = useState('error');

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('conn') ?? 'error';
    const safe = /^[a-z_]{1,40}$/.test(raw) ? raw : 'error';
    // Cookies são host-only. Só a mensagem final segue para a origem do painel; nenhum segredo é transferido.
    if (window.location.hostname === 'localhost') {
      window.location.replace(`http://127.0.0.1:${window.location.port}/auth/concluido?conn=${encodeURIComponent(safe)}`);
      return;
    }
    setConn(safe);
    try {
      const channel = new BroadcastChannel('fslm-auth');
      channel.postMessage({ type: 'auth-complete', conn: safe });
      channel.close();
    } catch {
      // Navegador sem BroadcastChannel: o painel atualiza pelo polling de /api/connection/status.
    }
    const timer = window.setTimeout(() => window.close(), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main style={{ maxWidth: 560, margin: '48px auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20 }}>Autorização do Freshservice</h1>
      <p>{MESSAGES[conn] ?? MESSAGES.error}</p>
      <p>
        <a href="/">Voltar ao painel</a>
      </p>
    </main>
  );
}
