# Autenticação e conexão com o Freshservice

> **Status (2026-10-12): não homologado.** O OAuth por perfis de integração está implementado e coberto por testes e pelo simulador local (`FSLM_SIMULATOR=1`). **Nenhuma chamada real ao Freshworks ou ao Freshservice foi feita, e nenhuma credencial real foi usada.** Antes de qualquer chamada real é preciso aprovação explícita (ver `docs/VALIDACAO.md`).
>
> Para o uso por analistas e administradores, leia `docs/AUTENTICACAO-UX-ANALISTA.md` e `docs/GUIA-DE-USO-E-COLETA.md`. Este documento é a referência técnica.

## 0. Resumo do modelo

- **Dois caminhos de conexão.** OAuth 2.0 (authorization code) é o caminho principal. API key é uma opção técnica avançada, recolhida na tela.
- **Perfil de integração.** O OAuth depende de um perfil por organização Freshworks do cliente. Um responsável cadastra o perfil uma vez, em **Configurações → Administração da integração**. O analista não configura credenciais.
- **Correspondência estrita.** A instância é associada a um perfil pelo hostname, que precisa estar em `freshservice_domains`. O app nunca presume a organização Freshworks a partir do domínio `*.freshservice.com`.
- **Somente leitura.** O app só faz `GET` na API do Freshservice. A única escrita HTTP é o `POST` de troca e renovação de token em `/oauth/v2/token`.

## 1. Instância

- A URL precisa ser `https`. O app guarda só a origem (`https://<host>`). Caminho, query e fragmento são descartados.
- Aceita `*.freshservice.com`. Domínios customizados são recusados, mesmo com `allow_custom_domain: true`; registros legados permanecem intactos. A referência da API informa que a API funciona nos domínios Freshservice, e não em CNAME customizado.
- Recusados: `http`, usuário e senha na URL, porta diferente de 443, IPs (inclusive formas numéricas como `2130706433`), `localhost`, `*.local`, `*.internal`, `*.localdomain`, `*.home.arpa`, `.arpa`, nomes sem domínio completo, IDN (punycode `xn--`) e caracteres não ASCII.
- A regra está em `src/lib/security/url.ts` (`normalizeInstanceUrl`). Testes em `tests/auth/security/url.test.ts`.
- API: `GET /api/instances` (lista, sem dados sensíveis) e `POST /api/instances` com `{ base_url, display_name?, allow_custom_domain? }`. A instância ativa fica em `app_settings.active_instance_id`.

## 2. Perfil de integração (administração)

Um perfil representa **um aplicativo OAuth registrado em uma organização Freshworks**. Há um perfil por organização do cliente. Tabela `integration_profiles` (migração `drizzle/0004_integration_profiles.sql`).

### 2.1 Campos

| Campo | Obrigatório na criação | Padrão | Regra |
|---|---|---|---|
| `name` | Sim | — | 1 a 80 caracteres. Aparece na lista e no status da conexão. |
| `org_url` | Sim | — | `https://<org>.freshworks.com` ou `https://<org>.myfreshworks.com`. Só a origem é guardada (`src/lib/security/url.ts`, `normalizeFreshworksOrgUrl`). |
| `client_id` | Sim | — | 3 a 200 caracteres imprimíveis. |
| `client_secret` | Sim (na criação) | — | 8 a 512 caracteres imprimíveis. Vai para o cofre de segredos. A API nunca o devolve (só `has_secret`). Na edição, se omitido, o segredo atual é mantido. |
| `freshservice_domains` | Sim | — | 1 a 20 hostnames `*.freshservice.com`. Cada domínio pertence a no máximo um perfil (`domain_conflict`, 409). |
| `scopes` | Não | Somente `.view`, derivados dos módulos sincronizáveis (`DEFAULT_PROFILE_SCOPES`) | Devem existir na lista oficial (`OFFICIAL_SCOPES`, 167 escopos em `src/lib/freshservice/official-scopes.ts`). Escopos fora de `.view` (incluindo `.manage` e `.edit`) exigem `allow_manage_scopes`. |
| `allow_manage_scopes` | Não | `false` | Permite escopos fora de `.view`, incluindo `.manage` e `.edit`. Quando marcado, a resposta da API traz o aviso `manage_scopes_granted`. |
| `path_prefix` | Não | `/org` | Prefixo da autorização: `/org` ou vazio. Ver 5.3. |
| `token_path_prefix` | Não | vazio | Prefixo independente para troca e renovação: `/org` ou vazio. |
| `redirect_host` | Não | `localhost` (padrão do servidor e do formulário) | `localhost` ou `127.0.0.1`. Define o `redirect_uri` cadastrado no Freshworks. Ambos funcionam com o painel em `127.0.0.1`; ver 4.3. |

O `redirect_uri` é sempre `http://<redirect_host>:<PORT>/api/auth/oauth/callback`, e a API o devolve em cada perfil (`redirect_uri`).

### 2.2 Endpoints administrativos

