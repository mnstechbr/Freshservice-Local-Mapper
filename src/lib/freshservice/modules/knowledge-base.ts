import { makeAdapter, type ModuleAdapter } from './types';

export const knowledgeBaseAdapters: ModuleAdapter[] = [
  makeAdapter({
    key: 'knowledge_base.categories',
    listKey: 'categories',
    moduleGroup: 'knowledge_base',
    name: 'Categorias da base de conhecimento',
    path: '/api/v2/solutions/categories',
    paginated: true,
    docNote: 'Ação "View List of Solution Categories" no índice.',
    fields: ['id', 'name', 'description'],
    contentFields: ['description'],
  }),
  makeAdapter({
    key: 'knowledge_base.folders',
    listKey: 'folders',
    moduleGroup: 'knowledge_base',
    name: 'Pastas da base de conhecimento',
    path: '/api/v2/solutions/folders',
    paginated: true,
    docNote:
      'Ação "View List of Solution Folder" no índice. Uma consulta por categoria, com category_id.',
    child: { parentKey: 'knowledge_base.categories', parentParam: 'category_id' },
    fields: ['id', 'name', 'description', 'category_id', 'visibility'],
    contentFields: ['description'],
    categoryField: 'category_id',
    relationFields: { category_id: 'category' },
  }),
  makeAdapter({
    key: 'knowledge_base.articles',
    listKey: 'articles',
    moduleGroup: 'knowledge_base',
    name: 'Artigos da base de conhecimento',
    path: '/api/v2/solutions/articles',
    paginated: true,
    docNote:
      'Ação "View List of Solution Article" no índice. folder_id é obrigatório (changelog de out/2026). Uma consulta por pasta. Corpo só com metadataOnly = false.',
    child: { parentKey: 'knowledge_base.folders', parentParam: 'folder_id' },
    nameField: 'title',
    fields: ['id', 'title', 'status', 'folder_id', 'created_at', 'updated_at', 'description'],
    contentFields: ['description'],
    sensitiveFields: ['description'],
    categoryField: 'folder_id',
    relationFields: { folder_id: 'folder' },
  }),
];
