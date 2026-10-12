import { makeAdapter, type ModuleAdapter } from './types';

/** Destaques do inventário de pessoas; nomes e IDs continuam disponíveis. */
const person = ['id', 'first_name', 'last_name', 'job_title', 'active', 'department_ids', 'group_ids', 'location_id', 'workspace_id'];
/**
 * Contato pessoal excluído permanentemente dos adaptadores e do raw_json.
 * sensitiveFields também permite a aplicação da política no momento da persistência.
 * Teste: tests/security/person-contact.test.ts.
 */
export const PERSON_SENSITIVE = ['primary_email', 'secondary_emails', 'work_phone_number', 'mobile_phone_number', 'address'];

export const usersGroupsAdapters: ModuleAdapter[] = [
  makeAdapter({
    key: 'users_groups.agents',
    listKey: 'agents',
    moduleGroup: 'users_groups',
    name: 'Agentes',
    path: '/api/v2/agents',
    paginated: true,
    docNote: 'Ação "List all Agents" no índice. Depende da permissão do agente conectado.',
    nameField: 'first_name',
    fields: person,
    contentFields: ['signature', 'background_information'],
    sensitiveFields: PERSON_SENSITIVE,
    excludeFields: PERSON_SENSITIVE,
    relationFields: { location_id: 'location' },
  }),
  makeAdapter({
    key: 'users_groups.requesters',
    listKey: 'requesters',
    moduleGroup: 'users_groups',
    name: 'Solicitantes',
    path: '/api/v2/requesters',
    paginated: true,
    docNote: 'Ação "List all Requesters" no índice. Depende da permissão do agente conectado.',
    nameField: 'first_name',
    fields: person,
    contentFields: ['signature', 'background_information'],
    sensitiveFields: PERSON_SENSITIVE,
    excludeFields: PERSON_SENSITIVE,
    relationFields: { location_id: 'location' },
  }),
  makeAdapter({
    key: 'users_groups.departments',
    listKey: 'departments',
    moduleGroup: 'users_groups',
    name: 'Departamentos',
    path: '/api/v2/departments',
    paginated: true,
    docNote: 'Ação "List all Departments" no índice.',
    fields: ['id', 'name', 'description', 'head_user_id', 'prime_user_id'],
    contentFields: ['description'],
  }),
  makeAdapter({
    key: 'users_groups.agent_groups',
    listKey: 'groups',
    moduleGroup: 'users_groups',
    name: 'Grupos de agentes',
    path: '/api/v2/groups',
    paginated: true,
    docNote: 'Ação "List all Groups" no índice.',
    fields: ['id', 'name', 'description', 'workspace_id', 'unassigned_for'],
    contentFields: ['description'],
  }),
  makeAdapter({
    key: 'users_groups.requester_groups',
    listKey: 'requester_groups',
    moduleGroup: 'users_groups',
    name: 'Grupos de solicitantes',
    path: '/api/v2/requester_groups',
    paginated: true,
    docNote: 'Ação "List All Requester Groups/Contact Groups" no índice.',
    fields: ['id', 'name', 'description'],
    contentFields: ['description'],
  }),
];
