# Autenticação no Freshservice: experiência do analista

> **Status (2026-10-12): não homologado com o Freshworks.** O fluxo está implementado e foi validado **somente contra um simulador local** (`FSLM_SIMULATOR=1`), que é fictício. Nenhuma chamada real foi feita e nenhuma credencial real foi usada. **Não se deve afirmar que o OAuth está homologado.**
>
> Este documento explica o requisito, o motivo das mudanças, o que é oficial e o que não é, e o que cada pessoa faz. A referência técnica está em `docs/AUTH.md`.

## 1. Requisito original

O fluxo esperado para o analista é:

1. o usuário informa a URL do Freshservice;
2. clica em **Conectar conta autenticada**;
3. a aplicação prepara a autorização e abre uma nova aba com a autenticação oficial Freshworks;
4. o provedor pode reutilizar uma sessão SSO válida, ou o usuário faz login normalmente;
5. o usuário concede a autorização, se necessário;
6. o provedor retorna ao callback local;
7. o backend valida o retorno e troca o código por tokens;
8. a aplicação valida a autorização com uma leitura permitida;
9. o painel atualiza o estado sozinho.

O mesmo documento acrescenta três regras:

- **Registro prévio.** Se o ambiente exigir registro prévio da aplicação, o projeto deve ter "uma tela de configuração com as instruções e os campos necessários". Não se deve simular uma conexão.
- **Estado claro.** "Estar autenticado no navegador não significa que a aplicação possui acesso à API. O botão deverá informar claramente quando ainda faltar autorização OAuth ou configuração administrativa."
- **Credenciais.** Não solicitar senhas corporativas nem credenciais do SSO.

Em resumo, o analista deveria precisar só da URL e do próprio login. A configuração de registro é válida como etapa administrativa, desde que exista uma tela para ela.

## 2. Por que a implementação anterior ficou mais complexa

A versão anterior misturava o trabalho do administrador com o do analista. Os pontos abaixo descrevem os problemas da experiência anterior, já substituída pelo fluxo atual.

- **Uma configuração OAuth global.** Havia uma única credencial (client ID, secret, escopos e organização) para todas as instâncias. Ela ficava em **Configurações**, preenchida pelo analista. Com vários clientes, uma credencial só não serve para todos.
- **Campo com nome errado.** O campo "URL da instância" pedia a URL da organização Freshworks, e não a do Freshservice. A tela tinha uma limitação conhecida, que o guia anterior descrevia como "apesar do nome".
- **Mistura de tarefas no fluxo diário.** O analista precisava escolher entre OAuth e API key na mesma tela, e preencher credenciais e escopos. Sem OAuth configurado, a mensagem era "Aguardando configuração OAuth", sem dizer quem configura nem o que fazer.
- **Painel que não atualizava.** Depois do retorno do Freshworks, o estado só mudava com recarga manual. Hoje o painel se atualiza por `BroadcastChannel` e por consulta periódica.
- **Redirecionamento divergente.** A implementação usava `127.0.0.1` como host de retorno, que não é documentado. A documentação do Freshworks cita `localhost`. A tela não explicava a diferença.
- **Janela de autorização bloqueável.** A aba era aberta depois de duas chamadas assíncronas. O navegador podia bloqueá-la como pop-up.
- **Contratos divergentes entre tela e API.** Por exemplo, a tela enviava `baseUrl` onde a rota esperava `base_url`, e lia `url` onde a rota devolvia `authorization_url`. Uma rota de início citada na tela (`POST /api/connection/start`) não existia.
- **Validação só com mocks.** Sem um provedor simulado, o fluxo completo nunca foi exercitado no navegador.

A correção separa as duas tarefas. O administrador configura uma vez por organização. O analista só informa a URL e autentica.

## 3. Mecanismos oficiais investigados

Legenda: **DOCUMENTADO** (está no texto oficial), **NÃO DOCUMENTADO** (não há texto oficial), **INFERÊNCIA** (hipótese usada pelo app, não confirmada pelo provedor), **DIVERGÊNCIA** (documentação oficial se contradiz), **RISCO** (afirmação de terceiros não refutada).

