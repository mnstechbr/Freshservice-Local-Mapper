import { makeAdapter, type ModuleAdapter, unsupportedAdapter } from './types';

export const ticketAdapters: ModuleAdapter[] = [
  makeAdapter({
    key: 'tickets.tickets',
    listKey: 'tickets',
    moduleGroup: 'tickets',
    name: 'Tickets',
    path: '/api/v2/tickets',
    paginated: true,
    docStatus: 'confirmed',
    docNote:
      'Caminho confirmado na documentação. Se a listagem padrão cobre todos os status não foi conferido no trecho lido.',
    nameField: 'subject',
    fields: [
      'id', 'subject', 'type', 'status', 'priority', 'source', 'requester_id', 'responder_id',
      'group_id', 'department_id', 'category', 'sub_category', 'item_category', 'created_at',
      'updated_at', 'due_by', 'workspace_id', 'description', 'description_text',
    ],
    contentFields: ['description', 'description_text'],
    sensitiveFields: ['description', 'description_text'],
    categoryField: 'category',
    relationFields: {
      requester_id: 'requester',
      responder_id: 'agent',
      group_id: 'agent_group',
      department_id: 'department',
    },
  }),
  makeAdapter({
    key: 'tickets.form_fields',
    listKey: 'ticket_fields',
    moduleGroup: 'tickets',
    name: 'Campos de formulário de tickets',
    path: '/api/v2/ticket_form_fields',
    paginated: false,
    docStatus: 'confirmed',
    docNote:
      'Caminho e chave "ticket_fields" confirmados na documentação (workspace_id é filtro opcional).',
    fields: ['id', 'name', 'label', 'type', 'required', 'position', 'workspace_id'],
  }),
  unsupportedAdapter({
    key: 'tickets.conversations',
    moduleGroup: 'tickets',
    name: 'Conversas de tickets',
    path: '/api/v2/tickets/{id}/conversations',
    docNote: 'Fora da política de privacidade: conversas nunca são baixadas.',
  }),
  unsupportedAdapter({
    key: 'tickets.activities',
    moduleGroup: 'tickets',
    name: 'Atividades de tickets',
    path: '/api/v2/tickets/{id}/activities',
    docNote: 'Fora da política de privacidade: atividades por ticket não são coletadas.',
  }),
];
