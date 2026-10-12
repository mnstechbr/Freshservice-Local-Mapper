'use client';
import { useEffect, useRef, useState } from 'react';

/** Documento no host do callback: a próxima navegação tem origem correta para o cookie de state.
 * A passagem fica no fragmento, é apagada antes de usar e nunca aceita destinos fornecidos pela URL.
 */
export default function OAuthStartPage() {
  const started = useRef(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const ticket = window.location.hash.slice(1);
    window.history.replaceState(null, '', '/auth/iniciar');
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket)) {
      setError(true);
      return;
    }
    window.location.replace(`/api/auth/oauth/start?launch=${encodeURIComponent(ticket)}`);
  }, []);
  return <main><p>{error ? 'Abra o painel e clique em Conectar novamente.' : 'Iniciando autorização…'}</p></main>;
}
