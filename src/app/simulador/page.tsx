import { notFound } from 'next/navigation';
import { isSimulatorEnabled } from '@/lib/simulator/config';

export default function SimuladorIndex() {
  if (!isSimulatorEnabled()) notFound();
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '32px auto', padding: 16 }}>
      <h1>Simulador local (OAuth e API v2 fictícios)</h1>
      <p>Autenticação e dados FICTÍCIOS para testes. Não é Freshworks nem Freshservice. Não há homologação real.</p>
      <ul>
        <li>Status: <code>GET /api/simulador/status</code></li>
        <li>Controle de teste: <code>POST /simulador/control</code> (JSON)</li>
      </ul>
    </main>
  );
}
