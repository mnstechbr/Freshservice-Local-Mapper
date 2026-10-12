# Validação da v0.1.0-beta

Atualizado em 2026-10-12. As evidências usam Fedora 44, Node 24.18.0, pnpm 10.34.0 e fixtures inteiramente sintéticas. **Nenhuma conta, credencial, instância ou dado real Freshservice foi usado. Integração real e Windows 11 NÃO HOMOLOGADOS.**

## 1. Resultados

| Verificação | Resultado |
|---|---|
| Unitários finais | 73 arquivos, 906 passaram / 3 pesados pulados e executados à parte |
| Instalação real e idempotência Fedora (QA_HEAVY) | 13/13 cenários passaram em uma rodada integral, incluindo C4, C4b e C6 |
| Autenticação e segurança | 24 arquivos, 350 testes passaram |
| Read-Only, sync, módulos e sanitização | 15 arquivos, 137 testes passaram |
| Typecheck | Passou |
| Build de produção local | Passou nas execuções do simulador e produção local |
| E2E simulador OAuth/API | 15/15 passaram |
| E2E produção local (sem simulador) | 25/25 passaram |
| E2E desenvolvimento | 25/25 passaram |
| Auditoria dependências de produção | Zero vulnerabilidades reportadas pelo registro nesta rodada |
| Auditoria todas as dependências | Um aviso moderado: esbuild 0.18.20 transitivo de drizzle-kit, ferramenta de desenvolvimento |

Resultados anteriores à estabilização: F4 800 unitários/3 pulados, 14 simulador e 25 produção. Esses números não são evidência da beta atual.

## 2. Reproduzir

```bash
pnpm install --frozen-lockfile
pnpm test
QA_HEAVY=1 pnpm exec vitest run tests/bootstrap/cenarios.test.ts
pnpm exec vitest run tests/auth tests/security
pnpm exec vitest run tests/sync tests/modules tests/simulator/api.test.ts tests/security/read-only-transport.test.ts tests/security/location-vendor-contact.test.ts tests/security/person-contact.test.ts
pnpm typecheck
pnpm build
pnpm test:e2e:sim
pnpm test:e2e
pnpm test:e2e:dev
```

Execute os E2E em sequência: compartilham a pasta de build, mas cada rodada tem SQLite isolado e novo em .e2e-data. A flag do simulador é definida explicitamente por modo. Navegação fora de loopback faz o teste falhar. Os cenários pesados usam clones descartáveis próprios, não o banco do usuário.

Reinício offline: depois da rodada do simulador, `node scripts/verify-offline.mjs <diretorio-da-rodada-em-.e2e-data>` inicia outro processo de produção, abre o SQLite sintético em leitura para validar versões e confirma consulta desconectada. Não aceita a pasta padrão de dados nem instância real.

## 3. OAuth e segurança

State forjado, ausente, expirado, reutilizado e callback diferente são recusados. HMAC vincula callback exato, perfil e instância; ticket de passagem de 60s é consumido atomicamente; state tem cookie HttpOnly/Lax host-only. Localhost e 127.0.0.1 não compartilham cookies/origem: a autenticação inicia no host do perfil, e documento de conclusão retorna ao dashboard canônico. CSRF, Host, Origin, Sec-Fetch-Site, CSP e redirects restritos permanecem.

Com perfil configurado, o dashboard passa automaticamente a Conectado. Sem perfil, informa configuração administrativa ausente sem popup. Renovação aceita continua conectada; 401 antecipado no teste de conexão permite uma única renovação e um GET com o token novo. Chamadas concorrentes compartilham refresh, e desconexão durante a renovação não reabre a sessão. Recusa definitiva apaga tokens; rede/429/5xx mantêm segredos. Desconexão remove tokens locais, preserva histórico e não revoga autorização remota.

## 4. Read-Only e diferenças

