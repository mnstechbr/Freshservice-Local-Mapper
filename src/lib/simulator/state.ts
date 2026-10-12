import 'server-only';
import { randomBytes } from 'node:crypto';
import { fixtureState, type SimState } from './fixtures';

/**
 * Estado do simulador: em memória, por processo. Guardado em globalThis porque o Next compila cada
 * rota com seu próprio módulo (sem isso, o authorize e o token veriam estados diferentes).
 */
interface SimulatorHolder {
  __fslmSimulatorState?: SimState;
}

export function simState(): SimState {
  const holder = globalThis as unknown as SimulatorHolder;
  holder.__fslmSimulatorState ??= fixtureState();
  return holder.__fslmSimulatorState;
}

/** Restaura fixtures, apagando apps, sessões, fluxos, códigos, tokens e dados alterados. */
export function resetSimState(): SimState {
  const holder = globalThis as unknown as SimulatorHolder;
  holder.__fslmSimulatorState = fixtureState();
  return holder.__fslmSimulatorState;
}

/** Token opaco aleatório. O prefixo deixa explícito que é do simulador. */
export function randomToken(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString('base64url')}`;
}
