# Guia de uso e coleta de dados

Freshservice Local Mapper (Mapeador Local Freshservice), versão 0.1.0.

Este guia é para analistas de suporte, gestores e pessoas sem experiência em programação. Ele explica o que a ferramenta faz, quais informações ela consulta e guarda, como os dados são protegidos e como usar a aplicação do zero. A seção 7 também traz a configuração única que um **administrador** faz por cliente.

Tudo o que está aqui foi conferido no código em 2026-10-12. Os detalhes técnicos estão em [`AUTH.md`](AUTH.md) e, para a experiência de autenticação, em [`AUTENTICACAO-UX-ANALISTA.md`](AUTENTICACAO-UX-ANALISTA.md). As evidências de segurança estão em [`AUDITORIA-READ-ONLY.md`](AUDITORIA-READ-ONLY.md).

> **Situação atual do projeto**
>
> - A aplicação está em desenvolvimento.
> - **Ainda não foi testada com uma instância real do Freshservice.** Toda a validação usou dados simulados.
> - **O login OAuth não foi homologado com o Freshworks.** Foi validado apenas contra um simulador local, que é fictício.
> - **Fedora Linux 44:** testado de verdade.
> - **Windows 11:** o suporte está implementado, mas **ainda não foi executado em um Windows 11 real**. Use com cautela.

---

## 1. O que é a ferramenta

### 1.1 Objetivo

O Freshservice Local Mapper faz um **inventário** do seu Freshservice. Ele lista, por exemplo, os itens do catálogo de serviços, os campos dos formulários, os artigos da base de conhecimento e os grupos de atendimento. Depois, guarda esse inventário **no seu computador**.

Quando você roda a coleta de novo, a ferramenta compara o resultado com a coleta anterior e mostra **o que mudou**: um nome alterado, um item novo, um item que sumiu ou um campo de formulário que passou a ser obrigatório.

### 1.2 Para que foi desenvolvida

- Documentar a configuração de uma instância Freshservice sem copiar nada à mão.
- Acompanhar mudanças feitas por outras pessoas ao longo do tempo.
- Ter um histórico consultável, inclusive sem internet.
- Fazer tudo isso **sem alterar nada** no Freshservice e **sem enviar os dados para nenhuma nuvem** além do próprio Freshservice.

### 1.3 Como funciona o mapeamento

1. Você informa o endereço da sua instância (por exemplo, `https://suaempresa.freshservice.com`).
2. Você se autentica, por OAuth ou por chave de API.
3. A ferramenta faz **consultas de leitura** na API oficial do Freshservice, módulo por módulo, em páginas de até 100 itens.
4. Cada item recebido passa por uma limpeza (sanitização) que retira campos sensíveis, como e-mails, telefones, anexos e qualquer campo com nome de senha, token ou chave.
5. O resultado limpo é gravado em um banco de dados local (SQLite).

> A ferramenta usa os **endpoints oficiais da API** do Freshservice. Ela não "lê as telas" do portal. Por isso, nem tudo que aparece no portal está disponível, e algumas informações da API não aparecem em tela nenhuma do portal.
>
> O que você vai conseguir mapear depende de três coisas:
>
> - das **permissões** da conta usada na conexão;
> - do **plano** contratado do Freshservice;
> - dos **módulos habilitados** na sua instância.

### 1.4 Como funciona a comparação entre coletas

Cada coleta recebe um número e fica registrada no histórico. Ao terminar, a ferramenta compara a coleta nova com a última coleta concluída **da mesma instância e da mesma conexão**.

Para cada item, ela usa o identificador (ID) do Freshservice. Ela verifica:

- se o item é novo;
- se o item não apareceu mais;
- se o nome mudou;
- se algum campo mudou (por exemplo, um campo de formulário que passou a ser obrigatório, ou uma opção nova numa lista);
- se um item que sumiu e um item novo parecem ser **o mesmo item com outro ID**.

Datas de atualização e mudanças só de ordem não contam como alteração.

A ferramenta é cuidadosa com remoções. Ela só diz que um item foi **removido** quando as duas coletas daquele módulo terminaram por completo. Se uma delas ficou incompleta (por falta de permissão, erro de rede, escopo não autorizado ou cancelamento), o item aparece como **Não observado**, nunca como removido.

### 1.5 Por que o armazenamento é local

- **Privacidade:** o inventário pode conter nomes de pessoas e informações internas. Ele fica só no seu computador.
- **Sem nuvem extra:** a ferramenta não envia dados para servidores próprios, serviços de análise ou terceiros.
- **Funciona sem internet:** depois da primeira coleta, você consulta o inventário, o histórico e as diferenças sem conexão.
- **Histórico sob seu controle:** você decide quando fazer backup e quando apagar.

---

## 2. Compromisso de somente leitura

> ### O Freshservice Local Mapper não foi desenvolvido para modificar informações do Freshservice.
>
> A ferramenta serve para **consultar, inventariar, armazenar localmente e comparar** informações.
>
> Ela **não** deve, e pelo código auditado **não consegue**:
>
> - criar tickets;
> - excluir solicitações;
> - alterar itens do catálogo;
> - modificar formulários;
> - alterar permissões;
> - criar usuários;
> - atualizar configurações;
> - excluir artigos ou documentos;
> - executar qualquer alteração administrativa no Freshservice do cliente.
>
> **Resultado da auditoria de 2026-10-11:** todas as consultas ao Freshservice usam apenas o método de leitura (GET). A garantia vale para a versão auditada, conferida no código e em testes com servidor simulado. Ela ainda não foi confirmada com tráfego real (ver [`AUDITORIA-READ-ONLY.md`](AUDITORIA-READ-ONLY.md)).