| Tema | Situação | Fonte |
|---|---|---|
| REST v2 aceita OAuth (`Authorization: Bearer`) | DOCUMENTADO (changelog de abr/2024) | https://api.freshservice.com/ |
| A seção "Authentication" da mesma referência cita só API key | DIVERGÊNCIA | https://api.freshservice.com/ |
| Authorization Code para apps externos; troca com `Basic(client_id:client_secret)` | DOCUMENTADO | https://developers.freshworks.com/docs/app-sdk/v3.0/service_ticket/oauth-implementation-in-apps/oauth-in-external-apps/ |
| Endpoints `…/oauth/v2/authorize` e `…/oauth/v2/token`: o texto usa `/oauth/v2/…` e os exemplos usam `/org/oauth/v2/…` | DIVERGÊNCIA (ambiguidade) | mesma fonte acima |
| Access token de 30 min; refresh token de 365 dias | DOCUMENTADO | mesma fonte acima |
| Endpoint e parâmetros de renovação | NÃO DOCUMENTADO. INFERÊNCIA: o app usa a RFC 6749 §6 | mesma fonte acima |
| Credencial criada no Developer Portal; até 5 URLs de redirecionamento; escopos fixados na criação; remoção de escopo não suportada | DOCUMENTADO | https://developers.freshworks.com/docs/app-sdk/v3.0/service_ticket/advanced-interfaces/request-method/oauth-access-freshworks-resources/ |
| Redirecionamento local de exemplo: `http://localhost:10001/auth/callback` | DOCUMENTADO (exemplo) | mesma fonte acima |
| Redirecionamento com `127.0.0.1` | NÃO DOCUMENTADO | — |
| Como adicionar escopos depois de criada a credencial | NÃO DOCUMENTADO | — |
| URL da organização `*.myfreshworks.com`, gerada automaticamente e visível no seletor de organização | DOCUMENTADO | https://support.freshworks.com/en/support/solutions/articles/50000002731 |
| Derivar a organização Freshworks a partir de `*.freshservice.com` | NÃO DOCUMENTADO | — |
| PKCE ou cliente público | NÃO DOCUMENTADO. Não é usado | — |
| Reutilização de sessão SSO | NÃO DOCUMENTADO de forma explícita. INFERÊNCIA: provável, com possibilidade de nova autenticação | referência relacionada: https://support.freshdesk.com/support/solutions/articles/50000014426 |
| OAuth da REST "exclusivamente para apps marketplace" | RISCO. Afirmação de comunidade (mai/2024), não refutada por documentação posterior | https://community.freshworks.dev/t/freshworks-introduces-multi-oauth-functionality-for-app-developers-and-oauth-support-for-freshservice-apis/12798 |
| Relatos de `invalid_scope` no OAuth (set/2025) | RISCO. Relatos de comunidade | https://community.freshworks.dev/t/oauth-2-0-authorization-failing-with-invalid-scope-error-in-freshservice/18803 |
| Leituras de agentes e grupos exigem escopos `.manage`; formulário de tickets exige `tickets.fields.manage`; itens do catálogo exigem `service_catalog.edit`; não há escopo `.view` para esses GET | DOCUMENTADO (texto das ações GET) | https://api.freshservice.com/ |
| Revogação remota do aplicativo | NÃO DOCUMENTADO | — |

### 3.1 Alternativa MCP (descartada)

