# Endpoints de leitura usados pela sincronização

Fonte: documentação pública da API Freshservice (api.freshservice.com, página única), baixada em 2026-10-11. Confirmação feita por texto da documentação (caminho, método GET na seção, chave de resposta, escopo OAuth). Nada foi testado contra instância real.

Regras gerais (documentação):
- Autenticação: API key em Basic, ou OAuth 2.0 do Freshworks em Bearer.
- Listas: `page` (a partir de 1), `per_page` (padrão 30, máximo 100) e cabeçalho `link` com a próxima página. O motor também para em página curta quando não há `link`.
- Permissão real depende da conta: com API key, vale o papel do agente. Com OAuth, vale o escopo listado abaixo.
- Dados de pessoas: e-mail e telefones nunca entram no registro gravado.

Chave do módulo = `key` do adaptador (`src/lib/freshservice/modules/`). A UI agrega pelo grupo (antes do ponto).

| Módulo (key) | Método | Caminho | Chave da resposta | Paginação | Escopo OAuth (doc) | Status | Limitações |
|---|---|---|---|---|---|---|---|
| service_catalog.categories | GET | /api/v2/service_catalog/categories | service_categories | page/per_page (regra geral; parâmetros do endpoint não conferidos no trecho) | não identificado no trecho | confirmed | Escopo a conferir no diagnóstico |
| service_catalog.items | GET | /api/v2/service_catalog/items | service_items | page/per_page (exemplo na doc) | freshservice.service_catalog.edit | confirmed | Campos de formulário por item fora desta rodada |
| service_catalog.item_details | GET | /api/v2/service_catalog/items/{display_id} | service_item | não paginado (filho de `service_catalog.items`, referência `display_id`) | mesmo escopo de `service_catalog.items` | confirmed (View a Service Item) | Exemplo da doc traz `custom_fields` vazio; formato com campos preenchidos não exemplificado (pareamento por índice se faltar `id`/`name`) |
| knowledge_base.categories | GET | /api/v2/solutions/categories | categories | page/per_page (regra geral) | freshservice.solutions.view | confirmed | Nenhuma |
| knowledge_base.folders | GET | /api/v2/solutions/folders | folders | page/per_page (regra geral) | freshservice.solutions.view | confirmed | Uma consulta por categoria (filtro category_id do adaptador, a confirmar no diagnóstico) |
| knowledge_base.articles | GET | /api/v2/solutions/articles | articles | page/per_page (exemplo na doc) | freshservice.solutions.view | confirmed | folder_id obrigatório (texto: "The query parameter folder_id is mandatory"). Uma consulta por pasta. Corpo só com metadataOnly=false. Cabeçalho GET não apareceu como linha isolada no texto: validar no diagnóstico |
| tickets.tickets | GET | /api/v2/tickets | tickets | page/per_page | freshservice.tickets.view | confirmed | Cobertura dos status na listagem padrão não conferida |
| tickets.form_fields | GET | /api/v2/ticket_form_fields | ticket_fields | sem paginação | freshservice.tickets.fields.manage | confirmed | workspace_id é filtro opcional |
| users_groups.agents | GET | /api/v2/agents | agents | page/per_page | freshservice.agents.manage | confirmed | Depende da permissão do agente conectado. E-mail e telefones não são gravados |
| users_groups.requesters | GET | /api/v2/requesters | requesters | page/per_page | freshservice.requesters.view | confirmed | Depende da permissão. E-mail e telefones não são gravados |
| users_groups.departments | GET | /api/v2/departments | departments | page/per_page (não conferido no trecho) | freshservice.departments.view | confirmed | Nenhuma |
| users_groups.agent_groups | GET | /api/v2/groups | groups | page/per_page (não conferido no trecho) | freshservice.agentgroups.manage | confirmed | Escopo como documentado |
| users_groups.requester_groups | GET | /api/v2/requester_groups | requester_groups | page/per_page | freshservice.requesters.view | confirmed | Nenhuma |
| assets.assets | GET | /api/v2/assets | assets | page/per_page | freshservice.assets.view | confirmed | Campos de tipo não entram nesta rodada |
| assets.asset_types | GET | /api/v2/asset_types | asset_types | page/per_page | freshservice.assets.view | confirmed | Nenhuma |
| itsm.problems | GET | /api/v2/problems | problems | page/per_page (não conferido no trecho) | freshservice.problems.view | confirmed | Nenhuma |
| itsm.changes | GET | /api/v2/changes | changes | page/per_page | freshservice.changes.view | confirmed | Nenhuma |
| itsm.releases | GET | /api/v2/releases | releases | page/per_page (não conferido no trecho) | freshservice.releases.view | confirmed | Nenhuma |
| settings.workspaces | GET | /api/v2/workspaces | workspaces | sem parâmetro de página conferido | freshservice.workspaces.view | confirmed | Texto da seção: "Retrieves information about all the workspaces" |
| settings.sla_policies | GET | /api/v2/sla_policies | sla_policies | page/per_page (não conferido no trecho) | freshservice.sla_policies.view | confirmed | Nenhuma |
| settings.locations | GET | /api/v2/locations | locations | page/per_page | freshservice.locations.view | confirmed | Endereço não entra no registro gravado |
| settings.products | GET | /api/v2/products | products | page/per_page | freshservice.products.view | confirmed | Nenhuma |
| settings.vendors | GET | /api/v2/vendors | vendors | page/per_page | freshservice.vendors.view | confirmed | Contatos não entram no registro gravado |
| tickets.conversations | - | /api/v2/tickets/{id}/conversations | - | - | - | unsupported | Política de privacidade: conversas nunca são baixadas |
| tickets.activities | - | /api/v2/tickets/{id}/activities | - | - | - | unsupported | Política de privacidade: atividades não são coletadas |
| automations.workflows | - | (nenhum GET documentado no índice consultado) | - | - | - | unsupported | Não presumido. Sem endpoint de leitura confirmado |

