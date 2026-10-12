import { makeAdapter, type ModuleAdapter } from './types';

export const assetAdapters: ModuleAdapter[] = [
  makeAdapter({
    key: 'assets.assets',
    listKey: 'assets',
    moduleGroup: 'assets',
    name: 'Ativos',
    path: '/api/v2/assets',
    paginated: true,
    docNote: 'Ação "View List of Assets" no índice.',
    fields: [
      'id', 'display_id', 'name', 'asset_tag', 'serial_number', 'asset_type_id', 'location_id',
      'department_id', 'user_id', 'workspace_id', 'created_at', 'updated_at', 'description',
    ],
    contentFields: ['description'],
    relationFields: {
      asset_type_id: 'asset_type',
      location_id: 'location',
      department_id: 'department',
      user_id: 'requester',
    },
  }),
  makeAdapter({
    key: 'assets.asset_types',
    listKey: 'asset_types',
    moduleGroup: 'assets',
    name: 'Tipos de ativo',
    path: '/api/v2/asset_types',
    paginated: true,
    docNote: 'Ação "List all Asset Types" no índice.',
    fields: ['id', 'name', 'description', 'parent_id', 'workspace_id'],
    contentFields: ['description'],
    relationFields: { parent_id: 'asset_type' },
  }),
];