A guarda runtime bloqueia POST/PUT/PATCH/DELETE em recursos antes de DNS/fetch. Só POST nos caminhos exatos de token, host Freshworks validado, sem query/fragmento. Testes registram métodos GET em diagnóstico/coleta; escritas do controle de fixtures e SQLite são locais.

Unitários exercitam renomeação, item criado/removido, campos/formulários, categorias/relações, possíveis substituições de ID, confirmação/rejeição local, comparação não consecutiva, ordem/voláteis, falha/paginação parcial e cancelamento sem falsas remoções. O E2E prova duas coletas, detalhes dos 23 módulos, versões/observações antigas intactas, histórico e consulta offline. Heurísticas ainda não calibradas com dados reais.

## 5. Fedora e Windows

Fedora: setup.sh --check passou, instalação com rede, migrations/backup, reinício/idempotência, SQLite e servidor local foram executados. XDG/permissões e indisponibilidade do cofre estão nos testes. Presença de secret-tool não comprova cofre Secret Service real funcionando.

O [CI final aprovado](https://github.com/mnstechbr/Freshservice-Local-Mapper/actions/runs/38267542875) passou no commit 24d1ae4. Fedora: bootstrap, 906 unitários/3 pesados pulados, typecheck e build. Windows Server 2025: bootstrap, DPAPI real com segredo fictício Unicode, 893 unitários/3 POSIX pulados, typecheck e build; cenários de bootstrap POSIX rodam em Fedora. Navegador Ubuntu: 25 produção, 15 simulador, 25 dev. Nenhum resultado de Server equivale a Windows 11. Winget/UAC, navegador/encerramento e ciclo completo do cofre/aplicativo em Windows 11 ainda exigem validação autorizada.

## 6. Publicação

Remoto confirmado: https://github.com/mnstechbr/Freshservice-Local-Mapper. Titular confirmou a propriedade e autorizou publicação. Prompts, configuração privada, imagem de referência e relatórios internos ficam ignorados e preservados no computador. Scanner verifica índice e histórico por nome e conteúdo/magic; imagens precisam de revisão humana vinculada ao digest. Não publica bancos, backups, .env, credenciais nem traces. Branch main publicada sem forcepush; release v0.1.0-beta é prerelease. CI valida o commit de código; a atualização posterior é apenas documentação.

## 7. Pendências e riscos aceitos

- Freshworks/Freshservice reais: registro OAuth, callback, refresh, escopos por edição/plano, contratos de endpoints, links e calibração do diff. Nenhuma homologação nesta beta.
- Windows 11 e cofres reais: validação manual ainda necessária.
- SQLite/backups não cifrados; usar proteção do usuário e disco protegido (LUKS/BitLocker). Não houve migração criptográfica nem limpeza histórica.
- Sanitização por nome não analisa texto livre; nomes/assuntos/custom_fields permanecem. Históricos antigos podem conter contatos e aparecer em diferenças.
- Rotas administrativas têm proteção de origem/Host, sem identidade/login local; usuário/programa local continua sendo limite de confiança.
- DNS validado antes do fetch, resolução posterior ainda permite risco residual de rebinding; CSP tem unsafe-inline por Next/React, cookie local HTTP sem Secure.
- Refresh compartilhado só dentro do processo, por banco/conexão, no resolvedor OAuth; evitar múltiplos processos simultâneos no mesmo banco.
- pnpm hash via Corepack; fallback npm exec e pnpm existente dependem da confiança local/registro. Imagem Fedora fixada por versão, com tag mutável.
- Aviso esbuild em ferramenta de desenvolvimento: não expor servidores de desenvolvimento/studio à rede. Não alterado por override transitivo nesta beta.
- Testes unitários simulados não são validação visual pixel a pixel. Capturas públicas usam somente demonstração fictícia.

Detalhes e classificação A-01–A-15 em [RELATORIO-FINAL-CODEX.md](RELATORIO-FINAL-CODEX.md); apresentação em [DEMONSTRACAO-SIMULADOR.md](DEMONSTRACAO-SIMULADOR.md).
