# Compatibilidade Fedora/Windows 11 e bootstrap automático

Data: 2026-10-11. Versão: 0.1.0.

Resumo: **Fedora Linux 44 validado de verdade**, na máquina de desenvolvimento e em contêiner Fedora limpo. **Windows 11 não foi executado**: o código para Windows está implementado e coberto por testes com plataforma simulada, a sintaxe do `setup.ps1` foi validada em PowerShell 7, e há um workflow de CI pronto para rodar em runner Windows. O workflow ainda não rodou, porque não houve push. Não declaramos compatibilidade efetiva com o Windows 11 até essa execução.

## 1. Implementações

| Área | Arquivo | O que faz |
|---|---|---|
| Bootstrap | `scripts/start-dev.mjs` | Orquestra `npm run dev`, `pnpm dev` e `npm run bootstrap` (`--prepare-only`). Substitui o antigo `scripts/dev.mjs`. |
| Núcleo do bootstrap | `scripts/lib/bootstrap-core.mjs` | Funções puras que só usam `node:*`, porque rodam antes de existir `node_modules`: versão do Node, gerenciador, estado das dependências, plano de instalação, consentimento, conectividade, varredura de migrations destrutivas, trava, backups. |
| Guarda do gerenciador | `scripts/check-package-manager.mjs` (`preinstall`) | Recusa `npm install` e `yarn install` direto, com mensagem em PT-BR. `FSLM_ALLOW_NPM_INSTALL=1` libera. |
| Pré-requisitos Fedora | `scripts/setup.sh` | Usa `dnf`: `nodejs24` + `nodejs24-npm` (fallback `nodejs22`), `libsecret` (opcional), compilador (`--build-tools`). Opções `--check`, `--yes`, `--build-tools`, `--help`. |
| Pré-requisitos Windows | `scripts/setup.ps1` (UTF-8 com BOM) | Usa `winget`: `OpenJS.NodeJS.LTS` e Build Tools (`-BuildTools`). Opções `-CheckOnly`, `-Yes`. Compatível com PowerShell 5.1 e 7. |
| Diretório de dados | `src/lib/config/paths.ts` | No Windows, `%LOCALAPPDATA%\FreshserviceLocalMapper`. Recusa caminhos UNC e de rede. No Linux, sem mudança. |
| Cofre | `src/lib/secrets/probe.ts`, `vault.ts`, `windows-dpapi.ts` | Sonda de cofres sem `server-only`, usada pelo bootstrap e pelo diagnóstico. No DPAPI, o transporte agora é base64 com `-EncodedCommand`, imune à codepage do console (CP850). |
| Diagnóstico | `src/lib/environment/*`, `GET /api/environment`, página `/ambiente` ("Ambiente local") | Mostra sistema, Node, dependências, SQLite, migrations, cofre, diretório de dados, último bootstrap, problemas e como resolver. |
| Repositório | `.gitignore`, `.gitattributes`, `.github/workflows/ci.yml` | Proteção de dados locais, fim de linha LF (CRLF no `.ps1`), CI Windows e Fedora. |

### Etapas do bootstrap

1. Sistema operacional.
2. Node.js com versão mínima 22.12.
3. Gerenciador de pacotes. Informa quem chamou e avisa se houver `package-lock.json` ou `yarn.lock`.
4. Dependências. Compara `node_modules/.pnpm/lock.yaml` com `pnpm-lock.yaml`, byte a byte. Se faltar ou divergir, pede consentimento, testa DNS do registro e roda `pnpm install --frozen-lockfile`.
5. Carga do módulo nativo `better-sqlite3`.
6. Diretório de dados.
7. Trava `dev-server.lock`. Se o app já estiver rodando, só abre o navegador e sai com código 0.
8. Banco: integridade, backup antes de migrations pendentes e bloqueio de migration destrutiva não revisada.
9. Cofre. Gera aviso, não bloqueia.
10. Porta. Erro claro se estiver ocupada por outro programa. A porta não muda sozinha, porque o redirect do OAuth depende dela.
11. `next dev` em `127.0.0.1`. No Windows, o encerramento usa `taskkill /T`.
12. Navegador. No Linux, só com `DISPLAY` ou `WAYLAND_DISPLAY`.

O resultado vai para `<dados>/bootstrap-status.json` (0600), sem segredos.

### Decisões

