/**
 * Hook de inicialização do Next (um vez por processo). Único motivo deste arquivo: registrar no log
 * que o simulador está ativo (FSLM_SIMULATOR=1). Não altera nada quando a variável não existe.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { logSimulatorStatus } = await import('./lib/simulator/startup');
  logSimulatorStatus();
}