**Sobre a autenticação.** Para entrar com OAuth, a ferramenta faz uma chamada técnica do tipo POST ao servidor de login do Freshworks. Essa chamada só troca uma autorização por um "token de acesso" e depois renova esse token. Ela **não cria nem altera** tickets, serviços, usuários ou configurações.

Alguns efeitos são normais e esperados:

- o Freshworks pode registrar que você autorizou o aplicativo;
- o Freshservice pode registrar as consultas nos logs de acesso;
- as consultas contam no limite de requisições da sua conta.

**Revisões feitas na ferramenta ficam só no seu computador.** Na tela de diferenças existem os botões **Confirmar** e **Rejeitar**. Eles gravam sua decisão no banco local e nunca enviam nada ao Freshservice.

**Atenção às permissões da credencial.** A ferramenta só lê, mas a credencial usada pode ter mais poder que isso:

- uma chave de API pessoal tem todas as permissões do agente dono dela;
- alguns escopos OAuth exigidos pela documentação do Freshservice são de gestão (terminam em `.manage` ou `.edit`). A ferramenta só os usa se o administrador os autorizar no perfil.

Se a credencial vazar, quem a tiver pode fazer mais do que a ferramenta faz. Use um **usuário de integração com papel apenas de leitura** sempre que possível e proteja seu computador.

---

## 3. Módulos suportados

Legenda da última coluna:

- **Implementado:** o código existe e é usado na coleta.
- **Validado com dados simulados:** passou nos testes automáticos com respostas fictícias baseadas na documentação. **Nenhum módulo foi validado com uma instância real até agora.**

| Nome | O que consulta | Informações coletadas | O que é armazenado | Para que é usado | O que é excluído ou protegido | Situação |
|---|---|---|---|---|---|---|
| Catálogo: categorias | Lista de categorias de serviço | ID, nome, descrição | Os mesmos campos, sem os excluídos | Inventário e comparação | Links, ícones, e-mails, telefones e campos com nome de senha, token, chave ou segredo | Implementado; validado com dados simulados |
| Catálogo: itens | Lista de itens de serviço | ID, número de exibição, nome, descrição, categoria, visibilidade e demais atributos | Idem, com vínculo à categoria | Inventário, troca de ID, nome alterado | Idem | Implementado; validado com dados simulados. Exige escopo de gestão (`.edit`) no OAuth |
| Catálogo: campos do formulário | Detalhe de cada item (uma consulta por item) | Campos do formulário: rótulo, tipo, obrigatório, opções | Idem | Detectar campo novo, removido, renomeado, obrigatório ou opção alterada | Idem | Implementado; validado com dados simulados. Exige escopo de gestão (`.edit`) no OAuth |
| Base de conhecimento: categorias | Categorias de soluções | ID, nome, descrição | Idem | Inventário | Idem | Implementado; validado com dados simulados |
| Base de conhecimento: pastas | Pastas de cada categoria | ID, nome, descrição, categoria, visibilidade | Idem | Inventário | Idem | Implementado; validado com dados simulados |
| Base de conhecimento: artigos | Artigos de cada pasta | Título, status, pasta, datas; o texto do artigo só se você desligar "Somente metadados" | Por padrão, **sem o texto do artigo** | Inventário e mudanças de título e status | Texto do artigo (padrão), anexos | Implementado; validado com dados simulados |
| Tickets | Lista de tickets | Assunto, tipo, status, prioridade, origem, IDs de solicitante, agente, grupo e departamento, categorias, datas, campos personalizados | Por padrão, **sem a descrição** | Inventário e vínculos | Descrição (padrão), conversas, atividades, anexos, e-mails | Implementado; validado com dados simulados |
| Tickets: campos do formulário | Campos do formulário de tickets | Nome, rótulo, tipo, obrigatório, posição, opções | Idem | Mudanças no formulário | Idem | Implementado; validado com dados simulados. Exige escopo de gestão (`.manage`) no OAuth |
| Agentes | Lista de agentes | Nome, cargo, ativo, departamentos, grupos, local e outros atributos do cadastro | Idem | Inventário e vínculos | E-mails, telefones e endereço | Implementado; validado com dados simulados. Exige escopo de gestão (`.manage`) no OAuth |
| Solicitantes | Lista de solicitantes | Igual a agentes | Idem | Inventário e vínculos | E-mails, telefones e endereço | Implementado; validado com dados simulados |
| Departamentos | Lista de departamentos | ID, nome, descrição, responsáveis (por ID) | Idem | Inventário | Padrão | Implementado; validado com dados simulados |
| Grupos de agentes | Lista de grupos | ID, nome, descrição, workspace | Idem | Inventário | Padrão | Implementado; validado com dados simulados. Exige escopo de gestão (`.manage`) no OAuth |
| Grupos de solicitantes | Lista de grupos | ID, nome, descrição | Idem | Inventário | Padrão | Implementado; validado com dados simulados |
| Ativos | Lista de ativos (CMDB) | Nome, etiqueta, número de série, tipo, local, departamento, usuário (por ID), datas, descrição | Idem | Inventário e vínculos | Padrão | Implementado; validado com dados simulados |
| Tipos de ativo | Lista de tipos | ID, nome, descrição, tipo pai | Idem | Inventário | Padrão | Implementado; validado com dados simulados |
| Problemas | Lista de problemas | Assunto, status, prioridade, impacto, urgência, categoria, IDs, datas, **descrição** | Idem (a descrição é guardada por padrão) | Inventário | Padrão; ligue "Somente metadados" para retirar a descrição | Implementado; validado com dados simulados |
| Mudanças | Lista de mudanças | Igual a problemas | Igual a problemas | Inventário | Igual a problemas | Implementado; validado com dados simulados |
| Releases | Lista de releases | Igual a problemas | Igual a problemas | Inventário | Igual a problemas | Implementado; validado com dados simulados |
| Workspaces | Lista de workspaces | ID, nome, descrição, principal, ativo, datas | Idem | Inventário | Padrão | Implementado; validado com dados simulados |
| Políticas de SLA | Lista de SLAs | ID, nome, descrição, posição, padrão, ativo | Idem | Inventário | Padrão | Implementado; validado com dados simulados |
| Locais | Lista de locais | Nome, local pai, datas, **endereço e nome de contato** | Idem (**endereço e nome de contato são guardados**, ver seção 5.3) | Inventário | E-mail e telefone | Implementado; validado com dados simulados |
| Produtos | Lista de produtos | ID, nome, descrição, tipo de ativo, fabricante, status | Idem | Inventário | Padrão | Implementado; validado com dados simulados |
| Fornecedores | Lista de fornecedores | Nome, descrição, **endereço e nome de contato** | Idem (**endereço e nome de contato são guardados**, ver seção 5.3) | Inventário | E-mail e telefone | Implementado; validado com dados simulados |

