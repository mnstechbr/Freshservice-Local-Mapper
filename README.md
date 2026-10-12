# Freshservice Local Mapper — v0.1.0-beta (Mapeador Local Freshservice)

Mapeador **100% local** e **somente leitura** de uma instância do Freshservice. Roda no seu computador (`127.0.0.1`), guarda tudo em SQLite local e detecta diferenças entre execuções.

**Status (2026-10-12, versão 0.1.0-beta).** Inventário, sincronização, diferenças e painel estão implementados e validados com testes automáticos e com um simulador local. O login OAuth por perfis de integração está implementado, mas **não foi homologado com o Freshworks e não foi testado com instância real**. Detalhes em `docs/VALIDACAO.md`.

## Início rápido

1. Instale Node.js 22.12 ou superior (Fedora: `bash scripts/setup.sh`; Windows 11: `scripts\setup.ps1`).
2. Na raiz do projeto, rode `npm run dev` (ou `pnpm dev`).
3. Abra **`http://127.0.0.1:3000`**. O callback OAuth pode usar `localhost` quando assim cadastrado no perfil.
4. **Administrador (uma vez por cliente):** cadastre o perfil de integração em **Configurações → Administração da integração** (seção 7).
5. **Analista (dia a dia):** informe o link do Freshservice do cliente e clique em **Conectar conta autenticada** (`docs/GUIA-DE-USO-E-COLETA.md`, Passo 4).

## 1. Objetivo

- Inventário local de catálogo de serviços, base de conhecimento, tickets (sem conversas nem anexos), usuários e grupos, ativos, ITSM e configurações.
- Diferenças entre execuções: itens removidos, novos, com nome alterado ou com possível troca de ID.
- Somente leitura: não cria, altera nem apaga nada no Freshservice. A única requisição POST ao Freshworks é a troca e a renovação de token OAuth.
- 100% local: sem nuvem, sem telemetria e sem CDN.

## 2. Requisitos

| Item | Fedora Linux | Windows 11 |
|---|---|---|
| Node.js | 22.12 ou superior (recomendado 24 LTS), pacote `dnf` | 22.12 ou superior (recomendado 24 LTS), `winget` (`OpenJS.NodeJS.LTS`) |
| npm | no Fedora 44, pacote `nodejs24-npm` (o `setup.sh` instala junto) | vem com o Node |
| pnpm | não precisa instalar: o bootstrap usa `pnpm@10.34.0` (versão do `packageManager`) via Corepack ou `npm exec` | idem |
| Cofre de credenciais | Secret Service: pacote `libsecret` (`secret-tool`) e um chaveiro ativo (GNOME Keyring ou KWallet) | DPAPI do usuário via `powershell.exe` (já vem no Windows) |
| Compilador | não precisa: o `better-sqlite3` 13 traz binários prontos (`linux-x64`, `win32-x64`). Só para arquitetura sem binário: `gcc-c++`, `make`, `python3` | idem: Visual Studio Build Tools (C++) |

- Sistemas-alvo: Fedora Linux e Windows 11. O resultado real dos testes por sistema está em `docs/COMPATIBILIDADE-BOOTSTRAP.md`. macOS tem caminhos cobertos só por testes simulados.
- Nada de PostgreSQL, Docker, Redis ou Python para rodar o app: o banco é SQLite embarcado.
- Lockfile canônico: `pnpm-lock.yaml`. `npm install` direto é bloqueado (`preinstall`) para não criar um `package-lock.json` divergente. Use `npm run dev`, que instala com pnpm a partir do lockfile.

## 3. Primeira execução

### Cenário A: Node.js e npm já instalados

