import { makeAdapter, type ModuleAdapter } from './types';

const itsmFields = [
  'id', 'subject', 'status', 'priority', 'impact', 'urgency', 'category', 'department_id', 'group_id',
  'agent_id', 'workspace_id', 'created_at', 'updated_at', 'due_by', 'description', 'description_text',
];
const itsmRelations = { department_id: 'department', group_id: 'agent_group', agent_id: 'agent' };

export const itsmAdapters: ModuleAdapter[] = [
  makeAdapter({
    key: 'itsm.problems',
    listKey: 'problems',
    moduleGroup: 'itsm',
    name: 'Problemas',
    path: '/api/v2/problems',
    paginated: true,
    docNote: 'Ação "View List of Problems" no índice.',
    nameField: 'subject',
    fields: itsmFields,
    contentFields: ['description', 'description_text'],
    categoryField: 'category',
    relationFields: itsmRelations,
  }),
  makeAdapter({
    key: 'itsm.changes',
    listKey: 'changes',
    moduleGroup: 'itsm',
    name: 'Mudanças',
    path: '/api/v2/changes',
    paginated: true,
    docNote: 'Ação "View List of Changes" no índice.',
    nameField: 'subject',
    fields: itsmFields,
    contentFields: ['description', 'description_text'],
    categoryField: 'category',
    relationFields: itsmRelations,
  }),
  makeAdapter({
    key: 'itsm.releases',
    listKey: 'releases',
    moduleGroup: 'itsm',
    name: 'Releases',
    path: '/api/v2/releases',
    paginated: true,
    docNote: 'Ação "View list of Releases" no índice.',
    nameField: 'subject',
    fields: itsmFields,
    contentFields: ['description', 'description_text'],
    categoryField: 'category',
    relationFields: itsmRelations,
  }),
];
