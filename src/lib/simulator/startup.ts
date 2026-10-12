import { isSimulatorEnabled } from './config';

/** Linha de log no startup. Nunca imprime segredos: só o fato de estar ativo e os hosts reservados. */
export function logSimulatorStatus(log: (line: string) => void = (line) => console.warn(line)): void {
  if (!isSimulatorEnabled()) return;
  log(
    '[simulador] ATIVO (FSLM_SIMULATOR=1): OAuth e API fictícios, NÃO são Freshworks nem Freshservice. ' +
      'Hosts reservados: *.freshservice.simulador.invalid e *.myfreshworks.simulador.invalid.',
  );
}