Clone [o repositório](https://github.com/mnstechbr/Freshservice-Local-Mapper) e entre na pasta:

```bash
git clone https://github.com/mnstechbr/Freshservice-Local-Mapper.git
cd Freshservice-Local-Mapper
```

Na raiz:

```bash
npm run dev        # ou: pnpm dev
```

Na primeira vez, o bootstrap pergunta se pode instalar as dependências locais (`node_modules`) com o lockfile oficial. Responda `S`. Para não perguntar: `npm run dev -- --yes`. Depois ele cria o banco SQLite, sobe o servidor e abre o navegador.

### Cenário B: Node.js ou npm ausentes

Fedora:

```bash
bash scripts/setup.sh            # verifica e, com sua confirmação, instala Node.js/npm via dnf (sudo)
npm run dev
```

Windows 11 (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1   # verifica e, com sua confirmação, instala via winget
npm run dev
```

- Os scripts só usam os gerenciadores oficiais (`dnf`, `winget`). Nada é instalado sem confirmação; o padrão da pergunta é "não".
- Opções: `--check` / `-CheckOnly` (só diagnostica), `--yes` / `-Yes` (sem perguntas, para automação), `--build-tools` / `-BuildTools` (oferece o compilador opcional).
- No Windows, se o winget não existir, instale o "App Installer" pela Microsoft Store ou use o instalador oficial em https://nodejs.org/en/download. Depois de instalar o Node, abra um terminal novo se `node` não for encontrado.
- Sem internet, os scripts e o bootstrap explicam o problema e não alteram nada.

## 4. Iniciar

```bash
npm run dev        # ou: pnpm dev
npm run bootstrap  # só prepara (dependências, dados, banco, cofre), sem subir o servidor
```

O `scripts/start-dev.mjs` executa, em ordem, e mostra cada etapa com `[fslm]`:

1. identifica o sistema operacional;
2. valida a versão do Node (mínimo 22.12);
3. identifica o gerenciador que chamou (npm ou pnpm) e avisa sobre lockfiles em conflito (`package-lock.json`, `yarn.lock`), sem apagar nada;
4. confere se `node_modules` corresponde ao `pnpm-lock.yaml`; se faltar ou estiver desatualizado, instala com `pnpm install --frozen-lockfile` após consentimento e teste de conectividade;
5. confere se o módulo nativo do SQLite (`better-sqlite3`) carrega;
6. resolve e cria o diretório de dados (seção 5);
7. impede processo duplicado: se o app já estiver rodando, só abre o navegador e sai;
8. prepara o banco: cria se não existir; se existir, verifica a integridade sem alterar; antes de migrations pendentes faz backup em `<dados>/backups/`; migrations com `DROP` ou `DELETE` não revisadas não são aplicadas sem `FSLM_ALLOW_DESTRUCTIVE_MIGRATIONS=1`;
9. verifica o cofre de credenciais (aviso, não bloqueia: sem cofre o app roda, mas não salva credenciais);
10. confere se a porta está livre (não troca de porta sozinho, porque o redirect do OAuth depende dela);
11. sobe o `next dev` em `127.0.0.1`;
12. abre o navegador uma vez, quando há ambiente gráfico.

Erros saem com o nome da etapa, a causa, "Como resolver" e código 1. O resultado de cada etapa fica em `<dados>/bootstrap-status.json` e aparece na página **Ambiente local** (`/ambiente`). Rodar de novo é seguro: nada é reinstalado, recriado ou sobrescrito se já estiver correto.

| Variável / opção | Padrão | Uso |
|---|---|---|
| `PORT` | `3000` | Porta do servidor, sempre em `127.0.0.1`. |
| `FSLM_NO_BROWSER` | `0` | `1` impede a abertura automática do navegador. `CI` definido também impede. |
| `FSLM_DATA_DIR` | vazio | Diretório do banco. Caminho absoluto ou começando com `~`. Vazio usa o padrão do SO. |
| `FSLM_AUTO_INSTALL` | vazio | `1` instala dependências sem perguntar; `0` nunca instala. Vazio pergunta (só em terminal interativo). |
| `--yes` / `--no-install` | — | Mesmo efeito de `FSLM_AUTO_INSTALL=1` / `0` (ex.: `npm run dev -- --yes`). |
| `FSLM_ALLOW_DESTRUCTIVE_MIGRATIONS` | vazio | `1` autoriza migration com `DROP` ou `DELETE` ainda não revisada, com backup antes. |
| `FSLM_SECRET_KEY` | — | Chave do cofre em arquivo cifrado (seção 9). Não está no `.env.example`. |

- O `.env` da raiz é lido pelo bootstrap, sem sobrescrever variáveis já definidas no shell. No Windows, prefira definir `PORT` e afins no `.env` (a sintaxe `PORT=3100 npm run dev` não funciona no PowerShell).
- `.env*` está no `.gitignore`, exceto `.env.example`. Não versione o `.env`.
- Produção local: `pnpm build` e depois `pnpm start`, em `127.0.0.1`. `PORT=3102 pnpm start` foi validado.
- **Atenção à `PORT` na produção local:** use o mesmo valor nos dois comandos, `PORT=3102 pnpm build` e `PORT=3102 pnpm start` (com npm: `PORT=3102 npm run build` e `PORT=3102 npm start`). O redirecionamento de `localhost` para `127.0.0.1` é gravado no build (`next.config.ts`). Se os valores divergirem, acessar por `localhost` responde 400 `use_loopback_host`, indicando o endereço correto. Abra sempre `http://127.0.0.1:PORT`.

## 5. Banco local

- Local padrão do SO, quando `FSLM_DATA_DIR` está vazio:
  - Fedora/Linux: `$XDG_DATA_HOME/freshservice-local-mapper` (só se `XDG_DATA_HOME` for absoluto) ou `~/.local/share/freshservice-local-mapper`;
  - Windows: `%LOCALAPPDATA%\FreshserviceLocalMapper`;
  - macOS: `~/Library/Application Support/freshservice-local-mapper`.
- Banco, backups (`backups/`), cofre cifrado (`secrets/`), status do bootstrap e trava do servidor ficam nesse diretório, nunca na pasta do código.
- Recusados com erro claro: dentro de `public/` do projeto, na pasta temporária do sistema, em pastas de nuvem (OneDrive, Dropbox, Google Drive, iCloud) e, no Windows, em caminhos de rede (`\\servidor\pasta`). Symlinks são resolvidos antes da checagem.
- Permissões (POSIX): diretório `0700`; `fslm.db`, `fslm.db-wal` e `fslm.db-shm` `0600`. No Windows vale a proteção do perfil do usuário (`%LOCALAPPDATA%`).
- SQLite em modo WAL, `foreign_keys` ligado e `busy_timeout` de 5 s.
- Migrations versionadas em `drizzle/`, aplicadas pelo migrator do Drizzle e registradas em `__drizzle_migrations`. Nunca se edita migration já aplicada.
- Idempotente: iniciar de novo não reaplica migrations e não duplica dados.
- Diagnóstico de corrupção sem apagar: antes de qualquer escrita, o app faz `PRAGMA quick_check` em modo somente leitura. Se o arquivo não for SQLite válido ou estiver corrompido, mostra diagnóstico, sai com código 1 e deixa o arquivo como está.

## 6. Configurar a instância

- Use a URL `https://<empresa>.freshservice.com`. Só a origem é guardada; caminho, query e fragmento são descartados.
- Recusados: `http`, IP, `localhost`, porta diferente de 443, usuário e senha na URL, nomes IDN.
- Domínios customizados são recusados no cadastro, na coleta e no diagnóstico, mesmo com `allow_custom_domain: true`. Use a origem original `https://cliente.freshservice.com`. Registros legados são preservados, mas não são coletáveis.
- Detalhes: `docs/AUTH.md`, seção 1.

## 7. Configuração única do administrador (perfil de integração)

Feita **uma vez por organização Freshworks do cliente**, por um responsável com permissão de administrador na organização. O analista não faz esta etapa. O passo a passo completo está em `docs/GUIA-DE-USO-E-COLETA.md` (Passo 3) e na referência técnica em `docs/AUTH.md` (seções 2 e 3).

1. No Developer Portal da organização do cliente, crie a credencial OAuth (**OAuth Credentials → Create**), com escopos de leitura.
2. No app, em **Configurações → Administração da integração → Novo perfil de integração**, informe: nome, URL da organização Freshworks (`https://<org>.myfreshworks.com`), Client ID, Client secret, domínios do Freshservice do cliente (ex.: `acme.freshservice.com`), prefixo da autorização `/org`, prefixo do token independente (vazio por padrão), host do redirecionamento e escopos. O segredo vai para o cofre e não aparece de novo.
3. No Freshworks, cadastre o **Redirect URL** exatamente como o app mostra (formato `http://<host>:<PORTA>/api/auth/oauth/callback`).

Pontos de atenção:

- **Host do redirecionamento.** O padrão `localhost` funciona com o painel em `127.0.0.1`. Cadastre exatamente `http://localhost:PORT/api/auth/oauth/callback` no provedor. O cookie de state fica em localhost; a conclusão retorna à origem fixa do painel. Compatibilidade local validada pelo simulador; sem homologação Freshservice real.
- **Porta.** O redirect usa a `PORT` do processo. Se a porta mudar, o redirect cadastrado precisa mudar.
- **Escopos `.manage`.** Só marque "Permitir escopos de gestão ou escrita" se for necessário para agentes, grupos, formulário de tickets ou itens do catálogo, e com autorização do cliente. Esses escopos podem permitir escrita no Freshservice.
- A credencial é por organização. Não está confirmado se uma mesma credencial serve a várias organizações.
- O fluxo não foi homologado com o Freshworks (seção 17).

## 8. Opção técnica avançada: API key

Use a API key somente se não for possível registrar o aplicativo OAuth. Ela fica recolhida em **Configurações → "Opção técnica avançada: API key"**.

- **Pessoal** (`api_key_personal`): as ações ficam ligadas ao agente dono da chave, e o alcance é o do papel dele.
- **Integração** (`api_key_integration`): identidade técnica, sem vínculo com uma pessoa. Prefira esta opção quando a organização permitir. Como criar um usuário de integração: https://support.freshservice.com/support/solutions/articles/50000014413-manage-integration-users-in-freshservice
- Uma conexão por instância. Trocar de modo apaga o segredo anterior, seja OAuth ou API key.
- A chave é validada antes de ser gravada. Chave rejeitada (401) não é gravada, e a conexão anterior permanece.
- A API key não exige perfil de integração e não passa pelo controle de escopos OAuth.

## 9. Cofre de segredos

O banco guarda só a referência ao segredo (`connections.secret_ref` e `integration_profiles.client_secret_ref`), nunca o segredo. O backend escolhe, nesta ordem:

| Sistema | Backend | Observação |
|---|---|---|
| Linux | libsecret via `secret-tool` | Exige `secret-tool` e serviço de segredos acessível (D-Bus de sessão, chaveiro desbloqueado). A sonda usa `secret-tool search --all fslm-probe x` com timeout de 3 s. Sem D-Bus, com tempo esgotado ou sem `secret-tool`, o backend fica indisponível com motivo e o arquivo criptografado assume, se houver `FSLM_SECRET_KEY`. |
| macOS | Keychain (`/usr/bin/security`) | Chaveiro do usuário. |
| Windows | DPAPI via PowerShell | Texto cifrado em `<dados>/secrets/<id>.dpapi`. |
| Qualquer SO (fallback) | Arquivo AES-256-GCM | Só existe com `FSLM_SECRET_KEY`. Arquivo `<dados>/secrets/vault.enc.json`. |

Ordem de gravação: Secret Service (ou Keychain/DPAPI) se a sonda responder; senão o arquivo criptografado, se `FSLM_SECRET_KEY` for válida; senão erro. Se o Secret Service responder à sonda mas recusar a gravação (chaveiro bloqueado), tenta o arquivo. Sem nenhum cofre, nada é gravado e o erro diz "Nenhum cofre seguro disponível: configure cofre seguro (Secret Service desbloqueado ou FSLM_SECRET_KEY)", com o motivo de cada backend. Leitura: a referência indica o backend de origem; segredos gravados antes continuam acessíveis enquanto esse backend estiver disponível.

`FSLM_SECRET_KEY` é base64 com pelo menos 32 bytes decodificados. Gere com:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Forneça a variável pelo ambiente do processo. Guarde a chave fora do projeto, em arquivo protegido ou gerenciador de segredos; não a coloque no `.env` do projeto nem em comandos gravados no histórico do shell. O Next herda essa variável: outros processos com acesso ao usuário continuam sendo um risco local. Guarde uma cópia separada, fora do projeto e do diretório de dados. Sem a chave, o arquivo do cofre fica ilegível. Não há rotação de chave nesta fase.

Linux, macOS e Windows foram validados só com runner simulado; os backends reais não foram executados em sistema real.

## 10. Primeiro inventário

> As rotas `/api/diagnostics` e `/api/sync/*` existem. Diagnóstico e sincronização rodam em segundo plano: a resposta é **202** e o andamento aparece no status (`GET /api/sync/status`, `GET /api/diagnostics`).

1. **Diagnosticar acesso** (botão no painel; `POST /api/diagnostics`, responde 202): faz um GET por módulo para confirmar permissão e caminho do endpoint, sem baixar dados em massa. Módulos cujo escopo não está no perfil de integração não são consultados (`scope_not_granted`). O resultado aparece em `GET /api/diagnostics`.
2. **Preferências de coleta** (Configurações): marque os módulos. A opção "Somente metadados", por módulo, remove os campos de conteúdo do registro normalizado. A opção de guardar a resposta original vem desmarcada.
3. **Mapear tudo** (botão no painel; `POST /api/sync/full`, responde 202 com `runId`): lê os módulos com paginação (até 100 itens por página). Módulos bloqueados por escopo ficam ignorados, e a execução termina `partial`, ou `failed` se nenhum módulo concluir. Falhas parciais podem ser refeitas só nos módulos com erro (`POST /api/sync/retry`), e a execução pode ser cancelada.
4. Ao terminar, o app compara a execução com a última concluída e registra as diferenças na página Diferenças (`/diferencas`).

## 11. Consultar diferenças

| Tipo (`type`) | Severidade | Significado |
|---|---|---|
| `possible_id_change` | alta | Um item removido e um novo parecem ser o mesmo. Precisa de revisão. |
| `removed` | alta | Item não encontrado na execução atual. Só é emitido com coleta completa nas duas execuções. |
| `not_observed` | baixa | Coleta incompleta: não é possível afirmar remoção. Nunca é tratado como removido. |
| `added` | baixa | Item novo. |
| `name_changed` | média | Nome alterado. |
| `fields_changed` | média ou baixa | Campos alterados. |

A legenda com cores fica em `/diferencas`.

- **Revisão** (`/diferencas/[id]`): confirme ou rejeite uma `possible_id_change`. Com vários candidatos, escolha um. Confirmar fixa o par. Rejeitar devolve os itens a removido e novo. Decisões humanas são preservadas quando o mesmo par é detectado de novo. A revisão só grava localmente e nunca chama o Freshservice.
- **Comparar execuções**: em `/historico`, selecione duas execuções e abra `/historico/comparar`. As duas precisam ser da mesma instância. A comparação não grava nada.

## 12. Trabalhar offline

Depois de uma execução concluída, painel, recursos, diferenças, histórico e logs leem só o banco local, sem internet e sem o Freshservice. Sem conexão não há teste de credenciais, renovação de token, sincronização ou diagnóstico. O modo demonstrativo funciona sem rede.

## 13. Proteger e fazer backup

- O banco contém a URL da instância, metadados dos itens e a auditoria (já redigida). Trate-o como dado sensível.
- Com o app parado: copie `fslm.db` junto com `fslm.db-wal` e `fslm.db-shm` (se existirem). Copiar só o `.db` pode deixar de fora dados ainda não consolidados.
- Com o app rodando: `sqlite3 "<dados>/fslm.db" ".backup '<destino>/fslm-backup.db'"`.
- Guarde o backup com permissão `0600`. **Nunca** em pasta sincronizada com nuvem (OneDrive, Dropbox, Google Drive, iCloud).
- Os segredos não estão no banco. Em outra máquina, é preciso reconectar, porque o cofre é local.
- Para restaurar: pare o app, guarde uma cópia do estado atual e troque o arquivo por uma cópia válida.

## 14. Modo demonstrativo e simulador

### 14.1 Modo demonstrativo

- **Ativar**: botão "Ativar modo demonstrativo" no cartão "Como funciona", no painel. Ou pela API:

```bash
curl -X POST -H 'Origin: http://127.0.0.1:3000' -H 'Content-Type: application/json' -d '{"action":"ativar"}' http://127.0.0.1:3000/api/demo
```

- **Dados**: fictícios, de uma instância `https://demo.freshservice.invalid`. Há 1.248 itens, 14 diferenças nos 4 tipos principais e 8 módulos.
- **Status**: `GET /api/connection/status` devolve `"status":"demo"` na demonstração, nunca `connected`. A demo não grava conexão autenticada.
- **Banner**: enquanto a demonstração estiver ativa, aparece o banner âmbar "MODO DEMONSTRATIVO — dados fictícios, não coletados do Freshservice", com o botão "Sair da demonstração". O cartão de conexão tem o mesmo botão.
- **Sair**: botão "Sair da demonstração" (banner ou cartão) ou "Remover dados de demonstração" em "Como funciona" e Configurações. O botão "Sair da demonstração" pede confirmação antes de apagar. Pela API: `{"action":"remover"}` no mesmo endpoint. A remoção toca só os registros de demonstração (instância `is_demo = 1`, o conjunto de dados e a auditoria dela). Instâncias reais não são alteradas.
- **Versão do conjunto**: a versão fica em `app_settings.demo_seed_version`. Se ela mudar, ativar a demo recria o conjunto fictício.
- **Migration 0003**: ao iniciar, remove a demonstração legada (seed anterior, com chaves de módulo sem ponto e conexão "connected"). Se você já usava a demo, ela sai no primeiro início depois da atualização. Ative de novo pela UI se quiser.
- **Aviso no terminal**: `pnpm dev` avisa, logo após preparar o banco, se a instância ativa for a demonstração.
- **Validações**: testes, Playwright e capturas de tela usam diretório de dados dedicado (`FSLM_DATA_DIR`). Não rode validações contra o diretório padrão do seu usuário.
- O `Origin` aceito é `http://127.0.0.1:PORTA` ou `http://localhost:PORTA`, na mesma porta. Outras origens recebem 403.

### 14.2 Simulador de OAuth (somente para testes)

- **O que é:** um provedor OAuth e uma API v2 **fictícios**, para exercitar o fluxo de autenticação sem Freshworks. **Não é autenticação Freshworks nem Freshservice.**
- **Ativação:** `FSLM_SIMULATOR=1` (valor exato) no processo do servidor. Sem a variável, as rotas `/simulador/**` e `/api/simulador/status` respondem 404.
- **Hosts reservados:** `*.freshservice.simulador.invalid` e `*.myfreshworks.simulador.invalid` (TLD `.invalid`, nunca resolvem na internet). São atendidos em processo, sem socket e sem DNS.
- **Identificação:** a faixa "SIMULADOR" aparece no topo de todas as telas enquanto a variável estiver ativa.
- **Cuidado:** `pnpm dev` repassa o ambiente ao servidor. Não deixe `FSLM_SIMULATOR=1` exportado no shell usado para o uso real, e não coloque a variável no `.env`.
- **Dados:** use `FSLM_DATA_DIR` absoluto e dedicado. Não use o diretório padrão do seu usuário.
- **Testes:** `pnpm test:e2e:sim` (14 testes). Detalhes em `docs/AUTH.md`, seção 15, e em `docs/AUTENTICACAO-UX-ANALISTA.md`, seção 9.

## 15. Privacidade

- **Somente leitura**: o cliente faz GET nos endpoints de leitura. A única escrita HTTP é a requisição de token OAuth.
- **Sem telemetria**: `NEXT_TELEMETRY_DISABLED=1` é definido pelos scripts.
- **Sem CDN**: a fonte é local (`@fontsource-variable/inter`).
- **Servidor local**: escuta em `127.0.0.1`, valida Host e Origin (`src/proxy.ts`), não tem CORS e envia CSP.
- **Destino de rede**: antes de cada chamada ao Freshservice, o host é resolvido por DNS, e a checagem se repete em cada redirecionamento. A chamada é recusada se algum endereço for interno (loopback, privado, link-local, metadados de nuvem, CGNAT etc.). Detalhes em `docs/AUTH.md`, seção 14.
- **Sem conteúdo de tickets**: conversas, atividades e anexos não são baixados (política do projeto).
- **Dados de pessoas**: e-mails e telefones nunca entram no registro gravado. **Locais e fornecedores ainda guardam endereço e nome de contato** (ver `docs/GUIA-DE-USO-E-COLETA.md`, seção 5.3).
- **Metadados**: "Somente metadados", por módulo, remove campos de conteúdo do registro normalizado. A opção de guardar a resposta original vem desligada.
- **Auditoria**: grava só códigos e status. Chaves, tokens, client secret, código e state não entram no banco (há teste para isso).
- **Dados reais de clientes**: não use dados reais de clientes em desenvolvimento, em testes ou em serviços externos, inclusive ferramentas de IA. Use o modo demonstrativo ou fixtures sintéticas.

## 16. Limitações de permissões e endpoints

- **Não testado com instância real nem com credenciais reais.** OAuth, API key e sincronização foram validados com testes, fixtures sintéticas e o simulador local. O OAuth **não foi homologado com o Freshworks**. Testes contra a API real exigem aprovação explícita.
- **Permissões**: com API key, vale o papel do agente ou do usuário de integração. Com OAuth, vale o escopo concedido ao perfil. Módulo sem permissão aparece como "Sem permissão"; módulo bloqueado pelo perfil aparece como "Escopo não autorizado". Em ambos os casos, não há dados.
- **Endpoints**: 23 módulos consultáveis têm caminho conferido no texto da documentação pública. O registro tem 26 entradas: 3 não suportadas. Workflows não têm GET documentado. Conversas e atividades de tickets ficam de fora por privacidade. Lista completa, chaves de resposta e escopos em `docs/ENDPOINTS.md`.
- **Não documentados pelo Freshworks**: endpoint de renovação de token, revogação remota, redirecionamento com `127.0.0.1`, e a relação entre o domínio do Freshservice e a organização Freshworks. Ver `docs/AUTENTICACAO-UX-ANALISTA.md`, seção 3.
- **Administração sem login**: as rotas `/api/admin/*` são protegidas pela guarda local de Host e Origin, que não autentica quem as usa (`docs/AUTH.md`, seção 2.2).
- macOS (Keychain) e Windows (DPAPI) não foram executados em sistema real.
- Sem lock entre processos: não rode `pnpm dev` e `pnpm start` ao mesmo tempo no mesmo banco.

## 17. Solução de erros comuns

- **Porta ocupada**: o bootstrap informa se a porta está em uso por outro programa. Libere a porta ou defina outra no `.env` (`PORT=3100`). Se for o próprio app, ele só abre o navegador.
- **Dependências ausentes ou desatualizadas**: rode `npm run dev -- --yes`. Sem internet, conecte-se e repita; nada é apagado.
- **`npm install` bloqueado**: o projeto usa o lockfile do pnpm. Use `npm run dev` (instala com pnpm) ou `pnpm install`.
- **Migration destrutiva bloqueada**: revise o SQL indicado em `drizzle/`. Para aplicar, defina `FSLM_ALLOW_DESTRUCTIVE_MIGRATIONS=1`; o backup é feito antes. As migrations aditivas (como a 0004) não são bloqueadas.
- **Diagnóstico geral do ambiente**: abra `http://127.0.0.1:PORT/ambiente`.
- **Módulo nativo better-sqlite3 não carrega**: o pacote traz binários prontos para Linux x64 (glibc e musl), Linux arm64 e Windows x64/arm64, sem compilação. Confira Node 22.12 ou superior e reinstale com `npm run dev -- --yes`. Só em arquitetura sem binário: instale o compilador (`bash scripts/setup.sh --build-tools` ou `scripts\setup.ps1 -BuildTools`) e rode `pnpm rebuild better-sqlite3`.
- **"Node ... não é suportado"**: instale Node 22.12 ou superior.
- **Diretório de dados recusado**: `FSLM_DATA_DIR` aponta para `public/`, pasta temporária ou pasta de nuvem. Use outro caminho absoluto.
- **Banco corrompido ou não SQLite**: o app mostra diagnóstico e sai com código 1, sem apagar nada. Copie o diretório de dados inteiro e restaure um backup válido. Só se aceitar perder o histórico local, mova manualmente `fslm.db`, `fslm.db-wal` e `fslm.db-shm` para outra pasta. Na próxima inicialização, o app cria um banco novo.
- **Cofre indisponível** ("Nenhum cofre seguro disponível"): no Linux, instale `secret-tool` e confirme o serviço de segredos. Ou defina `FSLM_SECRET_KEY` (seção 9).
- **"Configuração administrativa ausente"**: não há perfil de integração para este cliente. Um responsável cadastra o perfil (seção 7).
- **"Autorização negada"**: você negou a autorização na aba do Freshworks. Conecte de novo e aprove o acesso.
- **"Escopo insuficiente"**: o perfil não tem escopo de leitura suficiente para a verificação. Um responsável revisa os escopos do perfil.
- **401**: credencial rejeitada. Em API key, confira a chave e o modo (ela não é gravada). Em OAuth, o estado `session_expired` apaga os tokens locais; conecte de novo.
- **403 (`no_permission`)**: a conta não tem permissão. Confira o papel do agente (API key) ou o escopo do perfil (OAuth) e peça acesso ao administrador do Freshservice.
- **429**: limite de requisições atingido. Aguarde o tempo indicado em `Retry-After` (segundos) e tente de novo.
- **Retorno OAuth com `?conn=error`**: o cookie de state vale 10 minutos e é específico do navegador e do host. Refaça a conexão no próprio app, com o mesmo navegador, em `http://127.0.0.1:PORT`, e conclua em até 10 minutos.
- **403 ao acessar o app (Host ou Origin)**: abra `http://127.0.0.1:PORT`, o endereço canônico (`localhost` redireciona para ele).

### 17.1 Tabela de erros da API

Respostas de erro têm o formato `{ "error": { "code", "message" } }`. As mensagens não trazem segredos nem valores enviados.

| Código | HTTP | Quando acontece | O que fazer |
|---|---|---|---|
| `no_active_instance` | 409 | Nenhuma instância ativa. | Cadastre ou ative uma instância em Configurações. |
| `demo_instance` | 409 | A instância ativa é a demonstrativa; a ação exige uma instância real. | Cadastre a instância real e ative-a. |
| `no_connection` | 409 | A instância ativa não tem conexão. | Conecte por OAuth ou API key. |
| `connection_not_ready` | 409 | A conexão ainda não está pronta para a coleta (não validada ou desconectada). | Rode o teste de conexão ou reconecte. |
| `session_expired` | 409 (ao sincronizar) ou 401 (renovação OAuth recusada) | A sessão OAuth expirou e os tokens locais foram apagados. | Conecte de novo pelo OAuth. |
| `admin_config_missing` | 409 | Não há perfil de integração que cubra o domínio da instância. | Um responsável cadastra o perfil (seção 7). |
| `oauth_not_configured` | 409 | O segredo do perfil não está no cofre. | Um responsável atualiza o perfil e informa o client secret. |
| `sync_already_running` | 409 | Já há uma coleta em andamento. | Aguarde ou cancele a execução ativa. |
| `diagnostics_running` | 409 | Já há um diagnóstico em andamento. | Aguarde o resultado. |
| `no_previous_run` | 409 | "Sincronizar novamente" sem execução anterior concluída. | Use "Mapear tudo". |
| `no_failed_modules` | 409 | "Repetir falhas" sem módulos com erro. | Nada a repetir. |
| `retry_run_not_found` | 404 | A execução indicada para repetir não existe. | Confira a execução na página Histórico. |
| `profile_not_found` | 404 | Perfil de integração inexistente. | Confira a lista em Configurações. |
| `profile_in_use` | 409 | Tentativa de remover perfil usado por uma conexão. | Desconecte a instância antes de remover o perfil. |
| `domain_conflict` | 409 | Um dos domínios já pertence a outro perfil. | Cada domínio do Freshservice pertence a um só perfil. |
| `invalid_scope` | 400 | Escopo fora da lista oficial. | Use os escopos sugeridos pelo formulário. |
| `manage_scopes_not_allowed` | 400 | Escopo fora de `.view` sem consentimento do perfil. | Marque "Permitir escopos de gestão ou escrita", com autorização do cliente. |
| `invalid_domain` | 400 | Domínio do Freshservice fora de `*.freshservice.com`. | Informe o hostname, por exemplo `acme.freshservice.com`. |
| `use_loopback_host` | 400 | Requisição com Host diferente de `localhost` ou `127.0.0.1`, ou porta de build divergente da de execução. | Abra `http://127.0.0.1:PORT`. |
| `unsafe_destination` | 400 | O domínio resolve para endereço interno, de loopback, link-local ou de metadados. | Confira o domínio da instância. |
| `dns_failed` | 400 | O domínio não foi resolvido (falha de DNS ou tempo esgotado). | Confira o nome e a rede. |
| `invalid_url` | 400 | URL fora de `https://<empresa>.freshservice.com` (instância) ou de `*.freshworks.com`/`*.myfreshworks.com` (organização). | Use o endereço correto. |
| `invalid_input` | 400 | Campo inválido. A mensagem cita só o nome do campo. | Corrija o campo indicado. |
| `unsupported_media` | 415 | Corpo da requisição fora de `application/json`. | Envie JSON. |
| `forbidden_host` | 403 | Host diferente de `127.0.0.1` ou `localhost` na porta do app. | Abra `http://127.0.0.1:PORT`. |
| `forbidden_origin` | 403 | Requisição mutável sem Origin local, ou cross-site. | Use a própria interface do app. |
| `moved` | 410 | Rota antiga de configuração OAuth (`/api/auth/oauth/config`). | Use `/api/admin/integration-profiles`. |

Diagnóstico e sincronização respondem **202** ao iniciar. O andamento aparece no status, e não na resposta do POST.

## 18. Comandos de desenvolvimento

Scripts definidos em `package.json`:

```bash
pnpm dev                          # bootstrap + next dev (npm run dev)
pnpm bootstrap                    # só prepara o ambiente (npm run bootstrap)
pnpm build                        # next build, com telemetria desativada
pnpm start                        # next start em 127.0.0.1 (exige build antes)
pnpm test                         # vitest run (66 arquivos)
pnpm typecheck                    # tsc --noEmit
pnpm test:e2e                     # interface em build de produção (porta 3110)
pnpm test:e2e:dev                 # interface com pnpm dev (porta 3111)
pnpm test:e2e:sim                 # interface com o simulador OAuth fictício (porta 3112)
pnpm test:e2e:all                 # test:e2e e test:e2e:dev em sequência
pnpm db:generate --name=<nome>    # drizzle-kit generate, a partir de src/lib/db/schema.ts
```

Para mudar o schema: edite `src/lib/db/schema.ts`, gere a migration com `pnpm db:generate --name=<nome>` e revise o SQL gerado. Não edite migration já aplicada.

- **Não rode `pnpm build` com `pnpm dev` ativo neste projeto.** Os dois usam o mesmo `.next`: o build sobrescreve os artefatos do dev server, que pode entrar em laço de recarga no navegador. Pare o dev antes de buildar.
- Os testes de interface usam um diretório de dados novo dentro de `.e2e-data/`, nunca o do seu usuário.

## 19. Estrutura de pastas (resumida)

- `src/app/`: páginas e rotas `/api`. `src/app/simulador/`: páginas do simulador, só com `FSLM_SIMULATOR=1`.
- `src/lib/`: `config`, `db`, `secrets` (cofre), `auth` (perfis de integração e OAuth), `security` (validação de URL, DNS e origem), `freshservice` (cliente HTTP, módulos e mapa de escopos), `sync` (motor de sincronização), `diff` (motor de diferenças), `queries`, `demo`, `simulator` (provedor fictício), `audit`, `ui`.
- `src/components/`: componentes de interface (`dashboard/connection-card.tsx`, `config/integration-*.tsx`). `src/proxy.ts`: Host, Origin e cabeçalhos de segurança.
- `drizzle/`: migrations versionadas (0000 a 0004). `scripts/start-dev.mjs`: bootstrap do `pnpm dev`/`npm run dev`; `scripts/setup.sh` e `scripts/setup.ps1`: pré-requisitos.
- `tests/`: testes Vitest por área; `tests/ui-e2e/` (interface), `tests/ui-e2e-sim/` (simulador) e `tests/visual/` para capturas de tela.
- `docs/`: `AUTH.md` (referência técnica de autenticação), `AUTENTICACAO-UX-ANALISTA.md` (experiência do analista e do administrador), `GUIA-DE-USO-E-COLETA.md` (guia do usuário), `VALIDACAO.md` (resultados e pendências), `ENDPOINTS.md`, `DIFF.md`, `screenshots/`.
- Raiz: `package.json`, `.env.example`, `drizzle.config.ts`, `next.config.ts`, `vitest.config.ts`, `playwright.config.ts`.

## Release e contribuição

Repositório: [mnstechbr/Freshservice-Local-Mapper](https://github.com/mnstechbr/Freshservice-Local-Mapper). Licença [MIT](LICENSE), após confirmação do titular. Veja [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md) e [relatório da estabilização](docs/RELATORIO-FINAL-CODEX.md).

**Integração real Freshservice e Windows 11 NÃO HOMOLOGADOS.** A beta permite demonstrar o inventário com dados fictícios. [Demonstração integral com duas coletas](docs/DEMONSTRACAO-SIMULADOR.md).

A seleção da URL pode ser salva em **Configurações → Instância Freshservice → Salvar instância**, sem perfil OAuth, popup ou API key. A autenticação é uma ação separada.

Privacidade desta beta: novas coletas de Locais/Fornecedores excluem endereços e contatos do registro normalizado e original, recursivamente. ITSM usa somente metadados por padrão; pessoas omitem assinatura/background_information quando esse modo está ligado. Nomes, assuntos e campos personalizados permanecem. Dados antigos não são apagados: a primeira coleta pode revelar valores anteriores nas diferenças. SQLite e backups não são cifrados; use armazenamento protegido (LUKS/BitLocker) e acesso restrito ao usuário.

Dependências diretas e Actions estão fixadas; lockfile com integridades é obrigatório. Corepack confere o hash do pnpm em packageManager. O fallback npm exec fixa a versão e usa a confiança/integridade do registro npm; não confere o hash Corepack.