Notas de verificação:
- Para cada listagem confirmada, a chave foi lida no primeiro bloco de resposta da seção GET (ex.: `"service_items": [`). Em `ticket_form_fields` a resposta é objeto com `ticket_fields`.
- "Confirmed" aqui significa que o caminho aparece na documentação. Não significa teste real. Testes contra API real exigem aprovação explícita.
- Se um endpoint ignorar `per_page`, a parada por página curta pode encerrar a coleta cedo. O motor só para em página curta sem cabeçalho `link`, e o diagnóstico deve validar isso antes de confiar na completude.

## Normalização ampla, detalhe do item e relações (recuperação, etapas 4–5)

- Normalização ampla (`src/lib/freshservice/modules/types.ts`): `normalized` traz todos os atributos de topo da resposta, menos ruído (`_links`, `links`, `meta`, `pagination`, `icon_url`, `avatar_url`, `image_url`, `logo_url`, `attachments`), menos contato pessoal (e-mails e telefones: nunca entram, com ou sem `metadataOnly`) e menos `excludeFields` do adaptador (usuários: dados sensíveis de pessoa). `fields` do adaptador vira só destaque. `custom_fields` e `choices` saem ordenados.
- Volatilidade (`src/lib/diff/volatile.ts`): campos de atividade (`last_*`, `last_seen`, `last_active` e similares) não entram na comparação. `created_at` continua comparado.
- Detalhe do item de catálogo: `service_catalog.item_details`, `GET /api/v2/service_catalog/items/{display_id}`, chave `service_item`, não paginado. O `display_id` vem do pai `service_catalog.items`. Se o run anterior não guardou `display_id` (run antigo), o filho falha com `parent_incomplete` e a mensagem "Re-sincronize itens do catálogo". Nenhuma chamada é feita às cegas, e o módulo fica incompleto: o diff não compara o escopo incompleto, então não há remoções falsas.
- Campos do formulário na tela: `/recursos/[id]` mostra `custom_fields` em tabela (campo, tipo, obrigatório, opções), via `src/lib/ui/form-fields.ts`. Rótulo do módulo: `moduleLabel` em `src/lib/modules/catalog.ts`.
- Relações (M3): `RELATION_TARGETS` em `src/lib/sync/relations.ts` mapeia origem e tipo para o módulo alvo. Ex.: `service_catalog.items`, tipo `category` (vindo de `category_id`) -> `service_catalog.categories`. `to_resource_id` aponta só para recurso da mesma instância, por external_id. Alvo ausente, de outra instância ou tipo fora do mapa fica nulo. Consistência com o registro: `tests/sync/relations.test.ts`.

## Rotas locais de sincronização e diagnóstico (Fase 4)

Passam por `src/proxy.ts` (Host e Origin locais para métodos que alteram estado). Erros: `{ "error": { "code", "message" } }`, sem segredos. Ações que chamam o Freshservice exigem instância ativa real com conexão `connected` (409 com código próprio: `no_active_instance`, `demo_instance`, `no_connection`, `session_expired`, `connection_not_ready`).

| Método | Rota | Corpo | Resposta | Observações |
|---|---|---|---|---|
| POST | `/api/sync/full` | nenhum | 202 `{ ok, runId, status }` | "Mapear tudo": módulos de `preferences.modules` |
| POST | `/api/sync/resync` | nenhum | 202 | 409 `no_previous_run` sem execução concluída ou parcial |
| POST | `/api/sync/retry` | JSON `{ runId }` | 202 | Repete só os módulos `failed` do run; 404 `retry_run_not_found` |
| POST | `/api/sync/cancel` | nenhum | 202 `{ ok, cancelRequested }` | 409 `no_active_sync` sem execução ativa |
| GET | `/api/sync/status` | nenhum | `running`, `runId`, `percent`, `message`, `currentModule`, `recordsProcessed`, `lastRun` | Exige só instância ativa |
| GET/PUT | `/api/sync/preferences` | `{ modules, metadataOnly, storeRaw }` | 200 | PUT valida com Zod (campos desconhecidos rejeitados); erro lista só nomes de campos |
| GET | `/api/diagnostics` | nenhum | `{ running, connectionStatus, modules[] }` | Lista `api_modules`; sem chamadas à API |
| POST | `/api/diagnostics` | nenhum | 202 `{ ok, running }` | Executa em segundo plano; 409 `sync_already_running` ou `diagnostics_running` |

Diagnóstico: um GET por adaptador consultável (`page=1`, `per_page=1`), concorrência 2, no máximo 3 chamadas por módulo. 429 e 5xx esperam `Retry-After` limitado a 120 s, com jitter. Adaptadores `unsupported` não são chamados; filhos (dependem de ID do pai) ficam `untested`. Classes gravadas: `accessible`, `forbidden` (403), `not_found` (404), `temporarily_unavailable` (429, 5xx, timeout, rede), `unsupported`, `untested`. 401 marca a conexão como `session_expired`. Mensagens de erro são fixas e não carregam URL nem resposta da API.

Diagnóstico real contra a instância do cliente: pendente de aprovação do usuário. Nenhum resultado real foi gravado neste documento.
