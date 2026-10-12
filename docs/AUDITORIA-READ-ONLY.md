> **Relatório histórico da auditoria de 2026-10-11.** Os achados descrevem a árvore daquela data, não instruções atuais. A estabilização `v0.1.0-beta` corrigiu A-01, A-02, A-04, A-07, A-08, A-09, A-10, A-12, A-13, A-14 e A-15; A-03/A-11 já tinham correções preservadas. A-05/A-06 mantêm riscos documentados. Estado individual e validações em [RELATORIO-FINAL-CODEX.md](RELATORIO-FINAL-CODEX.md). Para uso atual consulte o [guia](GUIA-DE-USO-E-COLETA.md).

# Auditoria read-only do Freshservice Local Mapper

| Item | Valor |
|---|---|
| Data | 2026-10-11 |
| Versão auditada | 0.1.0 (árvore de trabalho; o repositório ainda não tem commits) |
| Tipo | Auditoria técnica independente, por leitura de código, busca estática e execução da suíte de testes |
| Foco principal | Comprovar que a aplicação só lê dados do Freshservice e descrever o que é coletado e armazenado |
| Foco secundário | Compatibilidade Fedora/Windows 11, instalação automática, cofres de segredos, arquivos locais e publicação no GitHub |
| Chamadas reais | Nenhuma. Nenhuma instância Freshservice ou Freshworks foi contactada nesta auditoria |
| Alterações de código | Nenhuma. Só foram criados este relatório e `docs/GUIA-DE-USO-E-COLETA.md` |

## 1. Veredito

**Nenhuma operação de escrita (POST, PUT, PATCH ou DELETE) sobre recursos do Freshservice foi encontrada.** Não há problema crítico.

- O cliente da API do Freshservice só envia `GET`. O método está fixo no código (`src/lib/freshservice/http.ts:296`), e o caminho precisa casar com `^/api/v2/[a-z0-9_]+(/[a-z0-9_]+)*$` (`http.ts:54`, conferido em `http.ts:289`).
- O único `POST` externo é a troca e a renovação de token OAuth em `https://<organização>.freshworks.com|myfreshworks.com[/org]/oauth/v2/token` (`http.ts:339-358`). Ele não cria nem altera registros de negócio.
- As rotas locais que usam `POST` e `PUT` (`/api/...` no próprio computador) alteram só o SQLite local, o cofre local ou o estado do processo. Nenhuma delas chama o Freshservice com método de escrita.

O veredito vale para o código auditado nesta data. Ele foi verificado por leitura de código e testes com servidor simulado, **não por tráfego real** contra uma instância. Ver limitações na seção 13.

Foram encontrados 15 achados não críticos (seção 10). Os de maior peso:

- **A-01 (média):** endereços e nomes de contato de **Locais** e **Fornecedores** são gravados no banco, ao contrário do que dizem o README e `docs/ENDPOINTS.md`.
- **A-02 (média):** alguns escopos OAuth exigidos pela documentação do Freshservice são de gestão (`.manage` e `.edit`). O token recebido pode, portanto, ter poder de escrita, embora a aplicação não o use para isso.
- **A-03 (média):** o formulário OAuth pede a "URL da instância" com exemplo `*.freshservice.com`, mas o servidor só aceita a URL da organização Freshworks (`*.freshworks.com` ou `*.myfreshworks.com`).

## 2. Metodologia