O Freshservice documenta um servidor MCP com OAuth e registro dinâmico de cliente (DCR), disponível desde set/2026 ([artigo 50000012678](https://support.freshservice.com/support/solutions/articles/50000012678) e [FAQ 50000014409](https://support.freshservice.com/support/solutions/articles/50000014409)). Foi descartada por três motivos:

- a superfície é de ferramentas MCP, e não a API REST que o app consome;
- há cotas anuais de ações de 1.200, 6.000 ou 12.000, inviáveis para um mapeamento completo;
- o conjunto de ferramentas é parcial.

### 3.2 Insomnia

O Insomnia é um cliente HTTP. Ele suporta Basic (API key), Bearer e OAuth 2.0 ([documentação](https://developer.konghq.com/insomnia/request-authentication/)). Entrar no Insomnia não é autenticação na API do Freshservice. A hipótese mais provável para a equipe é que o Insomnia use **Basic com API key**.

Para confirmar, sem expor segredos, é preciso verificar:

- o tipo de autenticação escolhido na aba **Auth**;
- o host das URLs (sem caminho nem parâmetros);
- se o campo de usuário tem formato de chave, sem registrar o valor;
- o esquema do cabeçalho de autorização, sem o valor;
- o código HTTP da resposta de teste.

## 4. Solução adotada

- **Perfil de integração por organização Freshworks.** Um responsável cadastra, uma vez por cliente, o perfil em **Configurações → Administração da integração**. O perfil guarda a URL da organização, o Client ID, os domínios do Freshservice do cliente e os escopos. O Client Secret vai para o cofre de segredos.
- **Correspondência estrita.** A instância do analista é associada ao perfil pelo domínio. O app não presume a organização a partir de `*.freshservice.com`. Sem perfil, o estado é `admin_config_missing`, com orientação objetiva.
- **Fluxo diário sem configuração.** O analista informa o link, clica em **Conectar conta autenticada**, faz login na aba do Freshworks e volta ao painel. O painel se atualiza sozinho.
- **Estados distintos.** Conectado, aguardando autorização, configuração administrativa ausente, autorização negada, escopo insuficiente, sem permissão, sessão expirada e erro de conexão. Cada um tem mensagem e ação.
- **Escopos mínimos.** Padrão somente leitura (`.view`). Escopos `.manage` só com permissão explícita do perfil e aviso na tela.
- **API key como opção avançada.** Fica recolhida em Configurações e fora do fluxo principal.
- **Somente leitura.** O app faz `GET` na API do Freshservice. A única escrita HTTP é o POST de token no Freshworks.
- **Simulador separado.** Um provedor fictício, ativo só com `FSLM_SIMULATOR=1`, serve para testes e demonstrações.

## 5. O que o administrador configura uma única vez

Uma pessoa com permissão de administrador na organização Freshworks do cliente faz estes passos. Não há repetição por analista.

1. **Descobrir a URL da organização Freshworks.** Ela tem a forma `https://<org>.myfreshworks.com`, ou `https://<org>.freshworks.com`. Está visível no seletor de organização ([artigo 50000002731](https://support.freshworks.com/en/support/solutions/articles/50000002731)). Não é a URL do Freshservice.
2. **Criar a credencial OAuth no Developer Portal** dessa organização: **Settings → OAuth Credentials → Create**. Preencher **Name** (até 3 palavras) e **Description**. O usuário vê os dois na tela de autorização.
3. **Cadastrar o Redirect URL.** Use o endereço exato mostrado pelo app no passo 6 (ver a pendência do passo 8). O formato é `http://<host>:<PORTA>/api/auth/oauth/callback`. A documentação permite até 5 URLs por credencial. Se a porta do app mudar, o redirecionamento precisa mudar junto.
4. **Escolher os escopos de leitura** dos módulos necessários. O padrão do app é `.view`. Não marcar `.manage` ou `.edit` sem necessidade documentada. Escopos são fixados na criação.
5. **Copiar o Client ID e o Client Secret.**
6. **Cadastrar o perfil no app.** Em **Configurações → Administração da integração → Novo perfil de integração**, preencher:
   - **Nome do perfil**;
   - **URL da organização no Freshworks**;
   - **Client ID** e **Client secret** (o segredo não aparece de novo depois de salvo);
   - **Domínios do Freshservice**, por exemplo `acme.freshservice.com`;
   - **Prefixo da autorização**, mantendo `/org`, e **prefixo do token** independente, vazio por padrão;
   - **Host do redirecionamento** (ver passo 8);
   - **Escopos de leitura**, já pré-marcados.
   Depois, clicar em **Criar perfil**.
7. **Conferir o endereço de redirecionamento.** O formulário mostra o endereço, com botão **Copiar**. Ele precisa ser igual ao cadastrado no passo 3.
8. **Host do redirecionamento.** Mantenha `localhost` se esse é o host cadastrado no provedor. O callback deste app é `http://localhost:<PORTA>/api/auth/oauth/callback`, mesmo com o painel aberto em `127.0.0.1`. O fluxo cria o cookie na origem correta e retorna automaticamente à origem do painel; não compartilha cookies entre hosts (F4, `docs/AUTH.md`, seção 4.3).
9. **Conferir o cadastro.** O perfil aparece na lista com o selo "Segredo cadastrado". Um analista faz a primeira conexão de teste (seção 6).

## 6. O que o analista faz no dia a dia

1. Abrir o app em **`http://127.0.0.1:<PORTA>`**. Não usar `localhost`.
2. No cartão **Conexão com o Freshservice**, digitar o link do Freshservice do cliente, por exemplo `https://acme.freshservice.com`.
3. Clicar em **Conectar conta autenticada**.
   - Se aparecer **"Configuração administrativa ausente"**, não tente configurar credenciais. Avise o responsável pela integração.
4. Na aba que se abriu, do Freshworks, entrar com a **própria conta** (ou usar a sessão já ativa) e aprovar o acesso, se pedido.
5. Voltar ao painel. O status muda sozinho para **Conectado**. Se a aba foi bloqueada pelo navegador, use o link **"use este link"**.
6. Clicar em **Testar conexão**. Depois, em **Diagnosticar acesso**, que faz uma leitura pequena por módulo.
7. Clicar em **Mapear tudo** na primeira coleta, e em **Sincronizar novamente** nas seguintes.

Mensagens comuns e o que fazer:

| Mensagem | O que fazer |
|---|---|
| Configuração administrativa ausente | Avisar o responsável pela integração. |
| Autorização negada | Conectar de novo e aprovar o acesso. |
| Escopo insuficiente | Avisar o responsável. O perfil não tem escopos de leitura suficientes. |
| Sem permissão | Conferir o papel da conta no Freshservice. |
| Sessão expirada | Clicar em **Conectar conta autenticada** de novo. |
| Erro de conexão | Tentar mais tarde. Os tokens locais são mantidos. |
| Escopo não autorizado (módulo) | O módulo exige escopo que o perfil não tem. Ele não é consultado, e a coleta segue. |

O analista não edita credenciais, escopos nem o redirecionamento. Quem faz isso é o responsável pela integração.

## 7. Informações necessárias por cliente

| Informação | Exemplo | Quem fornece | Onde é usada |
|---|---|---|---|
| Link do Freshservice do cliente | `https://acme.freshservice.com` | Analista | Cartão de conexão |
| URL da organização Freshworks | `https://acme.myfreshworks.com` | Administrador (seletor de organização) | Perfil de integração |
| Domínio do Freshservice | `acme.freshservice.com` | Administrador | Perfil (`freshservice_domains`) |
| Client ID e Client Secret | — | Administrador, no Developer Portal | Perfil (o segredo vai para o cofre) |
| Escopos de leitura | `.view` (padrão) | Administrador | Perfil |
| Redirecionamento cadastrado | `http://127.0.0.1:3000/api/auth/oauth/callback` | Administrador | Developer Portal e perfil |
| Prefixo do caminho | `/org` (padrão) | Administrador | Perfil |
| Conta do analista | — | O próprio analista, no login do Freshworks | Navegador |

Uma credencial por organização Freshworks. **Não está confirmado** se uma mesma credencial pode servir a várias organizações. Por isso o app cadastra um perfil por organização.

## 8. Limitações remanescentes

- **O fluxo só URL + login sem configuração prévia NÃO é suportado oficialmente.** Mesmo com a interface pronta, é preciso uma credencial OAuth por organização, cadastrada uma vez pelo administrador. Essa etapa não some com a interface: ela é o custo mínimo do registro prévio exigido pelo provedor.
- **Não homologado.** Não houve nenhuma chamada real ao Freshworks ou ao Freshservice.
- **Host do redirecionamento.** localhost funciona localmente com o painel em 127.0.0.1; callback deve coincidir exatamente com o cadastrado no provedor. Aceitação real ainda não homologada.
- **Renovação de token.** O endpoint e os parâmetros não são documentados. O app segue a RFC 6749 §6.
- **PKCE** não é usado, porque não é documentado para este caso.
- **Revogação remota** não é documentada. Desconectar apaga só os segredos locais. Para revogar, remova o aplicativo no painel do Freshworks.
- **Identidade do agente.** Não há endpoint de identidade na referência consultada (`agents/me` não aparece). A tela mostra o rótulo fixo "Freshworks OAuth", e não o nome do agente.
- **Escopos de escrita.** Agentes, grupos, formulário de tickets e itens do catálogo exigem `.manage` ou `.edit` pela documentação. Sem `allow_manage_scopes`, esses módulos são marcados como "Escopo não autorizado" e não são consultados.
- **Sessão SSO.** O reaproveitamento da sessão do navegador não está documentado. Pode haver nova autenticação.
- **Administração sem login.** A proteção das rotas administrativas é a guarda local de Host e Origin. Ela não autentica quem usa o app.
- **Pop-up do navegador.** Se o perfil não estiver em cache, a aba é aberta depois da checagem, e o navegador pode bloqueá-la. Nesse caso, a interface oferece o link.
- **API key** continua como alternativa para quem não puder registrar o aplicativo. Ela não é a recomendação principal.

## 9. Fluxos validados somente com o simulador

Tudo abaixo foi validado contra o **simulador local**, com `FSLM_SIMULATOR=1`. **Nenhum desses cenários prova que o fluxo funciona com o Freshworks real.**

**Comando:** `pnpm test:e2e:sim` (porta 3112). Resultado final F4: 14 de 14.

- **Fluxo principal (15 passos).** A aba original atualiza sem recarregar. Testar conexão. Mapear tudo. Inventário. Upsert e remoção pelo controle do simulador, seguidos de nova sincronização. Página de diferenças. Desconexão. Nenhum segredo aparece em página, console ou JSON de perfis.
- **Cenários (12):**
  1. Sessão SSO válida: a segunda conexão vai direto ao consentimento.
  2. Sem sessão: a página de login do simulador é exibida, e o painel não alega conexão.
  3. MFA: etapa de código, conexão, agentes "Sem permissão" por papel e grupos "Escopo não autorizado".
  4. Aplicativo não registrado: "Aplicativo OAuth não registrado".
  5. Autorização negada: "Autorização negada", sem token.
  6. Token expirado e refresh revogado: "Sessão expirada".
  7. Só o access token expirou: o refresh renova, e a conexão continua Conectado.
  8. App restrito sem escopo de metadados: "Escopo insuficiente".
  9. Módulo sem permissão de papel: "Sem permissão", e a execução termina parcial.
  10. Callback inválido (state forjado ou ausente): não conecta e não guarda token.
  11. Erro de rede: "Erro de conexão" mantém os tokens. Ao voltar, Conectado sem novo login.
  12. Callback 127.0.0.1: regressão de login e atualização automática para Conectado.

**Testes automatizados de apoio** (`pnpm test`, 69 arquivos, 800 testes passando e 3 pulados), entre eles:

- `tests/simulator/` (guardas, fluxo OAuth, API e layout da faixa);
- `tests/auth/profiles.test.ts` (perfis, escopos e `.manage`);
- `tests/sync/scope-gate.test.ts` (bloqueio por escopo no sync);
- `tests/freshservice/official-scopes.test.ts` (mapa de escopos);
- `tests/ui/auth-preflight.test.ts` e `tests/auth/oauth-preflight-url.test.ts` (pré-verificação);
- `tests/security/local-host.test.ts` e `tests/auth/oauth-localhost.test.ts` (Host, cookies, passagem, callback exato, replay e origem).

**Simulador manual (exploração).** Para usar o simulador na tela, sem o Playwright, o modelo é:

```bash
FSLM_SIMULATOR=1 PORT=3112 FSLM_DATA_DIR=<pasta absoluta, fora do repositório> FSLM_NO_BROWSER=1 pnpm dev
```

A pasta de dados precisa ser dedicada e absoluta. Não use o diretório padrão do usuário. Não deixe `FSLM_SIMULATOR=1` exportado no shell usado para o uso real. Um smoke manual com `next dev` na porta 3112 foi feito em 2026-10-12, mas o roteiro completo está nos testes E2E.

## 10. O que falta para homologação real

Checklist. Nenhum item foi concluído. Qualquer chamada real exige aprovação explícita do responsável pelo projeto.

- [ ] **Permissão do Freshworks.** Confirmar que o OAuth da REST é permitido para este aplicativo, e não só para apps marketplace (seção 3, risco de homologação).
- [ ] **Aplicativo de teste.** Registrar um aplicativo de teste em uma organização de teste, com aprovação, e validar: authorize (com e sem `/org`), troca do código, renovação, leitura de verificação, negação e cancelamento.
- [x] **Compatibilidade local do callback.** F4 permite localhost com painel em 127.0.0.1, preservando state, cookies host-only e CSRF. Homologação com provedor real continua pendente.
- [ ] **Renovação.** Confirmar o endpoint e os parâmetros do refresh token.
- [ ] **PKCE.** Confirmar se é suportado ou exigido para este tipo de aplicativo.
- [ ] **Credencial por organização.** Confirmar se uma credencial serve a várias organizações.
- [ ] **SSO.** Confirmar o reaproveitamento de sessão e o comportamento de nova autenticação.
- [ ] **Escopos reais.** Confirmar em conta real os escopos de leitura de cada módulo. Os `.manage` sinalizados são agentes, grupos, formulário de tickets e itens do catálogo. Confirmar também `service_catalog/categories`, que não tem escopo documentado.
- [ ] **Endpoints e respostas.** Validar caminhos e chaves de resposta contra uma instância real (`docs/ENDPOINTS.md`).
- [ ] **Revogação.** Confirmar se há API de revogação ou um procedimento no portal.
- [ ] **`invalid_scope`.** Verificar o relato da comunidade com o escopo real do aplicativo.
- [ ] **Validade.** Confirmar que o token de 30 min e o state de 10 min se comportam como documentado.
- [ ] **Cofres.** Validar DPAPI (Windows), Keychain (macOS) e Secret Service com serviço real (Linux).
- [ ] **Backlog técnico.** Tratar o escopo `scopeKeyFor` do simulador para `tickets/{id}/*`, e a renovação entre processos (`docs/AUTH.md`, seção 16).
- [ ] **Revisão.** Executar as revisões de código e de segurança com as ferramentas do projeto. Elas não foram executadas nesta etapa.