| Método | Caminho | Função |
|---|---|---|
| GET | `/api/admin/integration-profiles` | Lista os perfis e devolve `default_scopes`, `redirect_hosts` e `path_prefixes` (opções do formulário). Sem `client_secret`. |
| POST | `/api/admin/integration-profiles` | Cria um perfil. Resposta 201: `{ profile, warnings }`. |
| PUT | `/api/admin/integration-profiles/{id}` | Atualiza campos (todos opcionais). |
| DELETE | `/api/admin/integration-profiles/{id}` | Remove o perfil. Recusado com `profile_in_use` (409) se uma conexão ainda o usa. |

Erros possíveis: `invalid_input` (400), `invalid_url` (400), `invalid_domain` (400), `invalid_scope` (400), `manage_scopes_not_allowed` (400), `domain_conflict` (409), `profile_not_found` (404), `profile_in_use` (409), `unsupported_media` (415) e erros de cofre (`vault_unavailable` 503, `vault_error` 500).

**Proteção.** As rotas administrativas estão atrás da guarda local de Host e Origin (seção 13). Essa guarda protege contra páginas de outros sites no navegador. **Ela não autentica quem usa a API.** Não há login de administrador: um programa local que envie os cabeçalhos corretos consegue alterar perfis. Limitação aceita para uso local (seção 16).

### 2.3 Migração da configuração anterior

- A configuração OAuth global anterior (`app_settings.oauth_config`) vira um perfil na primeira leitura de perfis. A chave é apagada na mesma transação. O `redirect_host` 127.0.0.1 é mantido nesse caso, porque é o que já estava cadastrado.
- `GET` e `POST /api/auth/oauth/config` respondem **410** (`moved`), com a indicação de `/api/admin/integration-profiles`.

## 3. Registro do aplicativo no Freshworks (administrador, uma vez por organização)