1. Leitura integral do cliente HTTP, dos adaptadores de módulo, do motor de sincronização, do diagnóstico, da autenticação (OAuth e API key), dos cofres de segredo, do logger, da persistência, das rotas `/api`, do proxy e dos scripts de inicialização.
2. Busca estática por toda primitiva capaz de fazer rede ou executar processos: `fetch(`, `node:http`, `node:https`, `node:net`, `node:dns`, `node:tls`, `child_process`, `axios`, `undici`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` e literais de método (`'POST'`, `'PUT'`, `'PATCH'`, `'DELETE'`).
3. Execução de `pnpm test` (Vitest) e `pnpm typecheck`.
4. Execução local de um script com registros **sintéticos** contra os adaptadores (função pura `toResource`, sem rede) para confirmar o que é gravado.
5. Varredura dos arquivos que seriam publicados (não ignorados pelo `.gitignore`) em busca de e-mails, URLs reais, caminhos pessoais e arquivos de dados.

## 3. Bibliotecas e primitivas que fazem comunicação externa

| Primitiva | Onde | Uso | Destino |
|---|---|---|---|
| `fetch` global (Node) | `src/lib/freshservice/http.ts:202` (`safeRequest`) | Única chamada de rede do servidor para Freshservice/Freshworks | Host da instância ativa ou host da organização Freshworks |
| `fetch` global | `src/lib/sync/engine.ts:211`, `src/lib/sync/diagnostics.ts:105`, `src/lib/auth/context.ts:34` | Só repassam o `fetch` como dependência injetável para `safeRequest` | Nenhum destino próprio |
| `fetch` no navegador | `src/components/**` | Chamadas a caminhos relativos `/api/...` do próprio app | `http://127.0.0.1:<PORT>` |
| `node:dns` | `src/lib/security/dns-guard.ts` | Resolve o host antes de cada chamada e recusa endereços internos | Resolvedor DNS do sistema |
| `node:http` | `scripts/start-dev.mjs:231` | `GET http://127.0.0.1:<PORT>/api/health` para saber se o app subiu | Apenas loopback |
| `node:dns` | `scripts/start-dev.mjs:167` (via `bootstrap-core.mjs:320`) | Testa se o registro npm resolve antes de instalar dependências | `registry.npmjs.org` (ou `npm_config_registry`) |
| `child_process.spawn` | `src/lib/secrets/command.ts:36` | `secret-tool` (Linux), `powershell.exe` (Windows), `/usr/bin/security` (macOS) | Processos locais |
| `child_process.spawn` | `scripts/start-dev.mjs` | Instalador pnpm, `next dev`, abrir navegador, `taskkill` | Processos locais; o instalador acessa o registro npm |

Nenhuma biblioteca de terceiros faz chamada de rede em tempo de execução. A fonte é local (`@fontsource-variable/inter`). A telemetria do Next.js é desligada (`NEXT_TELEMETRY_DISABLED=1` em `package.json` e `start-dev.mjs:604`). A CSP limita `connect-src` a `'self'` (`src/lib/security/headers.ts:15-32`).

## 4. Todas as operações HTTP para fora do computador

| # | Método | Destino | Função e arquivo | Finalidade | Escreve no Freshservice? |
|---|---|---|---|---|---|
| H1 | GET | `https://<instância>/api/v2/<recurso>` | `createFreshserviceClient().getPage` (`http.ts:284-308`), chamado por `paginate` (`src/lib/sync/fetch-pages.ts:130`) | Coleta paginada dos módulos | Não |
| H2 | GET | `https://<instância>/api/v2/<recurso>?page=1&per_page=1` | `probe` (`src/lib/sync/diagnostics.ts:129`) | Diagnóstico de acesso por módulo | Não |
| H3 | GET | `https://<instância>/api/v2/ticket_form_fields` | `probeInstance` (`src/lib/auth/probe.ts:94-108`) | Validar API key, token OAuth e "Testar conexão" | Não |
| H4 | POST | `https://<org>/[org/]oauth/v2/token`, `grant_type=authorization_code` | `postTokenRequest` (`http.ts:339`) via `requestTokens` (`src/lib/auth/oauth.ts:284-313`, chamado em `oauth.ts:393`) | Trocar o código de autorização por token | Não (exceção técnica de autenticação) |
| H5 | POST | mesmo endpoint, `grant_type=refresh_token` | `resolveOAuthAccessToken` (`oauth.ts:498-501`) | Renovar o token perto da expiração | Não (exceção técnica de autenticação) |
| H6 | Navegação GET no navegador do usuário | `https://<org>/[org/]oauth/v2/authorize?...` | URL montada em `startOAuth` (`oauth.ts:203-261`); o servidor não contacta o Freshworks nesse passo | Tela de consentimento OAuth | Não |
| H7 | Link aberto pelo usuário | `https://<instância>/helpdesk/tickets/<id>` e `/cmdb/items/<id>` | `freshserviceResourceUrl` (`src/lib/ui/external-links.ts`) | Atalho "abrir no Freshservice" | Não (só navegação) |

Fora do Freshservice, só o bootstrap acessa a internet: o registro npm durante a instalação de dependências (seção 11).

## 5. Endpoints de leitura por módulo

Todos usam `GET`. O método vem de `makeAdapter` (`src/lib/freshservice/modules/types.ts:239`), e o tipo `ModuleAdapter.method` aceita só `'GET'` (`types.ts:107`). Os escopos OAuth vêm de `docs/ENDPOINTS.md`, que os tirou da documentação pública. Eles não foram confirmados em instância real.

| Módulo (chave) | Endpoint | Finalidade | Informações retornadas | Armazenamento | Permissão (OAuth / API key) | Riscos |
|---|---|---|---|---|---|---|
| `service_catalog.categories` | `/api/v2/service_catalog/categories` | Inventário de categorias do catálogo | id, nome, descrição | `resources`, `resource_versions.normalized_json` | Escopo não identificado na doc / papel do agente | Baixo |
| `service_catalog.items` | `/api/v2/service_catalog/items` | Inventário de itens de serviço | id, display_id, nome, descrição, categoria, visibilidade e demais atributos | Idem; relação `category` | `freshservice.service_catalog.edit` / papel do agente | Escopo de edição (A-02) |
| `service_catalog.item_details` | `/api/v2/service_catalog/items/{display_id}` | Campos do formulário de cada item | `custom_fields` (rótulo, obrigatório, tipo, opções) | Idem | Mesmo escopo dos itens | `display_id` vem da própria API e é codificado (`fetch-pages.ts:111`); uma chamada por item |
| `knowledge_base.categories` | `/api/v2/solutions/categories` | Categorias da base | id, nome, descrição | Idem | `freshservice.solutions.view` | Baixo |
| `knowledge_base.folders` | `/api/v2/solutions/folders?category_id=` | Pastas por categoria | id, nome, descrição, categoria, visibilidade | Idem | `freshservice.solutions.view` | Baixo |
| `knowledge_base.articles` | `/api/v2/solutions/articles?folder_id=` | Artigos por pasta | id, título, status, pasta, datas; corpo só se "Somente metadados" for desligado | Idem | `freshservice.solutions.view` | Corpo pode ter conteúdo interno, se o padrão for desligado |
| `tickets.tickets` | `/api/v2/tickets` | Inventário de tickets | id, assunto, tipo, status, prioridade, IDs de solicitante, agente, grupo e departamento, categorias, datas, campos personalizados; descrição só sem "Somente metadados" | Idem; relações | `freshservice.tickets.view` | Assunto e campos personalizados podem ter dados pessoais (A-05) |
| `tickets.form_fields` | `/api/v2/ticket_form_fields` | Campos do formulário de tickets | id, nome, rótulo, tipo, obrigatório, posição, opções | Idem | `freshservice.tickets.fields.manage` | Escopo de gestão (A-02); também é o endpoint de validação da conexão |
| `users_groups.agents` | `/api/v2/agents` | Inventário de agentes | nome, cargo, ativo, departamentos, grupos, local e demais atributos; sem e-mail, telefone e endereço | Idem | `freshservice.agents.manage` | Escopo de gestão (A-02); nomes, assinatura e campos personalizados gravados (A-05) |
| `users_groups.requesters` | `/api/v2/requesters` | Inventário de solicitantes | Igual a agentes | Idem | `freshservice.requesters.view` | Dados pessoais de nome (A-05) |
| `users_groups.departments` | `/api/v2/departments` | Departamentos | id, nome, descrição, IDs de responsáveis | Idem | `freshservice.departments.view` | Baixo |
| `users_groups.agent_groups` | `/api/v2/groups` | Grupos de agentes | id, nome, descrição, workspace | Idem | `freshservice.agentgroups.manage` | Escopo de gestão (A-02) |
| `users_groups.requester_groups` | `/api/v2/requester_groups` | Grupos de solicitantes | id, nome, descrição | Idem | `freshservice.requesters.view` | Baixo |
| `assets.assets` | `/api/v2/assets` | Inventário de ativos | nome, etiqueta, número de série, tipo, local, departamento, usuário, datas, descrição | Idem; relações | `freshservice.assets.view` | Número de série e vínculo com usuário |
| `assets.asset_types` | `/api/v2/asset_types` | Tipos de ativo | id, nome, descrição, tipo pai | Idem | `freshservice.assets.view` | Baixo |
| `itsm.problems` | `/api/v2/problems` | Problemas | assunto, status, prioridade, impacto, urgência, categoria, IDs, datas, **descrição** | Idem | `freshservice.problems.view` | Descrição gravada por padrão (A-05) |
| `itsm.changes` | `/api/v2/changes` | Mudanças | Idem | Idem | `freshservice.changes.view` | Idem |
| `itsm.releases` | `/api/v2/releases` | Releases | Idem | Idem | `freshservice.releases.view` | Idem |
| `settings.workspaces` | `/api/v2/workspaces` | Workspaces | id, nome, descrição, principal, ativo, datas | Idem | `freshservice.workspaces.view` | Baixo |
| `settings.sla_policies` | `/api/v2/sla_policies` | Políticas de SLA | id, nome, descrição, posição, padrão, ativo | Idem | `freshservice.sla_policies.view` | Baixo |
| `settings.locations` | `/api/v2/locations` | Locais | id, nome, local pai, datas e **endereço e contato** | Idem | `freshservice.locations.view` | **Endereço e nome de contato gravados (A-01)** |
| `settings.products` | `/api/v2/products` | Produtos | id, nome, descrição, tipo de ativo, fabricante, status | Idem | `freshservice.products.view` | Baixo |
| `settings.vendors` | `/api/v2/vendors` | Fornecedores | id, nome, descrição e **endereço e contato** | Idem | `freshservice.vendors.view` | **Endereço e nome de contato gravados (A-01)** |

Registrados como **não suportados** e nunca chamados (`unsupportedAdapter`, `types.ts:277-305`; filtrados por `syncableAdapters`, `modules/index.ts:39`; o próprio adaptador lança erro se for usado, `types.ts:300-302`):

- `tickets.conversations` e `tickets.activities`, excluídos pela política de privacidade;
- `automations.workflows`, porque não há endpoint GET documentado.

## 6. Exceções técnicas de autenticação

| Operação | Evidência | Por que não é escrita de negócio | Proteções |
|---|---|---|---|
| POST de token (troca de código) | `oauth.ts:393-397`, `http.ts:339-358` | Só pede um token ao servidor de autorização Freshworks. Não toca tickets, catálogo, usuários nem configurações | Host restrito a `*.freshworks.com` ou `*.myfreshworks.com` (`src/lib/security/url.ts:17`, `158-165`); https obrigatório; sem porta; sem redirecionamento (`http.ts:191`, `216`, `355`); DNS precisa ser público; `client_secret` vai só no cabeçalho Basic; prefixo de caminho só de allowlist (`'/org'` ou `''`, `http.ts:342`) |
| POST de token (renovação) | `oauth.ts:498-501` | Igual ao anterior | Igual; uma renovação por instância por vez (`src/lib/sync/token.ts:23-33`) |
| GET de validação | `probe.ts:12`, `102` | Leitura de metadados de formulário | Mesmas regras de H1 |

Efeitos colaterais esperados nos sistemas do cliente: a autorização OAuth registra o consentimento e a emissão de tokens no Freshworks, e cada chamada pode aparecer em logs de acesso e consumir o limite de requisições da conta. Nenhum desses efeitos cria ou altera registros de negócio.

A desconexão não revoga o token no Freshworks, porque a revogação remota não está documentada (`src/lib/auth/connection.ts:170-213`). Ela apaga os segredos locais, e a mensagem orienta revogar no painel.

## 7. Caminhos indiretos, parâmetros dinâmicos e funções capazes de escrever

| Vetor | Análise | Resultado |
|---|---|---|
| Método vindo de dado externo | O método de H1 a H3 é literal `'GET'`. O cliente não recebe método como parâmetro (`http.ts:284-308`) | Sem caminho |
| Caminho vindo de dado externo | `getPage` recusa qualquer caminho fora de `RESOURCE_PATH_RE`: só letras minúsculas, dígitos e `_`, sem `..`, sem `?` (`http.ts:54`, `289-291`). O registro também valida os caminhos (`modules/index.ts:32`, `49`) | Sem caminho |
| Cabeçalho `Link` de paginação | Aceito só com https, mesmo host, sem porta e sem credenciais (`fetch-pages.ts:41-64`). O caminho passa de novo por `RESOURCE_PATH_RE`, e o método continua GET. Repetição de página interrompe o módulo | Sem caminho de escrita |
| Valor do pai em módulo filho (`display_id`, `category_id`, `folder_id`) | Vem da resposta da API. Em caminho, passa por `encodeURIComponent` (`fetch-pages.ts:111`) e pelo filtro de caminho. Em query, vira só parâmetro de GET | Sem caminho de escrita |
| `extraQuery` | Definido só no código dos adaptadores. Nenhum adaptador atual usa | Sem caminho |
| Redirecionamento HTTP | `redirect: 'manual'`. Em GET, segue só para o mesmo host, até 3 vezes. Em POST, recusa sempre (`http.ts:191`, `213-233`) | Um redirect nunca transforma GET em POST |
| Lista de módulos enviada pela tela | `PUT /api/sync/preferences` aceita só chaves conhecidas (`src/lib/sync/prefs.ts:37-39`, `52`). O motor recusa chave fora do registro (`engine.ts:175-207`) | Sem caminho |
| URL da instância informada pelo usuário | Normalizada para a origem https; recusa IP, localhost, porta, credenciais, IDN e TLD interno. Exige `*.freshservice.com`, salvo `allow_custom_domain` (`url.ts:80-165`). O DNS é verificado no cadastro e antes de cada chamada | Sem SSRF conhecido; não afeta o método |
| Escopos OAuth informados pelo usuário | Validados só pelo formato (`oauth.ts:32`). O usuário pode pedir escopos de escrita | Não gera escrita pelo app, mas amplia o poder do token (A-02) |
| `safeRequest` exportado | Aceita `'GET'` ou `'POST'` e qualquer lista de hosts. Hoje só é chamado dentro de `http.ts` | Risco futuro de uso indevido (A-04) |
| Rotas locais mutáveis | Ver seção 8. Nenhuma chama o Freshservice com método de escrita | Sem caminho |
| Código do lado do navegador | Componentes só chamam `/api/...` relativos. A CSP bloqueia `connect-src` externo | Sem caminho |
| Modo demonstrativo | Recusado no motor (`engine.ts:119`) e no serviço (`src/lib/sync/service.ts:46`). Usa domínio `demo.freshservice.invalid`, que não resolve | Não alcança a rede |

## 8. Operações que alteram estado local (permitidas)

Essas rotas aceitam `POST` ou `PUT` **no servidor local**. O proxy só aceita `Host` igual a `127.0.0.1:PORT` ou `localhost:PORT` e, para métodos mutáveis, exige `Origin` local (`src/proxy.ts`, `src/lib/security/origin.ts:34-61`).

| Rota local | Efeito | Contato externo |
|---|---|---|
| `POST /api/instances` | Cadastra ou ativa a instância no SQLite | Só DNS |
| `POST /api/connection/api-key` | Valida (H3) e grava a chave no cofre | H3 (GET) |
| `GET /api/auth/oauth/start` | Grava o estado "aguardando autorização" e o cookie de state. Recusa origem cruzada (`src/app/api/auth/oauth/start/route.ts:15-28`) | Nenhum |
| `GET /api/auth/oauth/callback` | Troca o código por token (H4) e grava no cofre | H4 (POST de token) e H3 |
| `POST /api/auth/oauth/config` | Grava client ID, escopos e organização no SQLite e o secret no cofre | Nenhum |
| `POST /api/connection/test`, `/reconnect` | Revalida e atualiza o estado | H3, H5 |
| `POST /api/connection/disconnect` | Apaga segredos locais | Nenhum |
| `POST /api/sync/full`, `/resync`, `/retry` | Inicia coleta e grava resultados no SQLite | H1, H5 |
| `POST /api/sync/cancel` | Cancela a coleta | Nenhum |
| `PUT /api/sync/preferences` | Grava preferências | Nenhum |
| `POST /api/diagnostics` | Executa o diagnóstico | H2, H5 |
| `POST /api/changes/[id]/review` | Confirma ou rejeita uma troca de ID **só no SQLite** | Nenhum |
| `POST /api/demo` | Ativa ou remove a demonstração | Nenhum |

## 9. O que é gravado localmente e como é sanitizado

### 9.1 Tabelas (`src/lib/db/schema.ts`)

| Tabela | Conteúdo |
|---|---|
| `instances` | URL de origem, nome de exibição, `is_demo`, datas |
| `connections` | Modo de autenticação, estado, rótulo da conta, escopos, **referência** ao cofre (`secret_ref`), expiração do token, último erro. Nunca o segredo |
| `api_modules` | Por instância e módulo: método, caminho, estado de acesso, código HTTP, última tentativa |
| `sync_runs`, `sync_module_results` | Execuções, módulos, contagens, páginas, falhas, mensagens de erro sanitizadas |
| `resources` | Identidade do recurso: instância, módulo, ID externo, workspace, primeira e última execução, nome e categoria atuais |
| `resource_versions` | Versão normalizada (`normalized_json`), hash SHA-256, nome, categoria, endpoint de origem, data; `raw_json` só se "Guardar a resposta original" estiver ligado |
| `resource_observations` | Quais recursos cada execução viu |
| `resource_relations` | Referências entre recursos (categoria, pasta, solicitante, agente, grupo, departamento, local, tipo de ativo) |
| `detected_changes`, `change_matches` | Diferenças, diffs de campos, evidências, candidatos de troca de ID, pontuação e decisão de revisão |
| `audit_events` | Log operacional, redigido antes de gravar |
| `app_settings` | Instância ativa, preferências, configuração OAuth (organização, client ID, escopos, referência do secret), versão da demo |

### 9.2 Regras de sanitização verificadas

| Regra | Evidência | Abrangência |
|---|---|---|
| Lista global de chaves nunca gravadas: `_links`, `links`, `meta`, `pagination`, `icon_url`, `avatar_url`, `image_url`, `logo_url`, `attachments`, `email`, `emails`, `primary_email`, `secondary_emails`, `cc_emails`, `fwd_emails`, `reply_cc_emails`, `to_emails`, `phone`, `mobile`, `work_phone_number`, `mobile_phone_number` | `types.ts:28-51` | `normalized_json` e `raw_json`, em qualquer nível |
| Chaves com cara de segredo (`api_key`, `apikey`, `api-key` e qualquer chave com `token`, `secret` ou `password`) | `types.ts:61-66` | Em qualquer nível. Falso positivo aceito |
| Contato de agentes e solicitantes: `primary_email`, `secondary_emails`, `work_phone_number`, `mobile_phone_number`, `address` | `users-groups.ts:10`, `excludeFields` | Só no topo do registro desses dois módulos |
| "Somente metadados" | `prefs.ts:134-142` | Remove `contentFields` e `sensitiveFields` do módulo. Ligado por padrão só em `tickets.*` e `knowledge_base.articles` (`prefs.ts:22-25`) |
| Resposta original (`raw_json`) | `src/lib/sync/persist.ts:142`, `251-260` | Desligada por padrão. Quando ligada, recebe as mesmas remoções e ainda perde `sensitiveFields` |
| Conversas, atividades e anexos de tickets | `tickets.ts` (adaptadores não suportados) e `attachments` na lista global | Nunca baixados |
| Logs | `src/lib/audit/redact.ts:6`, `src/lib/audit/logger.ts:25-44` | Mensagem e contexto redigidos (Authorization, cookie, token, api key, password, secret, credential, Bearer/Basic) |
| Erros HTTP | `http.ts:135-145`, `83-118` | Mensagens fixas, sem URL, cabeçalho ou corpo |

### 9.3 Limitações da sanitização, verificadas com dados sintéticos

Teste executado nesta auditoria (sem rede), passando registros fictícios por `toResource`:

```
locations {"id":1,"name":"Sintetico","address":{"line1":"Rua Ficticia 0","city":"X"},"contact_name":"Pessoa Ficticia","primary_contact_id":9}
vendors   {"id":1,"name":"Sintetico","address":{"line1":"Rua Ficticia 0","city":"X"},"contact_name":"Pessoa Ficticia","primary_contact_id":9}
agents    {"id":2,"first_name":"A","signature":"<p>Assinatura</p>","background_information":"bio","custom_fields":{"cpf":"000"},"time_zone":"Brasilia"}
problems  {"id":3,"subject":"S","description":"<p>texto</p>","requester_id":5}
```

Conclusões:

1. `email` e `phone` são removidos. `address` e `contact_name` de Locais e Fornecedores **são gravados** (A-01).
2. A normalização é ampla: todo atributo de topo não excluído é gravado. O campo `fields` dos adaptadores **não filtra** nada (`types.ts:138-139`), apesar do comentário em `users-groups.ts:3`.
3. Campos personalizados (`custom_fields`) são gravados em todos os módulos e podem conter dados pessoais.
4. Assunto de tickets e nomes de pessoas são gravados mesmo com "Somente metadados".
5. A exclusão por nome não detecta dados pessoais escritos em texto livre (descrição, assunto, assinatura).

## 10. Achados

Nenhum achado é crítico: nenhum permite alterar dados do Freshservice.

| ID | Severidade | Local | Descrição | Recomendação |
|---|---|---|---|---|
| A-01 | Média | `src/lib/freshservice/modules/settings.ts:27-58`; `README.md` §15; `docs/ENDPOINTS.md:35,37` | Locais e Fornecedores gravam `address` e `contact_name`. A documentação diz que não | Incluir `address`, `contact_name` e `primary_contact_id` em `excludeFields`/`sensitiveFields` desses módulos e adicionar teste. Até lá, corrigir a documentação |
| A-02 | Média | `docs/ENDPOINTS.md:16,22,23,26`; `src/lib/auth/oauth.ts:32-39` | Escopos documentados de gestão (`service_catalog.edit`, `tickets.fields.manage`, `agents.manage`, `agentgroups.manage`) dão ao token poder de escrita. A API key herda todo o papel do agente. O app não usa esse poder, mas um vazamento da credencial teria impacto maior | Preferir usuário de integração com papel de leitura; pedir o mínimo de escopos; avaliar trocar o endpoint de validação (`ticket_form_fields`, que exige `.manage`) por um que aceite escopo `.view`; alertar na tela quando um escopo não terminar em `.view` |
| A-03 | Média (usabilidade) | `src/components/config/oauth-form.tsx:84-86` x `src/lib/security/url.ts:158-165` | O campo `org_url` tem o rótulo "URL da instância" e o exemplo `https://seu-dominio.freshservice.com`, mas o servidor só aceita `*.freshworks.com` ou `*.myfreshworks.com`. Um iniciante recebe erro | Rótulo "URL da organização Freshworks" e exemplo `https://sua-org.myfreshworks.com` |
| A-04 | Baixa | `src/lib/freshservice/http.ts:24-39`, `189` | `safeRequest` é exportado e aceita `POST` para qualquer host da lista informada. A garantia read-only depende de convenção e de tipos TypeScript | Deixar `safeRequest` interno ou restringir `POST` ao caminho de token; criar teste de arquitetura que falhe se surgir `method: 'POST'`, `PUT`, `PATCH` ou `DELETE` fora de `postTokenRequest` |
| A-05 | Baixa | adaptadores em `src/lib/freshservice/modules/*`; `prefs.ts:22-25` | Gravação padrão de nomes de pessoas, assinatura, `background_information`, `custom_fields`, assunto de tickets e descrição de problemas, mudanças e releases | Avaliar "Somente metadados" ligado por padrão em ITSM; lista de campos permitidos (allowlist) em vez de bloqueio; documentar (já feito no guia) |
| A-06 | Baixa | `src/lib/db/client.ts`; `scripts/start-dev.mjs:354-363` | SQLite e backups **não têm criptografia em repouso**. A proteção é só de permissão de arquivo | Documentar (feito); recomendar criptografia de disco (LUKS ou BitLocker); avaliar SQLCipher |
| A-07 | Baixa (Windows, não executado) | `src/lib/secrets/windows-dpapi.ts:13`; `scripts/lib/bootstrap-core.mjs:496,504` | `powershell.exe`, `rundll32` e `taskkill` são chamados pelo nome. No Windows a busca do executável pode incluir a pasta atual (raiz do projeto). Um executável plantado ali receberia o segredo pela entrada padrão | Usar caminho absoluto a partir de `%SystemRoot%\System32` |
| A-08 | Baixa | `README.md` §9; `.env.example:2`; `scripts/start-dev.mjs:110-123`, `604` | O README sugere pôr `FSLM_SECRET_KEY` num `.env` dentro da pasta do projeto; o `.env.example` diz para não pôr segredos nele. A chave fica em texto puro nesse arquivo e é herdada pelo processo `next` | Recomendar o cofre do sistema; se usar a chave, guardá-la fora da pasta do projeto; alinhar os dois textos |
| A-09 | Baixa | `src/lib/queries/resources.ts:157`; `src/lib/queries/changes.ts:156` | Páginas de detalhe `/recursos/[id]` e `/diferencas/[id]` buscam pelo ID sem filtrar a instância ativa. A tela mostra a instância de origem. É isolamento lógico | Filtrar pela instância ativa ou exibir aviso de troca |
| A-10 | Informativa | `.claude/agents/*.md:9`; `Prompt_Opus.txt`, `Prompt_Projeto.txt` | Arquivos de trabalho com o caminho local do usuário (`/home/<usuário>/...`) e instruções internas de desenvolvimento. Sem credenciais ou dados de cliente | Decidir antes do primeiro commit se esses arquivos serão publicados; remover o caminho pessoal |
| A-11 | Informativa | `oauth.ts:475-480`; `connection.ts:170-213` | A renovação de token segue a RFC 6749 porque o Freshworks não documenta o endpoint. Desconectar não revoga o token remoto | Validar em instância de teste; orientar revogação no painel Freshworks |
| A-12 | Informativa | `src/app/page.tsx:103` | O texto "somente leitura na fase inicial" sugere que fases futuras teriam escrita | Trocar por "somente leitura" |
| A-13 | Informativa | `.github/workflows/ci.yml`; `package.json` (`packageManager`) | Actions fixadas por tag (`@v4`), não por hash. O `pnpm@10.18.0` obtido via `npm exec` não tem hash de integridade no campo `packageManager` | Fixar actions por SHA; usar `pnpm@10.18.0+sha512.<hash>` |
| A-14 | Informativa (funcional) | `src/lib/sync/engine.ts:124`; `src/lib/sync/diagnostics.ts:187` | Instância com domínio customizado pode ser cadastrada (`allow_custom_domain`), mas a coleta e o diagnóstico revalidam sem essa opção e falham com `invalid_origin` | Guardar o tipo do domínio e revalidar com a mesma regra, ou remover a opção |
| A-15 | Informativa (usabilidade) | `src/components/dashboard/connection-card.tsx:91-140`; `src/app/configuracoes/page.tsx` | Não há controle só para cadastrar a instância. Quem usa API key precisa clicar em "Conectar conta autenticada", que salva a URL e tenta iniciar o OAuth. Sem OAuth configurado, aparece "Aguardando configuração OAuth", e a instância fica salva | Botão "Salvar instância" separado, ou campo de URL no formulário de API key |

## 11. Compatibilidade Fedora/Windows 11 e instalação automática

### 11.1 `scripts/setup.sh` (Fedora)

- Instala só pacotes dos repositórios oficiais do Fedora via `dnf` (`nodejs24`/`nodejs22`, `-npm`, `libsecret`, ferramentas de compilação opcionais) (`setup.sh:26`, `175-191`).
- Mostra o comando exato e pede confirmação, com padrão **não**. Sem terminal interativo e sem `--yes`, nega. Usa `sudo` só se não for root.
- Argumentos desconhecidos são recusados (`setup.sh:60-71`). Os nomes de pacote são constantes. Não há `eval` nem entrada externa na linha de comando.
- `/etc/os-release` é lido por `source` num subshell (`setup.sh:111-113`). Isso é normal em scripts de sistema; o arquivo é do sistema.
- Não baixa nada fora do `dnf`. Não altera arquivos do projeto. `--check` só diagnostica.

### 11.2 `scripts/setup.ps1` (Windows)

- Instala via `winget` os IDs fixos `OpenJS.NodeJS.LTS` e `Microsoft.VisualStudio.2022.BuildTools`, com `--source winget` e `--exact` (`setup.ps1:29-30`, `175-176`, `221-222`).
- Pede confirmação (padrão não). Com `-Yes`, aceita os termos do pacote automaticamente; isso é informado na tela.
- Recomenda `-ExecutionPolicy Bypass` só na linha de execução; não altera a política do sistema.
- Não há entrada externa em comandos. Argumentos são arrays (splatting).
- **Não executado em Windows real.** Validado só por análise sintática em PowerShell 7 dentro de contêiner Linux e por cenários simulados (`docs/COMPATIBILIDADE-BOOTSTRAP.md:99-101`).

### 11.3 `scripts/start-dev.mjs` e `scripts/lib/bootstrap-core.mjs`

- Instala dependências só com consentimento: pergunta no terminal, `--yes` ou `FSLM_AUTO_INSTALL=1`. Sem terminal e sem consentimento, recusa.
- O comando é sempre `install --frozen-lockfile` com `pnpm-lock.yaml`. As versões ficam presas ao lockfile, que tem hashes de integridade.
- `shell: true` só no Windows, para executar `pnpm.cmd`, `corepack.cmd` ou `npm.cmd`, e com argumentos constantes (`bootstrap-core.mjs:285`, `293`, `304`). Não há entrada do usuário na linha.
- O `preinstall` bloqueia `npm install` e `yarn` (`scripts/check-package-manager.mjs`).
- `better-sqlite3` usa binários pré-compilados do pacote, e só `esbuild` roda script de instalação (`package.json`, `pnpm.onlyBuiltDependencies`).
- O navegador é aberto com URL montada a partir de `PORT`, que é validada como inteiro de 1 a 65535 (`src/lib/config/env.ts`). Não há injeção.
- Backups antes de migrations: `sqlite.backup()` em `<dados>/backups/`, permissão `0600` no POSIX, retenção de 5. O backup antes de migration destrutiva autorizada nunca é apagado pela rotação (`start-dev.mjs:376-426`).
- O servidor escuta só em `127.0.0.1` (`start-dev.mjs:600`).

### 11.4 Exposição de segredos em processos, ambiente, histórico e logs

| Canal | Situação | Evidência |
|---|---|---|
| Argumentos de processo (`ps`, Gerenciador de Tarefas) | Segredos nunca vão em argv: `secret-tool store` lê da entrada padrão; DPAPI recebe base64 pela entrada padrão; o script do PowerShell vai em `-EncodedCommand` e não contém segredo; o Keychain usa `security -i` com comando pela entrada padrão | `linux-secret-service.ts:85-88`; `windows-dpapi.ts:50-53`, `104-115`; `command.ts:36-40` (`shell: false`) |
| Variáveis de ambiente | Só `FSLM_SECRET_KEY`, se usada. Ela é herdada pelo processo `next` e legível por processos do mesmo usuário | `start-dev.mjs:604` (A-08) |
| Histórico do shell | Nenhum comando documentado recebe segredo na linha. A API key e o client secret são digitados na tela, em campo de senha | `api-key-form.tsx`, `oauth-form.tsx` |
| Logs (`audit_events`) | Redigidos; só códigos e status | `redact.ts`, `logger.ts` |
| Terminal do `next dev` | Não verificado: o Next pode mostrar a URL de retorno do OAuth, com `code` e `state`, na saída do terminal. O código é de uso único e expira rápido | Limitação 13.6 |
| Mensagens de erro | Fixas ou sanitizadas; nunca incluem cabeçalho, corpo ou URL | `http.ts:135-145` |
| Respostas da API local | `GET /api/connection/status` e `GET /api/auth/oauth/config` não devolvem segredos (`has_client_secret` é booleano) | `connection.ts:30-81`; `oauth.ts:110-121` |

### 11.5 Cofres de credenciais

| Backend | Proteção | Situação de validação |
|---|---|---|
| Linux Secret Service (`secret-tool`) | Chaveiro da sessão (GNOME Keyring ou KWallet), sem shell, segredo pela entrada padrão, sonda com timeout de 3 s | Simulado (`secret-tool` falso). Chaveiro real não testado (`docs/VALIDACAO.md:244`) |
| Windows DPAPI | `ConvertFrom-SecureString` do usuário atual; arquivo `<dados>\secrets\<id>.dpapi` com só o texto cifrado; base64 contra problema de codepage | Simulado (runner falso). Windows real não executado |
| Arquivo AES-256-GCM | Chave de `FSLM_SECRET_KEY` (≥ 32 bytes) com HKDF-SHA256, IV aleatório, referência como AAD; arquivo `0600` | Testes unitários reais (sem simulação de criptografia) |
| Nenhum cofre disponível | Nada é gravado; erro claro | Testado |

Credenciais nunca são gravadas em texto puro pelo app. Exceção feita pelo próprio usuário: `FSLM_SECRET_KEY` num `.env` (A-08).

### 11.6 Arquivos locais, permissões e isolamento

- Diretório de dados: Fedora `~/.local/share/freshservice-local-mapper` (ou `$XDG_DATA_HOME/...`); Windows `%LOCALAPPDATA%\FreshserviceLocalMapper` (`src/lib/config/paths.ts:62-84`).
- Recusados: dentro de `public/`, pasta temporária, pasta de nuvem e caminho de rede no Windows. Symlinks resolvidos (`paths.ts:115-158`).
- POSIX: diretório `0700`, banco e arquivos auxiliares `0600` (`src/lib/db/bootstrap.ts:80-81`, `94`, `131`). Windows: depende da ACL do perfil; não há ACL extra.
- Instâncias: todas as tabelas de dados têm `instance_id` com `ON DELETE CASCADE`. Cada instância tem conexão e segredo próprios (`tests/auth/credential-isolation.test.ts`). As listas usam a instância ativa. As páginas de detalhe não filtram (A-09).
- Demonstração: instância própria `is_demo = 1`, domínio `.invalid`, recusada pelo motor; a remoção só apaga dados da demo (`src/lib/demo/seed.ts`).

## 12. Publicação no GitHub

| Verificação | Resultado |
|---|---|
| Banco fora do diretório público | Sim. Padrão fora do projeto; `public/` é recusado |
| Arquivos de dados excluídos do Git | Sim. `*.db`, `*.db-wal`, `*.db-shm`, `*.sqlite*`, `*.bak`, `.env*` (menos `.env.example`), `secrets/`, `*.dpapi`, `vault.enc.json`, `*token*.json`, `*credentials*.json`, `.e2e-data/`, `*.csv`, `*.xlsx` estão no `.gitignore`. Conferido com `git check-ignore` |
| Bancos de teste existentes no disco | Há bancos em `.e2e-data/`, todos ignorados pelo Git |
| Histórico Git | Vazio: o repositório não tem commits. Não há histórico a limpar |
| E-mails nos arquivos publicáveis | Só fictícios: `example.com`, `exemplo.com` e `acme.freshservice.com` em testes |
| URLs de instância | Só fictícias (`acme`, `cliente`, `empresa`, `sintetica`, `demo.freshservice.invalid`) ou de documentação pública |
| Capturas de tela (`docs/screenshots/`) | Mostram o modo demonstrativo com dados fictícios (conferida `dashboard.png`) |
| Caminho pessoal | `.claude/agents/*.md` contém `/home/<usuário>/...` (A-10) |
| `.claude/settings.local.json` | Ignorado pelo Git |
| Dados de cliente | Nenhum encontrado |

Riscos de publicação restantes: A-10 (arquivos de trabalho), A-13 (cadeia de suprimentos do CI) e o risco geral de alguém versionar por engano uma cópia do banco com outro nome de extensão. Recomendação: antes do primeiro commit, rodar `git status --ignored` e revisar a lista.

## 13. Resultado dos testes e níveis de validação

### 13.1 Testes executados nesta auditoria (host Fedora 44)

| Comando | Resultado |
|---|---|
| `pnpm test` | 57 arquivos; 662 testes aprovados; 3 pulados; 0 falhas (19,3 s) |
| `pnpm typecheck` | Sem erros |
| Script sintético de sanitização (seção 9.3) | Confirmou A-01 e A-05 |

Testes relevantes ao read-only: `tests/e2e/fake-freshservice.ts:81-87` responde 405 a qualquer método diferente de GET e registra cada chamada; `tests/e2e/flow.test.ts` percorre o fluxo completo contra esse servidor falso; `tests/auth/freshservice/http.test.ts` cobre allowlist de host, redirecionamento recusado em POST e o POST de token; `tests/audit/redact.test.ts` e `tests/audit/logger.test.ts` cobrem a redação. **Não há teste que falhe se um método de escrita for adicionado ao cliente** (A-04).

### 13.2 Três níveis de validação

| Funcionalidade | Ambiente real | Contêiner ou equivalente | Só simulação |
|---|---|---|---|
| Bootstrap, instalação, banco, `npm run dev` no Fedora 44 | Sim (máquina de desenvolvimento) | Sim (Fedora 44 limpo em podman) | — |
| `setup.sh` | — | Sim (vários cenários) | — |
| Testes unitários e de integração | Sim (host Fedora) | — | — |
| `setup.ps1` | — | Só sintaxe (PowerShell 7 em contêiner Linux) | Lógica |
| Bootstrap no Windows, `winget`, UAC, `taskkill`, caminhos `%LOCALAPPDATA%` | **Não executado** | — | Sim |
| DPAPI | **Não executado** | — | Sim (runner falso) |
| Secret Service com chaveiro real | **Não executado** | — | Sim (`secret-tool` falso) |
| Cofre AES-GCM com `FSLM_SECRET_KEY` | — | — | Testes reais de criptografia, sem rede |
| OAuth, API key, coleta e diagnóstico contra Freshservice | **Não executado** | — | Sim (`fetch` simulado e servidor falso) |
| Endpoints e formatos de resposta | **Não executado** | — | Sim (fixtures a partir da documentação) |

**O Windows 11 não está homologado.** Nenhuma execução real ocorreu. O workflow de CI para `windows-latest` (Windows Server) existe, mas ainda não rodou.

### 13.3 Limitações da auditoria

1. Nenhuma chamada real foi feita. O comportamento do servidor Freshservice (redirecionamentos, campos extras, escopos efetivos) não foi observado.
2. A análise cobre o código da árvore atual. Dependências de terceiros (Next.js, better-sqlite3, drizzle) não foram auditadas linha a linha; a afirmação de que não fazem rede vem do uso observado no código e da CSP.
3. Os escopos OAuth vêm da documentação pública e não foram conferidos em app registrado.
4. Windows e chaveiros reais não foram executados.
5. A sanitização foi verificada com registros sintéticos; respostas reais podem ter campos não previstos, que serão gravados se não estiverem nas listas de exclusão (normalização ampla).
6. Não foi verificado se o `next dev` imprime no terminal a URL de retorno do OAuth com o `code`.
7. A proteção de memória do processo (dumps, swap) não foi avaliada.

## 14. Recomendações priorizadas

1. Corrigir A-01 (exclusões em Locais e Fornecedores) e alinhar README e ENDPOINTS.
2. Criar o teste de arquitetura de A-04 e restringir o `POST` ao endpoint de token.
3. Corrigir o rótulo do formulário OAuth (A-03) e criar um cadastro de instância separado (A-15).
4. Orientar e, se possível, impor o mínimo de privilégios (A-02).
5. Usar caminhos absolutos de executáveis no Windows (A-07) e rodar o CI Windows antes de declarar suporte.
6. Avaliar "Somente metadados" por padrão em ITSM e uma allowlist de campos (A-05).
7. Revisar `.claude/` e `Prompt_*.txt` antes do primeiro commit (A-10).

## 15. Conclusão

Com base no código auditado em 2026-10-11, **a aplicação usa as APIs do Freshservice apenas para leitura**. As únicas requisições `POST` externas são técnicas, de token OAuth, e vão ao servidor de autorização Freshworks. Não foi encontrado caminho direto, indireto ou dinâmico que permita criar, alterar ou excluir tickets, itens de catálogo, formulários, usuários, permissões, artigos ou configurações do cliente. Os achados registrados tratam de privacidade, privilégios de credencial, usabilidade e robustez. Nenhum deles muda esse veredito.