"Padrão" quer dizer: links, ícones, anexos, e-mails, telefones e qualquer campo com nome de senha, token, chave ou segredo.

A ferramenta registra **23 módulos consultáveis** (endpoints) em 7 áreas. A área de automações também existe no registro, mas não tem consulta disponível. A tabela acima lista as áreas e os módulos da interface.

**Não suportados (nunca consultados):**

- **Conversas e atividades de tickets:** ficam de fora por regra de privacidade.
- **Automações e workflows:** a documentação da API não traz uma consulta de leitura para eles.

---

## 4. Como funciona o banco local (SQLite)

### 4.1 Onde fica

| Sistema | Pasta padrão |
|---|---|
| Fedora (Linux) | `~/.local/share/freshservice-local-mapper/` (ou `$XDG_DATA_HOME/freshservice-local-mapper/`) |
| Windows 11 | `%LOCALAPPDATA%\FreshserviceLocalMapper\` |

O arquivo principal é `fslm.db`. Na mesma pasta ficam `fslm.db-wal` e `fslm.db-shm` (arquivos auxiliares do SQLite), a pasta `backups/` e, quando usados, os segredos cifrados em `secrets/`.

Você pode escolher outra pasta com a variável `FSLM_DATA_DIR`. A ferramenta **recusa** pastas perigosas: a pasta pública do projeto, a pasta temporária do sistema, pastas sincronizadas com nuvem (OneDrive, Dropbox, Google Drive, iCloud) e, no Windows, pastas de rede.

O caminho em uso aparece em **Configurações → Dados locais** e na página **Ambiente local**.

### 4.2 O que fica guardado

| Informação | Exemplo | Onde aparece na tela |
|---|---|---|
| Identificadores dos recursos | ID 32, número de exibição do item | Todas as listas |
| Nomes e descrições | "Instalação de software" | Listas e detalhe do recurso |
| Categorias | "Software" | Listas |
| Campos e opções de formulários | "Sistema operacional" (obrigatório; opções Windows e Linux) | Detalhe do recurso |
| Outros atributos permitidos | status, prioridade, workspace, datas do Freshservice | Detalhe do recurso |
| Datas de sincronização | início e fim de cada coleta | Histórico |
| Histórico das coletas | coletas concluídas, parciais, com falha, canceladas | Histórico de sincronizações |
| Versões anteriores | cada mudança gera uma versão nova; as antigas são mantidas | Detalhe do recurso |
| Alterações detectadas | nome alterado, item novo, campo alterado | Diferenças detectadas |
| Relacionamentos | item → categoria, artigo → pasta, ticket → grupo | Detalhe do recurso |
| Estado de acesso por módulo | Acessível, Sem permissão, Escopo não autorizado, Não encontrado | Status dos endpoints |
| Logs operacionais | "Módulo X concluído", códigos de erro | Logs de sincronização |
| Configuração | endereço da instância, preferências, perfis de integração (Client ID e escopos; o client secret fica no cofre) | Configurações |
| Suas revisões | "Confirmar" ou "Rejeitar" uma troca de ID | Diferenças detectadas |

**Não ficam no banco:** a chave de API, o client secret e os tokens OAuth. O banco guarda só uma referência ao cofre de segredos (seção 6.3).

### 4.3 Resposta original da API (opcional)

Em **Configurações → Preferências de coleta** existe a opção **"Guardar a resposta original da API no banco local"**. Ela vem **desmarcada**. Quando marcada, a resposta original também é guardada, com as mesmas remoções de segurança. Deixe desmarcada, salvo necessidade específica.

---

## 5. Regras de sanitização (limpeza dos dados)

### 5.1 O que sempre é retirado

Antes de gravar, a ferramenta retira, em qualquer nível do registro:

- **Segredos:** qualquer campo cujo nome contenha `password`, `secret`, `token`, `api_key` ou `api-key` (sem diferença de maiúsculas). Se um campo personalizado legítimo tiver uma dessas palavras no nome, ele também sai.
- **E-mails:** `email`, `emails`, `primary_email`, `secondary_emails`, `cc_emails`, `fwd_emails`, `reply_cc_emails`, `to_emails`.
- **Telefones:** `phone`, `mobile`, `work_phone_number`, `mobile_phone_number`.
- **Anexos e URLs temporárias:** `attachments`, `icon_url`, `avatar_url`, `image_url`, `logo_url`, além de links de paginação. Os links de anexo trazem códigos de acesso temporários e nunca são gravados.
- **Endereço de agentes e solicitantes; endereços e contatos de Locais/Fornecedores**, também em objetos aninhados e na resposta original opcional.

### 5.2 "Somente metadados"

Em **Configurações → Preferências de coleta**, cada módulo tem a opção **"Somente metadados"**. Ligada, ela retira os campos de conteúdo, como descrição e texto de artigo.

- **Ligada por padrão:** tickets, artigos da base de conhecimento e ITSM (problemas, mudanças e releases). Preferências já salvas explicitamente são respeitadas.
- **Desligada por padrão:** os demais módulos. Em pessoas, ligar somente metadados omite assinatura e background_information.

### 5.3 Limitações conhecidas da sanitização

Seja transparente com quem vai usar os dados:

1. **Contatos e endereços de Locais/Fornecedores são removidos nas novas coletas.** Versões históricas não foram apagadas; a primeira coleta após atualização pode mostrar valores anteriores nas diferenças.
2. **Nomes de pessoas são guardados** (nome e sobrenome de agentes e solicitantes, assunto de tickets).
3. **Campos personalizados são guardados.** Se a sua instância usa campos personalizados com dados pessoais (documento, matrícula etc.), eles entram no banco.
4. **Texto livre não é analisado.** Um e-mail ou telefone escrito dentro de uma descrição, assunto ou assinatura não é detectado.
5. **Campos novos entram automaticamente.** A ferramenta guarda todos os campos que a API devolve, menos os da lista de exclusão. Se o Freshservice passar a devolver um campo novo, ele será guardado.

Por isso, **trate o banco local como informação confidencial da empresa**.

---

## 6. Segurança

### 6.1 Como a autenticação funciona

Há duas formas de conexão:

- **OAuth (recomendado).** Um responsável cadastra, uma vez por cliente, a credencial do aplicativo no Freshworks (seção 7, Passo 3). Depois, você conecta **a sua própria conta** numa aba do navegador. A ferramenta recebe um token de acesso válido por cerca de 30 minutos e o renova sozinha. Você não digita sua senha na ferramenta.
- **Chave de API (opção técnica avançada).** Você copia a chave do seu perfil no Freshservice (ou de um usuário de integração) e cola na ferramenta. Antes de guardar, ela faz uma consulta de teste. Se a chave for rejeitada, nada é gravado. Não é a opção recomendada.

Duas opções de chave aparecem na tela:

- **Usuário de integração:** identidade técnica, separada de pessoas. É a opção recomendada.
- **API key pessoal:** as consultas ficam registradas em nome do agente dono da chave, com as permissões dele.

### 6.2 Quais permissões são usadas

A ferramenta só precisa de **leitura**. Na prática:

- **Com OAuth**, valem os escopos do **perfil de integração** cadastrado pelo administrador. O padrão é somente leitura (`.view`).
- **Módulos que a documentação só permite ler com escopo de gestão** (`.manage` ou `.edit`) ficam bloqueados por padrão e aparecem como **Escopo não autorizado**:
  - agentes (`freshservice.agents.manage`);
  - grupos de agentes (`freshservice.agentgroups.manage`);
  - campos de formulário de tickets (`freshservice.tickets.fields.manage`);
  - itens do catálogo (`freshservice.service_catalog.edit`).

  Liberá-los exige marcar **"Permitir escopos de gestão ou escrita"** no perfil, com autorização do cliente. Esses escopos podem permitir escrita no Freshservice. A lista completa está em [`ENDPOINTS.md`](ENDPOINTS.md).
- **Com chave de API**, vale o papel do agente dono da chave. Prefira um usuário de integração com papel de leitura.

Módulos sem permissão aparecem como **Sem permissão**, e módulos bloqueados pelo perfil aparecem como **Escopo não autorizado**. Em ambos os casos, o módulo é pulado e o restante da coleta continua.

### 6.3 Como as credenciais são protegidas

A chave de API, o client secret e os tokens OAuth **nunca são gravados em texto puro** pela ferramenta. Eles vão para um cofre:

| Sistema | Cofre usado |
|---|---|
| Fedora | Chaveiro do sistema (GNOME Keyring ou KWallet), via `secret-tool`. O chaveiro precisa estar desbloqueado |
| Windows 11 | DPAPI do Windows. Só o seu usuário do Windows consegue decifrar (smoke real no Windows Server; Windows 11 não homologado) |
| Qualquer sistema (alternativa) | Arquivo cifrado com AES-256-GCM, que só funciona se você definir a variável `FSLM_SECRET_KEY` |

Se nenhum cofre estiver disponível, a ferramenta **não guarda** a credencial e mostra o motivo.

Outras proteções:

- Os segredos não aparecem na tela depois de salvos.
- Os segredos não vão na linha de comando dos programas auxiliares.
- Os logs passam por uma limpeza que troca tokens, chaves e senhas por `[REDACTED]`.

> **Cuidado com `FSLM_SECRET_KEY`.** Se você usar o arquivo cifrado, a chave fica onde você a definir. Não a coloque dentro da pasta do projeto, não envie para o GitHub e guarde uma cópia em local seguro. Sem ela, os segredos cifrados ficam ilegíveis.

### 6.4 O banco tem criptografia?

**Não.** O banco SQLite e os backups **não são criptografados**. A proteção vem das permissões de arquivo:

- **Fedora:** só o seu usuário lê a pasta (permissões `0700` na pasta e `0600` nos arquivos).
- **Windows:** vale a proteção padrão da pasta do perfil.

Para proteger o conteúdo contra roubo do computador, use **criptografia de disco**: LUKS no Fedora ou BitLocker no Windows.

### 6.5 Backups

- **Automático:** antes de atualizar a estrutura do banco (numa nova versão do app), a ferramenta faz uma cópia em `backups/`. Ela guarda as 5 cópias mais recentes. A cópia feita antes de uma mudança destrutiva autorizada nunca é apagada automaticamente.
- **Manual:** pare o aplicativo e copie `fslm.db` junto com `fslm.db-wal` e `fslm.db-shm` (se existirem).
- **Os backups contêm os mesmos dados do banco.** Não os coloque em pastas de nuvem, e-mail ou drives compartilhados.
- **Os segredos não estão nos backups.** Em outro computador, será preciso conectar de novo.

### 6.6 Comunicações externas

| Quando | Destino | Por quê |
|---|---|---|
| Instalação (primeira vez) | Repositórios do Fedora (`dnf`) ou `winget` da Microsoft, e o registro npm | Instalar Node.js e as bibliotecas do projeto |
| Login OAuth e renovação de token | Servidor da organização Freshworks informada no perfil (`*.freshworks.com` ou `*.myfreshworks.com`) | Autorizar e obter tokens |
| Teste de conexão, diagnóstico e coleta | Sua instância Freshservice (`*.freshservice.com`) | Consultas de leitura |

Mais nada: não há telemetria, rastreamento, fontes externas nem serviços de terceiros. A interface roda só no seu computador, em `http://127.0.0.1`.