- **Lockfile canônico: `pnpm-lock.yaml`.** O bootstrap obtém o pnpm, nesta ordem: `npm_execpath` do pnpm, `pnpm` no PATH, Corepack e, por último, `npm exec --yes pnpm@10.34.0`. A versão vem do campo `packageManager`. O Fedora não traz o Corepack com `nodejs24`, então nele vale o último caminho.
- **`npm install` direto:** o npm só roda o `preinstall` da raiz depois de gravar `package-lock.json` e `node_modules`. O comando falha com a mensagem, o `package-lock.json` fica no `.gitignore`, e o bootstrap seguinte acusa o lockfile em conflito e o `node_modules` "fora do pnpm", pedindo reinstalação. O conflito não fica silencioso. Rejeitamos `.npmrc` com `package-lock=false`: o pnpm lê essa chave como `lockfile=false` e passa a ignorar o `pnpm-lock.yaml`. Verificado.
- **`better-sqlite3` sem compilação:** a versão 13 traz binários prontos em `prebuilds/` (`linux-x64`, `linuxmusl-x64`, `linux-arm64`, `win32-x64`, `win32-arm64`, `darwin-*`) e declara `"gypfile": false`. Antes, com `better-sqlite3` em `pnpm.onlyBuiltDependencies`, o pnpm rodava `node-gyp rebuild` e a instalação **falhava em Fedora limpo sem Python**. Agora o pacote está em `ignoredBuiltDependencies` e só `esbuild` roda script de build. Nenhum compilador é necessário em x64.
- **Migrations:** banco novo aplica todas. Em banco existente com migrations pendentes, o bootstrap faz um backup antes (`backups/fslm-pre-migration-<ts>.db`, mantém os 5 mais recentes). Migration com `DROP`/`DELETE` não revisada é bloqueada até `FSLM_ALLOW_DESTRUCTIVE_MIGRATIONS=1`. Nesse caso, o backup se chama `backups/fslm-<ts>.db` e não entra na rotação. A `0003_demo_legacy_cleanup` (apaga só `is_demo = 1`) está revisada por tag e SHA-256 do SQL normalizado para LF. Qualquer edição invalida a revisão.
- **Permissões:** o diretório de dados recebe `0700` e os arquivos `0600` (POSIX), mesmo se o usuário tiver definido outra permissão no diretório. No Windows vale a ACL do perfil (`%LOCALAPPDATA%`) e, para segredos, o DPAPI.
- **Instalação privilegiada:** os scripts de setup mostram o comando e perguntam antes (padrão "não"). Não usam `curl | bash` nem downloads diretos, só `dnf` e `winget`.

## 2. Dependências obrigatórias

| | Fedora | Windows 11 |
|---|---|---|
| Node.js ≥ 22.12 (recomendado 24 LTS) | `dnf install nodejs24 nodejs24-npm` | `winget install --id OpenJS.NodeJS.LTS --exact` |
| npm | `nodejs24-npm` | vem com o Node |
| pnpm | automático (`npm exec pnpm@10.34.0`) | automático |
| Rede | só na primeira instalação de dependências | idem |
| Cofre (opcional, para salvar credenciais) | `libsecret` (`secret-tool`) e chaveiro desbloqueado, ou `FSLM_SECRET_KEY` | DPAPI via `powershell.exe`, nativo |
| Compilador | não precisa em x64 | não precisa em x64 |

Não usamos PostgreSQL, Docker, Redis nem Python.

## 3. Resultados dos testes

Legenda: **EFETIVO** = executado de verdade no sistema indicado. **CONTÊINER** = Fedora ou Node oficial em podman. **SIMULADO** = teste unitário com plataforma ou programa falso.

### Fedora Linux 44 (host e contêiner `registry.fedoraproject.org/fedora:latest`)

| Cenário | Tipo | Resultado |
|---|---|---|
| Primeira inicialização sem banco | EFETIVO (`cenarios.test.ts` C1) | OK: banco 4/4, `0700`/`0600`, status `ready` |
| Reinicialização com banco existente | EFETIVO (C2) | OK: dados e mtime preservados, 0 migrations aplicadas |
| Migrations pendentes (0003 revisada) | EFETIVO (C3a) | OK: backup `0600`, aplica, dados preservados |
| Migration destrutiva não revisada | EFETIVO em clone com 0003 alterada (C3b) | OK: bloqueia sem a flag; com a flag, um backup e aplica |
| Dependências ausentes, instalação real via `npm exec pnpm` | EFETIVO com rede (C4, `QA_HEAVY=1`) | OK: sem `package-lock.json`; a 2ª execução não reinstala |
| `npm install` direto | EFETIVO com rede (C4b, `QA_HEAVY=1`) | OK: falha com mensagem; o bootstrap acusa o conflito |
| Falha de instalação (dependência inexistente) | EFETIVO (C6, `QA_HEAVY=1`) | OK: mensagem clara, lockfile intacto |
| Node incompatível | CONTÊINER `node:20-alpine` | OK: "Node 20.20.2 não é suportado (mínimo 22.12.0)", código 1 |
| Sem internet | CONTÊINER `node:24 --network=none`; `setup.sh` em Fedora `--network=none` | OK: mensagem clara, nada instalado |
| Cofre indisponível | SIMULADO (`secret-tool` falso, C8) | OK: aviso, o app prepara (código 0) |
| Falha de permissão | EFETIVO, uid 1000 (C10) | OK: EACCES explicado, código 1 |
| Inicialização repetida (3x) e duas instâncias `dev` | EFETIVO (C11a, C11b) | OK: idempotente; a 2ª instância detecta "Já em execução"; SIGTERM libera porta e trava |
| `/api/environment` sem segredos (com `FSLM_SECRET_KEY` definida) | EFETIVO (C11b) | OK |
| **Instalação limpa ponta a ponta** | CONTÊINER Fedora 44 limpo: `setup.sh --yes`, `npm run bootstrap -- --yes`, `npm run dev` | OK: Node 24.18.0, npm 11.16.0, dependências sem compilador, banco criado, `/api/health` 200, `/ambiente` 200, 2ª instância detectada |
| `setup.sh` (check, yes, sem sudo, sem rede, Node antigo, Debian, PTY) | CONTÊINER | OK; shellcheck sem avisos |

