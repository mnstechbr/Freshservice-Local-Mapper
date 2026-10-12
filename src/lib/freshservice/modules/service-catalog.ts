import { makeAdapter, type ModuleAdapter } from './types';

export const serviceCatalogAdapters: ModuleAdapter[] = [
  makeAdapter({
    key: 'service_catalog.categories',
    listKey: 'service_categories',
    moduleGroup: 'service_catalog',
    name: 'Categorias do catálogo de serviços',
    path: '/api/v2/service_catalog/categories',
    paginated: true,
    docNote: 'Ação "View List of Service Categories" no índice. Caminho confirmado na documentação.',
    fields: ['id', 'name', 'description'],
    contentFields: ['description'],
  }),
  makeAdapter({
    key: 'service_catalog.items',
    listKey: 'service_items',
    moduleGroup: 'service_catalog',
    name: 'Itens do catálogo de serviços',
    path: '/api/v2/service_catalog/items',
    paginated: true,
    docNote: 'Ação "View List of Service Items" no índice. Caminho confirmado. A referência para o detalhe é display_id.',
    fields: ['id', 'display_id', 'name', 'description', 'category_id', 'visibility'],
    contentFields: ['description'],
    refField: 'display_id',
    categoryField: 'category_id',
    relationFields: { category_id: 'category' },
  }),
  makeAdapter({
    key: 'service_catalog.item_details',
    itemKey: 'service_item',
    moduleGroup: 'service_catalog',
    name: 'Detalhe do item: campos do formulário',
    path: '/api/v2/service_catalog/items/{display_id}',
    paginated: false,
    docNote:
      'Ação "View a Service Item": GET /api/v2/service_catalog/items/{display_id}, resposta com a chave service_item e custom_fields (label, required, field_type, choices[].value, field_options). Uma requisição por item do módulo pai.',
    fields: ['id', 'name', 'custom_fields'],
    contentFields: ['description', 'short_description'],
    child: { parentKey: 'service_catalog.items', parentParam: 'display_id', placement: 'path' },
  }),
];