### 6.7 O que permanece no computador

Tudo o que foi coletado, o histórico, as diferenças, as revisões, os logs e as configurações. Os segredos ficam no cofre do sistema (ou no arquivo cifrado).

### 6.8 Sem internet

Depois de uma coleta concluída, você pode abrir o painel, os recursos, o histórico, as diferenças e os logs **sem internet**. Sem conexão, não é possível testar a conexão, renovar o login, coletar nem diagnosticar. O modo demonstrativo funciona sem internet.

### 6.9 Modo demonstrativo

O modo demonstrativo carrega **dados fictícios** para você conhecer as telas. Ele usa uma instância falsa (`demo.freshservice.invalid`), nunca consulta o Freshservice e é removido sem tocar nos seus dados reais. Enquanto está ativo, uma faixa amarela avisa: "MODO DEMONSTRATIVO — dados fictícios".

---

## 7. Tutorial passo a passo

Os nomes de botões e telas abaixo são os que existem na versão 0.1.0.

### Passo 1 — Preparar o computador

**Requisitos:**

- Fedora Linux 44 (testado) ou Windows 11 (ainda não testado em máquina real).
- Node.js 22.12 ou mais recente e npm. Os scripts de preparação instalam se faltar.
- Internet na primeira execução, para instalar as bibliotecas.
- Permissão de administrador só se for preciso instalar o Node.js.
- Fedora: para guardar credenciais no chaveiro do sistema, o pacote `libsecret` (o script oferece a instalação) e uma sessão gráfica com o chaveiro desbloqueado.