Suítes no host Fedora, após as mudanças:

- `pnpm test`: 57 arquivos, 662 testes OK. Os 3 pesados (C4, C4b, C6) foram pulados e rodados à parte com `QA_HEAVY=1`, todos OK.
- `pnpm typecheck`: OK.
- `pnpm build`: OK.
- `pnpm test:e2e`: 24/24.
- `pnpm test:e2e:dev`: 24/24 (agora via `start-dev.mjs`).

### Windows 11

| Cenário | Tipo | Resultado |
|---|---|---|
| Caminho `%LOCALAPPDATA%\FreshserviceLocalMapper`, espaços e acentos, UNC recusado | SIMULADO (`paths.test.ts`) | OK |
| Plano de instalação (`pnpm.cmd` com shell, `npm_execpath`, Corepack) | SIMULADO (`bootstrap-core.test.ts`) | OK |
| DPAPI (base64, `-EncodedCommand`) | SIMULADO (runner falso) | OK |
| `setup.ps1`: parser e PSScriptAnalyzer (alvo 5.1) | PowerShell 7.4 em contêiner Linux | 0 erros de sintaxe e 0 incompatibilidades com 5.1 |
| `setup.ps1`: lógica (winget e rede simulados) | SIMULADO | OK nos 7 cenários |
| Execução real: bootstrap, winget, UAC, DPAPI, `taskkill`, navegador | **NÃO EXECUTADO** | Pendente: rodar `.github/workflows/ci.yml` (job `windows`) ou testar manualmente |

## 4. Limitações conhecidas

- O Windows 11 não foi executado em máquina real nem em runner. O runner `windows-latest` do GitHub é Windows Server, não Windows 11.
- O DPAPI pode ficar indisponível sob Constrained Language Mode (WDAC/AppLocker). Nesse caso, use `FSLM_SECRET_KEY`.
- A primeira instalação exige rede (registro npm). Instalação offline não é suportada.
- `npm install` direto ainda grava `package-lock.json` e `node_modules` antes de falhar. Isso é limite do npm. O conflito é acusado, nunca silencioso.
- Há uma pequena janela de corrida entre duas inicializações exatamente simultâneas. A checagem de porta cobre esse caso.
- No Linux, montagens NFS/SMB não são detectadas como caminho de rede.
- O estado `foreign` (dependências instaladas por npm), em modo não interativo, depende da confirmação do próprio pnpm para limpar `node_modules`. Não testado.
- Fedora anterior ao 44 (pacotes `nodejs`/`npm` sem versão) não foi testado.
- macOS: caminhos cobertos só por testes simulados. Não é sistema-alvo.

## 5. Primeira execução

**Cenário A: Node.js e npm instalados.** Na raiz do projeto, rode `npm run dev` e responda `S` à instalação das dependências. Para não ter a pergunta: `npm run dev -- --yes`.

**Cenário B: sem Node.js ou npm.**

- Fedora: `bash scripts/setup.sh` e depois `npm run dev`.
- Windows 11: `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1`. Depois, num terminal novo se `node` não for encontrado, `npm run dev`.

Diagnóstico a qualquer momento: `http://127.0.0.1:3000/ambiente`.

## 6. Beta e publicação

Resultados acima são históricos (antes da beta). Resultados finais da árvore estabilizada em [VALIDACAO.md](VALIDACAO.md) e [RELATORIO-FINAL-CODEX.md](RELATORIO-FINAL-CODEX.md). O remoto público foi confirmado com o titular; prompts internos, configurações privadas e referência de imagem ficam fora da distribuição.

O CI usa Windows Server 2025, Fedora 44 e Ubuntu 24.04 para o navegador. Windows Server fornece evidência parcial; **Windows 11 continua NÃO HOMOLOGADO**. Os cenários de bootstrap POSIX são executados em Fedora e não no job Windows. DPAPI, winget, UAC, encerramento e navegador devem ser verificados em Windows 11 real.

Executáveis Windows (PowerShell, rundll32, taskkill e url.dll) agora usam SystemRoot\System32, com recusa de raiz inválida e sem fallback para PATH. A validação local dessa mudança usa runners simulados; não prova resistência a um administrador que altere o sistema operacional.

`FSLM_SECRET_KEY` deve vir do ambiente e ser guardada fora do projeto, em local protegido. Ela é herdada pelo Next. O cofre do sistema é preferível quando disponível; cofres reais ainda exigem validação autorizada.

Actions são fixadas por SHA, Node por versão e dependências pelo lockfile. O hash SHA512 do pnpm em packageManager é verificado por Corepack; fallback npm exec e pnpm no PATH têm limites de confiança descritos no README. A imagem Fedora usa versão 44, ainda com tag mutável: congelar digest depende do registro e não transforma o ambiente em homologação Windows.
