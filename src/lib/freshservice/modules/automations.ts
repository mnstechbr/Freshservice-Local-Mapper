import { type ModuleAdapter, unsupportedAdapter } from './types';

/** Sem endpoint GET de workflows/automações no índice consultado. Não é presumido (regra do projeto). */
export const automationAdapters: ModuleAdapter[] = [
  unsupportedAdapter({
    key: 'automations.workflows',
    moduleGroup: 'automations',
    name: 'Automações e workflows',
    path: '(nenhum caminho documentado)',
    docNote:
      'Nenhum endpoint GET de workflows ou automações encontrado na documentação consultada. Não presumido.',
  }),
];