**Baixar o projeto:** no GitHub, use **Code → Download ZIP** e extraia, ou, se tiver Git:

```bash
git clone <endereço-do-repositório>
cd Freshservice-API
```

Não extraia o projeto dentro de pastas do OneDrive, Dropbox ou Google Drive.

**Fedora:**

```bash
bash scripts/setup.sh
```

O script verifica o Node.js e o npm. Se faltar algo, ele mostra o comando `dnf` exato e **pergunta antes de instalar** (a resposta padrão é não). Opções úteis:

- `bash scripts/setup.sh --check`: só verifica, não instala nada.
- `bash scripts/setup.sh --build-tools`: oferece também compilador, só se a instalação reclamar de compilação.

**Windows 11** (PowerShell, na pasta do projeto):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

O script usa o `winget` (gerenciador oficial da Microsoft) para instalar o Node.js LTS, após sua confirmação. O Windows pode pedir elevação (UAC). Se o comando `node` não for reconhecido depois, feche e abra o PowerShell de novo.

**Limitações conhecidas:**

- O Windows 11 ainda não foi executado de verdade. Bootstrap e DPAPI passaram no CI Windows Server 2025; winget/UAC e navegador/encerramento em Windows 11 continuam pendentes.
- No Windows, se o PowerShell estiver em modo restrito por política da empresa (AppLocker/WDAC), o cofre DPAPI pode não funcionar. Nesse caso, use `FSLM_SECRET_KEY`.
- Fedora anterior ao 44 não foi testado.
- No Fedora sem sessão gráfica ou com chaveiro bloqueado, o cofre do sistema fica indisponível. Use `FSLM_SECRET_KEY` (seção 6.3).

### Passo 2 — Iniciar o aplicativo

Na pasta do projeto:

```bash
npm run dev
```

Na primeira vez, o aplicativo:

1. confere o Node.js;
2. pergunta se pode instalar as bibliotecas (responda `S`);
3. cria a pasta de dados e o banco SQLite automaticamente;
4. verifica o cofre de segredos e avisa se nenhum estiver disponível;
5. abre o navegador em **`http://127.0.0.1:3000`**.