Fontes: [Criar credenciais OAuth](https://developers.freshworks.com/docs/app-sdk/v3.0/service_ticket/advanced-interfaces/request-method/oauth-access-freshworks-resources/) e [OAuth em aplicativos externos](https://developers.freshworks.com/docs/app-sdk/v3.0/service_ticket/oauth-implementation-in-apps/oauth-in-external-apps/).

1. No Developer Portal da organização do cliente, em configurações, abrir **OAuth Credentials** e criar uma credencial.
2. Preencher **Name** (até 3 palavras) e **Description**. O usuário vê os dois na tela de autorização.
3. Em **Redirect URL**, cadastrar **exatamente** o `redirect_uri` que a tela de administração mostra para o perfil (formato `http://<host>:<PORTA>/api/auth/oauth/callback`). A documentação permite até 5 URLs por credencial. Se a porta do app mudar, o redirect cadastrado precisa mudar junto.
4. Escolher os escopos. Escopos são fixados na criação, e a documentação diz que a remoção não é suportada. **Não documentado:** como adicionar escopos depois. Confirmar no portal.
5. Copiar o **Client ID** e o **Client Secret** e informá-los ao cadastrar o perfil no app.

## 4. Fluxo OAuth

### 4.1 Sequência

1. **Pré-verificação.** Ao digitar o link (após 400 ms) ou ao voltar o foco ao painel, a interface chama `GET /api/auth/oauth/preflight?url=<link>`. A rota não cria instância, conexão nem cookie.
2. **Ação do analista.** "Conectar conta autenticada" faz `POST /api/instances` (salva e ativa a instância) e depois `GET /api/auth/oauth/preflight`.
3. **Sem perfil.** A resposta traz `admin_config_missing`. Nenhuma aba é aberta, e a interface indica a tela de administração.
4. **Com perfil.** A interface faz `POST /api/auth/oauth/launch`, protegido por Host, Origin e Sec-Fetch-Site, e abre uma passagem no host do callback. A passagem assinada fica no fragmento, dura 60 s e só pode ser usada uma vez. Não contém credenciais Freshservice.
5. **Início.** `GET /api/auth/oauth/start` no host do perfil:
   - Host diferente do `redirect_host` recebe **303** para o mesmo caminho no host do perfil, antes de gravar cookie.
   - `Sec-Fetch-Site` cross-site recebe **403**.
   - Gera `state` com 32 bytes aleatórios (base64url) e grava o estado `awaiting_authorization`.
   - Grava o cookie de state (seção 13).
   - Em navegação de topo (`Sec-Fetch-Mode: navigate`), responde **303** para a URL de autorização. Em outras chamadas, responde JSON com `authorization_url`.
6. **Autorização.** `GET https://<org>{prefixo}/oauth/v2/authorize` com `response_type=code`, `client_id`, `state`, `scope` (separado por espaço) e `redirect_uri`. PKCE não é usado (não documentado).
7. **Login e consentimento no Freshworks.** Se o navegador já tiver sessão válida, o provedor pode pular o login. **Não documentado** de forma explícita para o Freshworks.
8. **Retorno.** `GET /api/auth/oauth/callback?code=...&state=...` (no host do perfil):
   - Valida o cookie (tipo, assinatura HMAC, validade de 10 min), o callback exato e o `state` com comparação em tempo constante; recusa reutilização no servidor. A origem pública vem de Host com allowlist local e porta exata, sem confiar em X-Forwarded-Host. Falha vira `error` no retorno.
   - Negação ou cancelamento (`access_denied`) apaga os tokens locais e grava `disconnected` com detalhe `authorization_denied`.
   - Outro erro do provedor grava `connection_error`.
9. **Troca do código.** `POST https://<org>{token_path_prefix}/oauth/v2/token` com `Authorization: Basic base64(client_id:client_secret)`, corpo `grant_type=authorization_code`, `code` e `redirect_uri` (`postTokenRequest`, `src/lib/freshservice/http.ts`). Os tokens vão para o cofre. A referência gravada na conexão é `secret_ref`.
10. **Verificação.** Uma leitura de metadados compatível com os escopos concedidos (seção 7). Sem nenhuma leitura possível, grava `no_permission` com detalhe `insufficient_scope`.
11. **Conclusão.** O app responde **303** para `/auth/concluido?conn=<estado>` e apaga o cookie de state. A aba do painel recebe o resultado por `BroadcastChannel` (`fslm-auth`) e por consulta a `GET /api/connection/status` a cada 2 s, por até 10 minutos. Se o estado não for concluído nesse prazo, a interface mostra "Parar de aguardar" e pede nova tentativa.

### 4.2 Retorno ao painel

A página `/auth/concluido` mostra uma mensagem curta por estado (`conn`). Ela não mostra código, token ou parâmetros da URL. O painel remove `?conn=` da URL depois de ler o estado.

### 4.3 Host de redirecionamento (`redirect_host`)

- `localhost` e `127.0.0.1` são origens distintas: cookies e BroadcastChannel não são compartilhados.
- O painel permanece em `http://127.0.0.1:PORT/`. `app_url` sempre aponta para essa origem.
- O POST de lançamento emite uma passagem assinada vinculada à instância, perfil e callback; a página `/auth/iniciar` no host do callback apaga o fragmento e navega ao start na própria origem. O servidor recusa passagens expiradas, adulteradas, reutilizadas ou usadas em outro host. Um site externo não pode emitir essa passagem.
- O cookie de state é criado apenas no host do callback: HttpOnly, SameSite=Lax, Path=/api/auth/oauth, sem Domain, válido por 10 minutos. O payload assinado distingue state de passagem e fixa o callback exato (origem, porta e caminho). A validação de uso único permanece no servidor.
- `/auth/iniciar`, `/auth/concluido` e `/simulador/*` preservam o host, além de `/api/*`. As demais páginas em localhost continuam redirecionando ao painel canônico. As rotas do simulador permanecem desligadas sem a flag explícita.
- O callback apaga o cookie e responde 303 para `/auth/concluido?conn=<estado>` na própria origem. Em localhost, essa página navega por JavaScript para o endereço fixo `http://127.0.0.1:PORT/auth/concluido?conn=<estado>`. Só o estado final vai para o painel; códigos e tokens não seguem nessa navegação. Isso preserva a CSP `form-action 'self'`, inclusive no consentimento do simulador.
- Já na origem canônica, a página comunica a conclusão por BroadcastChannel; o painel também consulta o status persistido no backend. Os tokens permanecem no cofre local, sem cookie de sessão compartilhado entre hosts.
- Cadastre no provedor exatamente o callback mostrado pelo perfil: `http://localhost:PORT/api/auth/oauth/callback` para o padrão localhost. O exemplo do FDK `http://localhost:10001/auth/callback` não é a rota deste app.

## 5. Endpoints OAuth e situação na documentação

| Uso | Endpoint | Situação na documentação |
|---|---|---|
| Autorização | `GET https://<org>{prefixo}/oauth/v2/authorize` | **Documentado com ambiguidade.** O texto cita `/oauth/v2/authorize`, e os exemplos usam `/org/oauth/v2/authorize`. Ver 5.3. |
| Troca do código | `POST https://<org>{token_path_prefix}/oauth/v2/token`, `Basic(client_id:client_secret)` | **Documentado.** |
| Resposta | `access_token`, `refresh_token`, `token_type`, `scope`, `expires_in` | **Documentado** em parte. Sem `expires_in` no exemplo, o app usa 1800 s (`OAUTH_DEFAULT_EXPIRES_IN_S`). |
| Uso do token na API | `Authorization: Bearer <access_token>` | **Documentado** no [changelog da REST v2 (abr/2024)](https://api.freshservice.com/). A seção "Authentication" da mesma referência ainda cita só API key. Divergência documental. |
| Renovação | `POST` no mesmo endpoint, com `grant_type=refresh_token` | **Não documentado.** A doc cita a renovação, sem endpoint nem parâmetros. O app segue a RFC 6749 §6. |
| Validade | Access token 30 min; refresh token 365 dias | **Documentado.** |
| Revogação | — | **Não documentado.** O app apaga só os segredos locais. |
| PKCE | — | **Não documentado.** Não é usado. |
| Redirect `localhost` | `http://localhost:10001/auth/callback` (exemplo) | **Documentado** como exemplo local. |
| Redirect `127.0.0.1` | — | **Não documentado.** |
| Organização | `<empresa>.myfreshworks.com` gerado automaticamente | **Documentado** no [artigo de suporte 50000002731](https://support.freshworks.com/en/support/solutions/articles/50000002731). Não há mapeamento documentado de `*.freshservice.com` para a organização. |

Restrição de marketplace: um relato da comunidade (mai/2024) diz que OAuth para a REST é "exclusivamente para apps marketplace" ([link](https://community.freshworks.dev/t/freshworks-introduces-multi-oauth-functionality-for-app-developers-and-oauth-support-for-freshservice-apis/12798)). Nenhuma documentação posterior refutou isso. Há ainda relatos de `invalid_scope` em set/2025 ([link](https://community.freshworks.dev/t/oauth-2-0-authorization-failing-with-invalid-scope-error-in-freshservice/18803)). Esses pontos são **risco de homologação**.

### 5.3 Prefixo dos caminhos OAuth (`path_prefix`)

- O campo aceita `'/org'` ou `''`. Qualquer outro valor é recusado. O valor vem de allowlist fixa (`src/lib/oauth-path.ts`) e nunca altera a origem validada da organização.
- Perfis novos usam `/org`, por ser a forma dos exemplos concretos da documentação.
- Configurações salvas antes do campo existir são lidas como `''`, para não quebrar um fluxo que já funcionava.
- `path_prefix` controla apenas a autorização (padrão `/org`); `token_path_prefix` controla troca e renovação (padrão vazio, `/oauth/v2/token`). Os campos são independentes. URL da organização é a origem HTTPS confirmada pelo administrador, sem derivá-la da URL Freshservice.

## 6. Renovação, expiração e encerramento

- **Renovação antecipada.** O token é renovado 60 s antes do vencimento (`OAUTH_REFRESH_MARGIN_MS`), por `resolveOAuthAccessToken` (`src/lib/auth/oauth.ts`).
- **Recusa do provedor no refresh** (`invalid_grant` ou 400/401): grava `session_expired` (401), **apaga os tokens locais** e pede nova conexão.
- **Falha transitória** (rede, 5xx, 429, cofre indisponível): grava `connection_error` (503) e **mantém os tokens**. Nenhuma sessão é encerrada por erro transitório.
- **Concorrência.** No motor de sincronização, uma única renovação por instância é compartilhada dentro do processo (`sharedFlight`, `src/lib/sync/token.ts`). Entre processos não há lock. O teste de conexão chama `resolveOAuthAccessToken` diretamente e não usa esse compartilhamento.
- **Desconectar** (`POST /api/connection/disconnect`): apaga os segredos locais da conexão (tokens ou API key) e mantém o histórico da instância. O perfil de integração, com o client secret no cofre, é mantido para reconectar depois. **Não revoga a autorização no Freshworks**, porque a revogação não é documentada. Para revogar, remova o aplicativo no painel do Freshworks.
- **Negação ou cancelamento** no retorno também apaga os tokens locais.

## 7. Verificação após a autenticação e teste de conexão

- **OAuth.** Após obter o token, o app faz uma leitura de metadados. Ela é escolhida entre `departments`, `locations`, `products`, `vendors` e `sla_policies` (`pickVerificationPath`, `src/lib/auth/profiles.ts`): a primeira cujo escopo de leitura está concedido. Sem candidato, o estado é `insufficient_scope` e nenhuma chamada é feita.
- **API key.** A verificação usa `GET /api/v2/ticket_form_fields` (`VALIDATION_PATH`, `src/lib/auth/probe.ts`). Essa leitura exige `freshservice.tickets.fields.manage` no OAuth, por isso não é usada no fluxo OAuth.
- **Identidade.** `GET /api/v2/agents/me` não aparece na referência consultada, e o app não o usa. Por isso o rótulo da conta em OAuth é fixo (`Freshworks OAuth`), e a tela não mostra o nome do agente.
- **Teste de conexão** (`POST /api/connection/test`): revalida com a mesma regra. Com renovação, se necessário.

## 8. Política de escopos

- **Padrão: somente `.view`.** Os escopos padrão são derivados dos módulos sincronizáveis do catálogo (`DEFAULT_PROFILE_SCOPES`, via `viewScopesForPaths`). Não há `.manage` ou `.edit` por padrão.
- **Mapa de leitura.** `MODULE_GET_SCOPES` (24 caminhos) associa cada `GET` coletado ao escopo exigido pela ação oficial correspondente. `UNDOCUMENTED_SCOPE_PATHS` lista `service_catalog/categories`, que não tem bloco de escopo na documentação. Esse caminho não tem checagem prévia.
- **Escopos de escrita exigidos pela documentação para leitura.** Ficam bloqueados por padrão e só entram com `allow_manage_scopes` e autorização do cliente:
  - `agents`: `freshservice.agents.manage`;
  - `groups`: `freshservice.agentgroups.manage`;
  - `ticket_form_fields`: `freshservice.tickets.fields.manage`;
  - `service_catalog/items` e `service_catalog/items/{display_id}`: `freshservice.service_catalog.edit`.
- **Gate no sync e no diagnóstico** (`src/lib/sync/scopes.ts`). Em conexão OAuth com perfil, um módulo cujo escopo não está em `profile.scopes` **não gera chamada à API**. Ele grava `api_modules.access_status = forbidden` com `access_detail = scope_not_granted` e fica `skipped`. A execução segue para os demais módulos.
- **Efeito no status da execução.** Com módulo bloqueado, a execução termina `partial`. Se nenhum módulo concluir, termina `failed`.
- **Fonte da checagem.** O gate usa `profile.scopes`. Os escopos devolvidos pelo token ficam em `connections.scopes`, mas não entram na checagem. Um `403` do provedor continua sendo tratado como `forbidden`, sem `scope_not_granted`.
- **Conversas e atividades de tickets.** Têm escopo mapeado, mas não entram no padrão nem no sync (política de privacidade).

## 9. API key (opção técnica avançada)

- **Modos.** `api_key_personal`: chave de um agente, com o alcance do papel dele. `api_key_integration`: usuário de integração, identidade técnica, recomendado quando a organização permitir ([como criar](https://support.freshservice.com/support/solutions/articles/50000014413-manage-integration-users-in-freshservice)).
- **Endpoint.** `POST /api/connection/api-key` com `{ "mode": "api_key_personal" | "api_key_integration", "api_key": "..." }`. A chave tem 8 a 512 caracteres imprimíveis.
- **Validação antes de gravar.** A chave é usada numa leitura de teste. `401` não grava nada e deixa o estado `awaiting_authentication`. `403` grava a chave e marca `no_permission`. Sucesso grava `connected`.
- **Autenticação.** Basic com a API key como usuário e `X` como senha (documentado na referência).
- **Não exige perfil de integração.** API key não passa pelo gate de escopos.
- Trocar de modo, ou trocar de OAuth para API key, remove o segredo anterior.

## 10. Cofre de segredos

Ordem de escolha (`src/lib/secrets/vault.ts`):

| Sistema | Backend | Observação |
|---|---|---|
| Linux | libsecret via `secret-tool` | Sem shell. O segredo entra pela entrada padrão, nunca pelos argumentos. Sonda `secret-tool search --all fslm-probe x` com timeout de 3 s. Código 0, ou código 1 sem texto de erro, indica serviço disponível. Erro de D-Bus, código inesperado ou timeout indica indisponível, com motivo fixo. |
| macOS | Keychain via `/usr/bin/security` | Gravação por `security -i` pela entrada padrão. Valor em base64. |
| Windows | DPAPI via PowerShell | `ConvertTo/ConvertFrom-SecureString`. Texto cifrado em `<dados>/secrets/<id>.dpapi` (0600 em POSIX). |
| Qualquer | Arquivo AES-256-GCM | Só existe com `FSLM_SECRET_KEY` (base64, pelo menos 32 bytes decodificados). Chave derivada com HKDF-SHA256 (`src/lib/secrets/encrypted-file.ts`). Arquivo `<dados>/secrets/vault.enc.json` (0600). |

- **Gravação.** Secret Service se a sonda responder. Senão, arquivo AES-GCM se `FSLM_SECRET_KEY` for válida. Senão, erro. Se o backend disponível recusar a gravação (chaveiro bloqueado, timeout), tenta o próximo. Se o último (arquivo) falhar, o erro real é mantido.
- **Leitura.** Sem varredura entre backends. A referência (`<backend>:<uuid>`) indica onde o segredo está. Com D-Bus indisponível, ler uma referência do Secret Service devolve `vault_unavailable` (503), nunca "sem segredo".
- **Sem cofre disponível.** Nada é gravado. A mensagem diz "Nenhum cofre seguro disponível: configure cofre seguro (Secret Service desbloqueado ou FSLM_SECRET_KEY)" e lista o motivo de cada backend.
- `connections.secret_ref` e `integration_profiles.client_secret_ref` guardam só a referência. Nunca o segredo.
- Gerar a chave do fallback: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Guardá-la fora do projeto. Perdê-la torna o arquivo do cofre ilegível. Não há rotação de chave.
- Linux, macOS e Windows foram testados só com runner simulado. Não foram executados em sistema real.

## 11. Estados da conexão

O campo `status` da API (`GET /api/connection/status`) é o estado de exibição. Ele combina `connections.status` e `connections.status_detail` (migração 0004, aditiva), além de dois estados derivados (`admin_config_missing` e `demo`), que não são gravados.

| `status` na API | Gravação no banco | Quando | O que fazer |
|---|---|---|---|
| `disconnected` | `status = disconnected` | Sem conexão. | Conectar. |
| `admin_config_missing` | Derivado, sem gravação | OAuth para uma instância sem perfil de integração que cubra o domínio. | Um responsável cadastra o perfil em Configurações → Administração da integração. |
| `awaiting_authorization` | `status = awaiting_authorization` | Fluxo iniciado, aguardando o navegador. Expira em 10 min. | Concluir na aba do Freshworks. |
| `connected` | `status = connected` | Leitura de verificação concluída. | Seguir para o mapeamento. |
| `authorization_denied` | `status = disconnected`, `status_detail = authorization_denied` | Usuário negou ou cancelou. Tokens apagados. | Conectar de novo e aprovar o acesso. |
| `insufficient_scope` | `status = no_permission`, `status_detail = insufficient_scope` | Tokens válidos, mas nenhum escopo cobre uma leitura de verificação. | Responsável revisa os escopos do perfil. |
| `no_permission` | `status = no_permission` | Verificação retornou 403. | Conferir o papel da conta. |
| `session_expired` | `status = session_expired` | Renovação recusada pelo provedor, ou 401 em uso. Tokens apagados. | Conectar de novo. |
| `connection_error` | `status = connection_error` | Falha transitória: rede, timeout, 5xx, 429, cofre ou troca do código. Tokens mantidos. | Tentar de novo. |
| `awaiting_authentication` | `status = awaiting_authentication` | API key rejeitada (401). | Revisar a chave. |
| `demo` | Derivado | Instância de demonstração (`is_demo = 1`). Nunca consulta o Freshservice. | Sair da demonstração. |

Mensagens fixas por detalhe estão em `DETAIL_MESSAGES` (`src/lib/auth/connection.ts`). Rótulos da tela estão em `src/lib/ui/status.ts`.

## 12. Endpoints HTTP de autenticação

| Método | Caminho | Função |
|---|---|---|
| GET | `/api/instances` | Lista instâncias e a ativa. |
| POST | `/api/instances` | Cadastra ou reativa uma instância. |
| GET | `/api/connection/status` | Estado da conexão, sem segredos. Inclui `profile` e `oauth_configured`. |
| POST | `/api/connection/api-key` | Valida e grava a API key (opção avançada). |
| POST | `/api/connection/test` | Revalida a conexão, com renovação se necessário. |
| POST | `/api/connection/reconnect` | OAuth: devolve `authorization_url` e grava o cookie de state. API key: revalida. |
| POST | `/api/connection/disconnect` | Apaga os segredos locais. Mantém o histórico. |
| GET | `/api/auth/oauth/preflight` | Prontidão do fluxo, com `?url=` opcional para um link ainda não salvo. Não grava nada. |
| GET | `/api/auth/oauth/start` | Início do OAuth (303 ou JSON). Grava o estado e o cookie. |
| POST | `/api/auth/oauth/launch` | Emite passagem assinada de uso único para iniciar no host do callback; exige a guarda local contra CSRF. |
| GET | `/api/auth/oauth/callback` | Retorno do Freshworks. 303 para `/auth/concluido?conn=<estado>`. |
| GET, POST | `/api/auth/oauth/config` | **410**: movido para `/api/admin/integration-profiles`. |
| GET, POST | `/api/admin/integration-profiles` | Lista e cria perfis (seção 2.2). |
| PUT, DELETE | `/api/admin/integration-profiles/{id}` | Atualiza e remove perfis. |
| GET | `/api/simulador/status` | Só com `FSLM_SIMULATOR=1`. Sem a variável, 404. |

Não existe `POST /api/connection/start`. A interface usa `POST /api/auth/oauth/launch` e abre a passagem em nova aba; nela, a navegação para `GET /api/auth/oauth/start` ocorre no host correto.

## 13. Segurança local

- **Guarda** (`src/proxy.ts`, Next 16 usa `proxy`), aplicada a todas as rotas exceto arquivos estáticos:
  - `Host` deve ser `127.0.0.1:PORT` ou `localhost:PORT` (anti DNS rebinding); outro valor recebe 403 `forbidden_host`;
  - `POST`, `PUT`, `PATCH` e `DELETE` exigem `Origin` local e `Sec-Fetch-Site` same-origin ou none; caso contrário, 403 `forbidden_origin`;
  - sem CORS: nenhuma origem externa recebe permissão;
  - cabeçalhos: CSP, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` e `Cache-Control: no-store` em `/api`.
- **CSP:** `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `connect-src 'self'`. `script-src` e `style-src` têm `'unsafe-inline'` (risco aceito, seção 17). `'unsafe-eval'` e o WebSocket do HMR só existem em dev.
- **Cookie de state:** `fslm_oauth_state`, `HttpOnly`, `SameSite=Lax`, `Path=/api/auth/oauth`, `Max-Age=600`. O valor é assinado com HMAC-SHA256. A chave fica em `<dados>/oauth-state.key` (0600). Sem `Secure` em HTTP local (risco aceito, seção 17).
- **Retorno:** o `state` é comparado em tempo constante. Parâmetros da URL nunca são ecoados na resposta. Em erro, o log traz só o nome do erro (`console.error` em `src/lib/auth/route-utils.ts`).
- **Auditoria:** `audit_events` recebe só códigos e status. Testes garantem que chave de API, tokens, client secret, código e state não entram no banco.

## 14. Saídas HTTP e destino de rede

Cliente base: `src/lib/freshservice/http.ts`, função `safeRequest`.

- **Allowlist de hosts** por chamada: host da instância ativa e host de autenticação Freshworks.
- **Redirecionamentos.** `redirect: 'manual'`. Em `GET`, o mesmo host é seguido até 3 vezes. `POST` não segue redirecionamento.
- **Checagem de DNS em cada salto**, antes do fetch (`ensurePublicDnsTarget`, `src/lib/security/dns-guard.ts`). Recusa se **qualquer** endereço resolvido for não público: loopback, privado (10/8, 172.16/12, 192.168/16, fc00::/7), link-local (169.254/16, fe80::/10, inclusive metadados de nuvem), CGNAT (100.64/10), não especificado, multicast, reservado, ou IPv4 mapeado, NAT64 e 6to4 desses. A mensagem não traz host nem IP.
- **Cache de DNS:** 60 s, só para resultados aprovados. Recusas são verificadas de novo. Timeout de DNS de 5 s. Falha de DNS fecha por padrão (erro de rede no cliente; `dns_failed` 400 no cadastro).
- **Timeouts.** 15 s para autenticação, teste de conexão e diagnóstico (`FRESHSERVICE_TIMEOUT_MS`). 30 s para o motor de sincronização (`SYNC_DEFAULTS`).
- **Limite de corpo.** 2 MiB no `safeRequest` (inclusive o POST de token). 20 MiB no cliente de leitura usado por verificação, diagnóstico e motor (`CLIENT_MAX_BODY_BYTES`).
- **Retry-After.** Respeitado pelo motor, com teto de 120 s.
- **Erros classificados:** `unauthorized`, `forbidden`, `not_found`, `rate_limited`, `server_error`, `client_error`, `timeout`, `network`, `redirect_refused`, `host_not_allowed`, `unsafe_url`, `invalid_response`, `too_large`, `cancelled`. Mensagens nunca incluem cabeçalhos, corpo ou URL.

## 15. Simulador local (testes)

O simulador é um provedor OAuth e uma API v2 **fictícios**, para exercitar o fluxo e as telas sem Freshworks. Não é autenticação Freshworks nem Freshservice.

- **Ativação:** somente com `FSLM_SIMULATOR=1` (valor exato) no processo do servidor. Sem a variável, `/simulador/**`, `/simulador/control` e `/api/simulador/status` respondem 404, e os hosts simulados são recusados pelos validadores de URL. O DNS não é contornado para nenhum outro host.
- **Hosts reservados (TLD `.invalid`):** instância `https://<nome>.freshservice.simulador.invalid` e organização `https://<nome>.myfreshworks.simulador.invalid`. São atendidos em processo, pelo hook de `safeRequest`, sem socket e sem DNS.
- **API simulada:** só `GET`. Token ausente, inválido ou expirado recebe 401. Escopo ausente recebe 403 `invalid_scope`. Papel sem permissão recebe 403 `access_denied`. Paginação `page` e `per_page` (máximo 100) com `Link rel="next"`. API key em Basic. Falha de rede controlada por módulo.
- **Limite:** o simulador não reproduz 429 nem `Retry-After`. Os dados de fixture não foram validados contra a API real.
- **Identificação:** faixa "SIMULADOR" fixa no topo de todas as telas, publicada pelo layout raiz somente com a flag.
- **Credenciais fictícias** em `src/lib/simulator/fixtures.ts`.
- **Cuidado:** `pnpm dev` repassa o ambiente ao processo do Next. Um `FSLM_SIMULATOR=1` exportado no shell liga o simulador em qualquer execução. Não colocar essa variável no `.env`.

Hooks mínimos no código de produção, todos condicionados à flag ou a hosts simulados: `src/lib/security/url.ts` (TLD reservado e organização), `src/lib/security/dns-guard.ts` (`ensurePublicDnsTarget`), `src/lib/freshservice/http.ts` (`safeRequest`) e `src/lib/auth/oauth.ts` (construção da URL de autorização).

## 16. Limitações e pendências

1. **Não homologado.** Nenhuma chamada real foi feita. Há risco de homologação (seção 5): a comunidade afirma que o OAuth da REST é exclusivo de apps marketplace, e há relatos de `invalid_scope`.
2. **`redirect_host`.** A compatibilidade local com localhost foi corrigida (F4, seção 4.3). A aceitação do callback pelo provedor real permanece sem homologação.
3. **Renovação.** Endpoint e parâmetros não documentados. Implementado pela RFC 6749 §6.
4. **PKCE.** Não usado, por não estar documentado.
5. **Revogação remota.** Não documentada. O app só apaga segredos locais.
6. **Identidade.** Sem endpoint de identidade na lista consultada. O rótulo da conta é fixo.
7. **Organização.** A relação entre `*.freshservice.com` e a organização `*.myfreshworks.com` não é documentada. Por isso o perfil é explícito e a correspondência é estrita.
8. **SSO.** Reuso de sessão não documentado explicitamente para o Freshworks. O simulador cobre o caso.
9. **Administração sem login.** A guarda de Host e Origin não autentica quem usa as rotas `/api/admin/*` (seção 2.2).
10. **Gate de escopos.** Usa `profile.scopes`, não os escopos devolvidos pelo token. A checagem é prévia e local.
11. **Escopos de escrita.** Quatro caminhos de leitura exigem `.manage` ou `.edit` pela documentação. Conferir com conta real antes de confiar no bloqueio.
12. **`insufficient_scope` é inferido.** Pelos escopos concedidos, porque o cliente não expõe o corpo de respostas 4xx do provedor.
13. **Simulador.** `scopeKeyFor` em `src/lib/simulator/fixtures.ts` remove IDs numéricos. Por isso o escopo de `tickets/{id}/*` não é aplicado no simulador.
14. **Renovação entre processos.** Sem lock. A renovação compartilhada vale só dentro do processo (seção 6).
15. **Pop-up do navegador.** Sem pré-verificação em cache, a aba é aberta depois da checagem, e o navegador pode bloqueá-la. Nesse caso, a interface oferece o link "use este link".
16. **Cofres.** Windows (DPAPI) e macOS (Keychain) não foram executados em sistema real. Linux foi exercitado só com `secret-tool` falso.
17. **Cookie de state sem `Secure`** e CSP com `'unsafe-inline'` (seção 17).

## 17. Decisões de segurança

Cada item diz o risco, o motivo e a evolução prevista.

### 17.1 CSP com `'unsafe-inline'` (risco aceito)

- **Onde:** `src/lib/security/headers.ts`. `script-src` e `style-src` incluem `'unsafe-inline'`.
- **Risco:** com `'unsafe-inline'`, uma injeção de HTML poderia executar script inline.
- **Motivo:** o App Router injeta scripts e estilos inline (hidratação e payload RSC). Sem nonce por requisição, a CSP não pode bloquear inline sem quebrar a página.
- **Mitigações:** o app escuta só em 127.0.0.1; a guarda recusa Host e Origin fora da lista local; `connect-src 'self'`; `object-src 'none'`; `frame-ancestors 'none'`; a interface escapa o texto por padrão (React).
- **Evolução:** nonce por requisição no proxy e `'strict-dynamic'`. Custo: páginas dinâmicas. Fica para uma fase própria.

### 17.2 Cookie de state sem `Secure` (risco aceito)

- **Onde:** `src/lib/auth/oauth.ts`, função `buildStateCookie`.
- **Motivo:** o `redirect_uri` é HTTP em loopback, e o suporte a cookie `Secure` em `http://127.0.0.1` varia entre navegadores.
- **Risco:** o cookie trafega em texto puro, mas só no loopback. Quem lê esse tráfego já está na própria máquina.
- **Evolução:** definir `Secure` quando a origem for `https`.

### 17.3 Host de loopback (`redirect_host`)

- Rotas `/api` aceitam `localhost` e `127.0.0.1`. As páginas OAuth de passagem/conclusão e do simulador preservam o host; demais páginas em localhost vão para 127.0.0.1 com 307. Os destinos do fluxo são fixos, sem open redirect.
- O `redirect_host` escolhido no perfil define o host do cookie e do retorno. O card emite uma passagem protegida para iniciar no host do callback mesmo quando o painel usa outro host local (seção 4.3).

### 17.4 Destino de rede: DNS em cada chamada

- **Onde:** `src/lib/security/dns-guard.ts`, usado por `safeRequest` em cada salto e no cadastro de instância (`src/lib/auth/instances.ts`).
- **Risco residual (DNS rebinding):** a resolução é feita antes da conexão, e o fetch resolve de novo. Um resolvedor malicioso poderia responder público na checagem e interno na conexão.
- **Mitigações:** allowlist de `*.freshservice.com` (zona do fornecedor) e recusa de domínios customizados no cadastro e na coleta. Verificação em cada salto. Cache curto só para aprovados.
- **Evolução:** fixar o IP validado na conexão (dispatcher próprio). Fica como pendência.
- **Testes:** `tests/security/dns-guard.test.ts` e `tests/security/ssrf-dns.test.ts`. O DNS é falso (`tests/helpers/dns.ts`). Nenhum teste faz DNS real.

A ligação do servidor continua somente em IPv4 (`127.0.0.1`). Se o sistema resolver localhost exclusivamente para `::1`, sem fallback IPv4, o callback localhost não alcançará o app. Essa compatibilidade de ambiente não foi ampliada na F4. Autorizações abertas antes da atualização devem ser reiniciadas, pois o state agora vincula o callback exato.

## Estabilização da beta

Salvar a instância em Configurações é independente de OAuth e API key. A concessão explícita `allow_manage_scopes` aplica-se a todos os escopos fora de `.view`, também `.edit`; o nome do campo/aviso permanece por compatibilidade. Não há escopos de escrita por padrão. Perfis legados devem ser revisados pelo administrador.

`safeRequest` recusa POST/PUT/PATCH/DELETE em recursos antes de DNS/fetch. POST só passa em `/oauth/v2/token` ou `/org/oauth/v2/token` numa organização Freshworks validada, sem query/fragmento. Desconexão apaga tokens locais e não revoga consentimento no provedor; revogue manualmente no Freshworks se necessário. Não há homologação de refresh real.