Se o navegador não abrir, digite esse endereço. **Use `127.0.0.1`, não `localhost`.** Páginas abertas em `localhost` são redirecionadas para `127.0.0.1`, enquanto o callback OAuth pode usar localhost, conforme o perfil (seção 7, Passo 3).

Para parar o aplicativo, pressione `Ctrl+C` no terminal.

Quer só conhecer as telas? Em **Configurações → Modo demonstrativo**, clique em **Ativar modo demonstrativo**. Para sair, use **Sair da demonstração** ou **Remover dados de demonstração**.

### Passo 3 — Configuração única do administrador (uma vez por cliente)

**Quem faz:** o responsável pela integração, com permissão de administrador na organização Freshworks do cliente. O analista **não** faz esta etapa, e não precisa dela para conectar.

Esta configuração é feita **uma vez por organização Freshworks**. Ela não se repete para cada analista.

1. **Descubra a URL da organização Freshworks.** Ela tem a forma `https://<org>.myfreshworks.com` (ou `.freshworks.com`). É diferente da URL do Freshservice. Ela aparece no seletor de organização do Freshworks ([artigo 50000002731](https://support.freshworks.com/en/support/solutions/articles/50000002731)).
2. **Crie a credencial OAuth** no Developer Portal dessa organização: **OAuth Credentials → Create**. Preencha **Name** (até 3 palavras) e **Description**. O usuário vê os dois na tela de autorização.
3. **Cadastre o Redirect URL.** Use o endereço exato que o app mostra no passo 6. O padrão é `http://localhost:3000/api/auth/oauth/callback`, ajustando a porta se você mudou o `PORT`. Se o perfil usa `127.0.0.1`, cadastre esse host exato; os dois hosts não compartilham cookies.
4. **Escolha somente escopos de leitura** (padrão `.view`). Escopos são fixados na criação.
5. **Copie o Client ID e o Client Secret.**
6. **Cadastre o perfil no app.** Em **Configurações → Administração da integração → Novo perfil de integração**, preencha:
   - **Nome do perfil** (aparece no status da conexão);
   - **URL da organização no Freshworks**;
   - **Client ID** e **Client secret**;
   - **Domínios do Freshservice** do cliente, por exemplo `acme.freshservice.com`;
   - **Prefixo da autorização**: `/org`; **prefixo do token**: vazio por padrão (`/oauth/v2/token`), independente da autorização;
   - **Host do redirecionamento**: mantenha **`localhost`**, se esse é o endereço cadastrado no provedor;
   - **Escopos de leitura**, já pré-marcados.

   Clique em **Criar perfil**. O segredo vai para o cofre do sistema e não aparece de novo.
7. **Confira o Endereço de redirecionamento** mostrado pelo formulário. Ele precisa ser igual ao cadastrado no passo 3.

> **Host do redirecionamento.** O painel usa `127.0.0.1`, e o perfil pode usar `localhost` (padrão). Cadastre exatamente `http://localhost:<PORTA>/api/auth/oauth/callback`, com a porta do app. A conexão cria o cookie no host correto e volta automaticamente ao painel. O exemplo `localhost:10001/auth/callback` da documentação do FDK não é a rota deste app. O funcionamento local é validado com simulador; não há homologação Freshservice real.

> **Aviso sobre escopos `.manage`.** Marque **"Permitir escopos de gestão ou escrita"** só se for necessário para Agentes, Grupos, formulário de tickets ou itens do catálogo, e com autorização do cliente. Esses escopos podem permitir escrita no Freshservice.

### Passo 4 — Conectar a sua conta (uso diário do analista)

1. Na **Visão geral**, no cartão **Conexão com o Freshservice**, preencha **Link do Freshservice do cliente** com o endereço da instância. Exemplo: `https://suaempresa.freshservice.com`.
2. Clique em **Conectar conta autenticada**.
3. Se aparecer **"Configuração administrativa ausente"**, o responsável ainda não cadastrou o perfil deste cliente. Não tente outro caminho: avise o responsável pelo Passo 3.
4. Uma **nova aba** abre com a tela de autorização do Freshworks. Entre com a **sua conta** e aprove o acesso, se pedido. Se o navegador bloquear a aba, clique em **"use este link"**.
5. Volte à ferramenta. O status muda para **Conectado** sem recarregar a página.

Se ficar 10 minutos sem concluir a autorização, a ferramenta para de aguardar. Clique em **Conectar conta autenticada** de novo.

O endereço da instância precisa ser `https://` e terminar em `.freshservice.com`. Endereços com IP, `localhost`, porta ou usuário e senha são recusados.

#### Opção avançada: chave de API

Use **somente** se não for possível registrar o aplicativo OAuth. Não é o caminho recomendado.

1. Em **Configurações → Instância Freshservice**, salve a URL. Isso não exige OAuth nem abre login. Depois abra **"Opção técnica avançada: API key"** (fica recolhida por padrão).
2. Escolha **Usuário de integração** (recomendado) ou **API key pessoal**.
3. Cole a chave em **Chave de API** e clique em **Salvar chave**.
4. A ferramenta faz uma leitura de teste. Se a chave for aceita, ela é guardada e não é exibida de novo. Chave rejeitada não é gravada.

A chave de API não precisa de perfil de integração e não passa pelo controle de escopos OAuth. Ela age com os poderes do dono da chave.

#### Estados da conexão

O selo **Status** no cartão de conexão mostra:

| Estado | Significado | O que fazer |
|---|---|---|
| Desconectado | Nenhuma conexão | Siga o Passo 4 |
| Configuração administrativa ausente | Não há perfil de integração para este cliente | Avise o responsável (Passo 3) |
| Aguardando autorização | A aba do Freshworks foi aberta e aguarda sua autorização | Conclua na outra aba |
| Autorização negada | Você negou ou cancelou a autorização | Conecte de novo e aprove o acesso |
| Conectado | Pronto para coletar | Siga para o Passo 5 |
| Escopo insuficiente | O perfil não tem escopo de leitura suficiente para a verificação | Avise o responsável |
| Sessão expirada | O login venceu ou foi recusado | Clique em **Conectar conta autenticada** de novo |
| Sem permissão | A conta não pode ler o recurso de verificação | Peça permissão ou use outra conta |
| Erro de conexão | Rede, limite de requisições ou instabilidade | Tente de novo mais tarde. Os tokens locais são mantidos |
| Aguardando autenticação | Só com chave de API: a chave foi rejeitada | Revise a chave |
| Demonstração | Modo demonstrativo ativo | Saia da demonstração para usar dados reais |

### Passo 5 — Testar a conexão

1. No cartão de conexão, clique em **Testar conexão**. A ferramenta faz uma leitura simples e atualiza o status.
2. No cartão **Sincronização e mapeamento**, clique em **Diagnosticar acesso**. A ferramenta faz **uma consulta pequena por módulo** (um item só) para saber o que sua conta consegue ler.
3. Veja o resultado no painel **Status dos endpoints**, em **Configurações** e nas páginas de cada módulo:

| Situação | Significado |
|---|---|
| Acessível | Sua conta lê este módulo |
| Sem permissão | A conta não tem permissão para este módulo |
| Escopo não autorizado | O perfil de integração não concede o escopo deste módulo. Nenhuma consulta foi feita |
| Não encontrado | O módulo não existe ou não está habilitado na instância (pode depender do plano) |
| Temporariamente indisponível | Erro de rede, limite de requisições ou instabilidade |
| Não testado | Ainda não testado. Módulos que dependem de outro são testados na coleta |
| Não suportado | A ferramenta não consulta este módulo por política |

### Passo 6 — Primeiro mapeamento

1. Opcional: em **Configurações → Preferências de coleta**, marque os módulos desejados, ajuste **Somente metadados** e clique em **Salvar preferências**.
2. Na **Visão geral**, clique em **Mapear tudo**.
3. Acompanhe a mensagem "Mapeamento em andamento", com o módulo atual e a quantidade de registros. Para interromper, clique em **Cancelar**.
4. Ao terminar, os indicadores mostram **Último mapeamento**, **Itens coletados**, **Mudanças detectadas** e **Módulos acessíveis**.
5. Consulte o inventário pelo menu: **Catálogo de serviços**, **Base de conhecimento**, **Tickets**, **Usuários e grupos**, **Ativos / CMDB** e **Configurações**. Clique num item para ver o detalhe, as versões e os relacionamentos.
6. Módulos que falharam aparecem no **Histórico de sincronizações**. Na página da coleta, use **Repetir módulos com falha** para tentar só esses módulos de novo.

Uma coleta pode terminar como **concluída**, **parcial** (alguns módulos falharam ou foram bloqueados por escopo), **falhou** (nenhum módulo concluiu) ou **cancelada**.

### Passo 7 — Nova sincronização

1. Mais tarde, clique em **Sincronizar novamente**. Esse botão exige uma coleta anterior concluída. **Mapear tudo** também funciona.
2. Ao terminar, a ferramenta compara automaticamente com a coleta anterior.
3. Veja o resumo em **Mudanças detectadas** e os detalhes em **Diferenças detectadas**.

Se você trocar o tipo de conexão entre duas coletas (por exemplo, de chave de API para OAuth), a ferramenta não afirma remoções nessa comparação, porque o alcance de cada conta pode ser diferente.

### Passo 8 — Interpretar diferenças

Exemplos fictícios:

**Nome alterado**

| | ID | Nome |
|---|---|---|
| Antes | 32 | Instalação de software |
| Depois | 32 | Instalação de Software homologado |

Resultado: **Nome alterado**. O ID é o mesmo, então é o mesmo item com outro nome.

**Possível troca de ID**

| | ID | Nome |
|---|---|---|
| Antes | 32 | Instalação de software |
| Depois | 25 | Instalação de software |

Resultado: **ID alterado** (possível substituição de item, **sujeita a confirmação**).

O item 32 sumiu e o 25 apareceu com o mesmo nome e conteúdo parecido. A ferramenta calcula uma pontuação de semelhança (nome, categoria, descrição, campos, vínculos e workspace). Ela não decide sozinha: abra a diferença e clique em **Confirmar** ou **Rejeitar**. Se houver mais de um candidato, escolha em **Troca de ID a confirmar**. A decisão fica só no seu computador.

**Outros resultados:**

| Rótulo na tela | Quando aparece |
|---|---|
| Novo item | O item existe na coleta nova e não existia na anterior |
| Removido ou não encontrado | O item não apareceu, e as duas coletas do módulo foram completas |
| Não observado | O item não apareceu, mas uma das coletas foi incompleta. **Não significa remoção** |
| Campos alterados | Algum campo mudou. Exemplos em formulários: campo adicionado ou removido, campo renomeado, campo que passou a ser obrigatório, opção nova ou retirada de uma lista |

Cada diferença tem severidade **Alta**, **Média** ou **Baixa**. Mudanças em obrigatoriedade e em opções de formulário são médias. Remoções e trocas de ID são altas.

### Passo 9 — Consultar histórico

1. Abra **Histórico de sincronizações** para ver as coletas, da mais recente para a mais antiga, com status, quantidades e falhas.
2. Clique numa coleta para ver o resultado por módulo.
3. Para comparar duas coletas quaisquer, escolha **Execução base** e **Execução comparada** e clique em **Comparar**. São necessárias ao menos duas coletas da mesma instância. Essa comparação não grava nada.
4. No detalhe de um recurso, veja as **versões anteriores** e a linhagem de IDs.
5. Em **Diferenças detectadas**, filtre por módulo, tipo, severidade, situação de revisão e período. Clique numa diferença para ver os campos alterados.
6. Em **Logs de sincronização**, veja os eventos da aplicação. Segredos já são removidos antes de gravar.

### Passo 10 — Desconectar e proteger as informações

1. No cartão de conexão, clique em **Desconectar** e confirme. A ferramenta apaga do cofre a chave ou os tokens. O histórico continua no banco.
2. **Com OAuth, revogue também no Freshworks:** a desconexão não cancela a autorização no servidor, porque o Freshworks não documenta essa operação. Remova o acesso do aplicativo no painel do Freshworks, se necessário.
3. Os arquivos ficam na pasta de dados (seção 4.1), que aparece em **Configurações → Dados locais**.
4. Para apagar tudo de forma definitiva: pare o aplicativo e apague a pasta de dados. Antes, desconecte para limpar o cofre do sistema.

**Cuidados com backups e compartilhamento:**

- Não envie o `fslm.db`, a pasta `backups/` ou capturas de tela com dados reais por e-mail, chat ou nuvem.
- Não copie a pasta de dados para dentro do projeto nem a publique no GitHub. Os arquivos `.db` já são ignorados pelo Git, mas uma cópia com outro nome pode escapar.
- Não use dados reais de clientes em testes, demonstrações ou ferramentas de IA. Use o modo demonstrativo.
- Mantenha o computador com senha, bloqueio de tela e criptografia de disco.

---

## 8. Garantias de segurança verificadas

| Verificação | Resultado |
|---|---|
| Banco fora da pasta pública do aplicativo | Confirmado. A pasta pública é recusada |
| Dados de instâncias diferentes isolados | Confirmado: cada registro pertence a uma instância, com conexão e credencial próprias. As listas mostram só a instância ativa. As páginas de detalhe abertas por link direto podem mostrar um item de outra instância cadastrada, sempre com o nome dela visível |
| Nenhum dado enviado a terceiros desnecessários | Confirmado. Só Freshservice, Freshworks (login) e as fontes de instalação |
| Credenciais fora do banco e sem texto puro | Confirmado, salvo `FSLM_SECRET_KEY` se você mesmo a gravar num arquivo |
| Logs sem segredos | Confirmado, com limpeza automática e testes |
| Demonstração separada dos dados reais | Confirmado |
| Arquivos de dados fora do Git | Confirmado pelo `.gitignore` |
| Histórico Git sem informação sensível | O repositório ainda não tem commits. Nenhum dado de cliente foi encontrado nos arquivos |

---

## 9. Dúvidas frequentes

**A ferramenta pode apagar algo no meu Freshservice?**
Não. Pela auditoria do código, ela só faz consultas de leitura. Os botões de revisão gravam só no seu computador.

**Preciso informar a minha senha do Freshworks na ferramenta?**
Não. O login acontece na página do próprio Freshworks, numa aba do navegador. A ferramenta recebe só a autorização, na forma de tokens, que ficam no cofre do sistema.

**Por que aparece "Configuração administrativa ausente"?**
Não existe perfil de integração cadastrado para a organização deste cliente. Peça ao responsável que faça o Passo 3. Você não precisa configurar nada.

**Por que o botão não abre a autorização?**
Confira se você está usando `http://127.0.0.1:PORTA` (não `localhost`), e se o perfil do cliente tem o host de redirecionamento `127.0.0.1`. Veja o aviso do Passo 3.

**Por que um módulo aparece como "Sem permissão"?**
A conta conectada não tem acesso a ele. O resto da coleta continua.

**Por que um módulo aparece como "Escopo não autorizado"?**
O perfil de integração não concede o escopo de leitura desse módulo. Ele não foi consultado. O responsável pode revisar os escopos do perfil. Os módulos que exigem escopo de gestão só são liberados com a opção "Permitir escopos de gestão ou escrita", com autorização do cliente.

**Por que o item aparece como "Não observado" e não como removido?**
Porque uma das coletas daquele módulo ficou incompleta. A ferramenta não afirma remoção sem certeza.

**Posso usar em mais de uma instância?**
Sim. Informe outro link e conecte. Cada instância tem credencial e dados próprios. Cada organização Freshworks precisa do seu próprio perfil de integração. As telas mostram a instância ativa.

**O que acontece se eu perder o computador?**
O banco não é criptografado pela ferramenta. Proteja o disco com LUKS ou BitLocker e revogue a chave de API ou o aplicativo OAuth no Freshservice e no Freshworks.

**Beta:** integração Freshservice real e Windows 11 não homologados. Para apresentar sem contas reais, use [DEMONSTRACAO-SIMULADOR.md](DEMONSTRACAO-SIMULADOR.md). Domínios customizados são recusados: use o domínio original *.freshservice.com.
