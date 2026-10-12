# Relatório final — Freshservice Local Mapper v0.1.0-beta

Data: 2026-10-12. Estabilização sobre a implementação existente, sem reconstrução. **Freshservice/Freshworks reais e Windows 11 NÃO HOMOLOGADOS.** Nenhuma conta criada, credencial real solicitada ou dado corporativo usado. Bancos/backups preexistentes preservados.

## Estado inicial

F4 já concluída, com passagem assinada, callback localhost e retorno ao dashboard 127.0.0.1. Foram preservados migrações 0004/0005, state de uso único, cookie host-only, guardas de origem/Host, refresh, perfis administrativos e o simulador existente. A árvore não tinha commits/remoto; todos os arquivos eram não rastreados, portanto git diff não oferecia uma base atribuível a autores anteriores.

O endereço do remoto foi fornecido pelo titular após conferir a configuração vazia: [mnstechbr/Freshservice-Local-Mapper](https://github.com/mnstechbr/Freshservice-Local-Mapper). Git e API GitHub confirmaram repositório público vazio, sem branches/tags, com permissão de publicação. O titular confirmou que o código lhe pertence e autorizou commits/push. Material interno e imagem de referência não entram na distribuição. Licença MIT.

## Achados A-01 a A-15

| Achado | Estado | Evidência / decisão |
|---|---|---|
| A-01 contatos Locais/Fornecedores | Corrigido e validado | Exclusões permanentes recursivas em normalized/raw; testes de persistência sintética. Não apaga histórico. |
| A-02 privilégios OAuth | Corrigido e validado | Padrões somente .view e verificação de metadados já existentes preservados. Consentimento agora também exige .edit e todo escopo fora de .view; testes criação/update. API key continua herdando papel do agente. |
| A-03 URL da organização | Corrigido e validado | Formulário distingue URL Freshworks e domínios Freshservice; E2E administrativo passa. |
| A-04 transporte Read-Only | Corrigido e validado | Guarda runtime anterior a DNS/fetch, métodos inválidos e mutação durante DNS recusados. POST exclusivamente token Freshworks exato. |
| A-05 minimização | Aceito com justificativa após correção parcial validada | ITSM somente metadados por padrão; assinatura/background_information omitidos em pessoas nesse modo. Nomes, assuntos e custom_fields conservados para inventário/diff. Não houve allowlist ampla que descartasse campos essenciais; texto livre/novos campos permanecem riscos. |
| A-06 SQLite/backups sem cifra | Aceito com justificativa | Não migrar/reescrever banco automaticamente; permissões locais e recomendação LUKS/BitLocker. Segredos ficam no cofre separado. |
| A-07 executáveis Windows | Corrigido e validado; Server parcial | PowerShell/rundll32/taskkill/url.dll em SystemRoot\System32; raiz inválida recusada. Bootstrap e DPAPI passaram no CI Windows Server 2025; Windows 11 não homologado. |
| A-08 chave do cofre | Corrigido e validado | Hints/testes/guias orientam ambiente e cópia externa protegida; chave não vai no .env do projeto. Next herda ambiente (risco documentado). |
| A-09 detalhes entre instâncias | Corrigido e validado | Queries exigem instância ativa, detalhes/relações/matches delimitados; outra instância/null vira 404. Testes preservam versões ao trocar seleção. |
| A-10 material privado | Corrigido e validado | Prompts/.claude/relatórios internos/referência ignorados; auditoria do índice e histórico por bytes, nomes e padrões, mais revisão humana das imagens. |
| A-11 refresh/desconexão | Corrigido e validado localmente | Renovação definitiva/transitória e revogação local cobertas; consentimento remoto não é revogado automaticamente. Provedor real pendente. |
| A-12 promessa de escrita futura | Corrigido e validado | Texto do dashboard alterado para somente leitura; capturas atualizadas. |
| A-13 dependências/CI | Corrigido e validado, limites aceitos | Dependências diretas exatas, lockfile frozen, Actions SHA, Node fixado; pnpm 10.34+hashSHA512 e parser compatível. Fallback npm exec não confere hash Corepack; pnpm PATH depende da confiança local; Fedora 44 tem tag mutável. |
| A-14 domínio customizado | Corrigido e validado | Cadastro/coleta/diagnóstico recusam; instrução para domínio original. Registros legados intactos. SSRF preservado. |
| A-15 salvar URL sem OAuth | Corrigido e validado | Configurações → Instância Freshservice → Salvar instância; sem perfil/popup. API key independente exercitada no navegador. |

## Implementação e revisão

Alterações concentradas em profiles.ts/formulário, instance-form/Configurações, transporte HTTP, instances, adaptadores settings/users-groups, prefs e queries de resources/changes. Bootstrap/cofre DPAPI usam caminhos absolutos. Sem alteração de arquitetura, SQLCipher, schema, módulos novos ou serviço externo.

Revisão manual do runtime confirmou a guarda antes da resolução/transporte, clonagem do método antes de await, sanitização compartilhada entre normalized/raw e isolamento nas consultas. Resultado de agentes não foi tratado como suficiente: root revisou código e executou suítes e fluxos integrados. O aviso .edit e a falta de URL independente foram confirmados e corrigidos.

T2 anterior: scopeKeyFor de filhos de ticket usava chave diferente do mapa oficial; corrigido com placeholder {id} e teste que recusa conversas sem seu escopo. Conversas/atividades continuam não coletadas. T3 refresh entre processos fica limitado/documentado; T4 execução parcial por módulos negados é comportamento intencional (não afirmar inventário completo). T5 build/dev entram na rodada final. T8 rascunhos manuais históricos não são distribuídos; regressões atuais automatizadas e reinício offline substituem aquelas asserções desatualizadas. T9 regressão de recarga permanece nos E2E. Não foi feita comparação visual pixel a pixel nem homologação de cofre real.

## Simulador e fluxos

Simulador existente em processo, com estado global em memória por processo, flag explícita FSLM_SIMULATOR=1 e hosts reservados .invalid. Sem DNS/socket para hosts fictícios. Produção normal responde 404 às rotas de controle e não mostra faixa. Build de produção local com flag é usado intencionalmente para testar caminhos de produção; não é ambiente real.

OAuth fictício: sessão/login/MFA/consentimento, código/token opaco, state/callback, expiração, refresh aceito/revogado, escopos/papel, negação e rede interrompida. API key Basic fictícia mantém papel de identidade. Controle local modifica fixtures, não recursos Freshservice.

E2E cobre URL sem perfil, configuração administrativa, localhost callback com dashboard 127, cookie separado/removido, status Conectado sem recarga, teste/diagnóstico, inventário, segundo estado/diferenças e desconexão. Novo cenário coleta 23 módulos/174 registros,120 tickets 2 páginas, abre 23 detalhes/relacionamentos e prova duas versões/observações intactas no SQLite, histórico e consulta offline. Processo separado de reinício mantém 175 versões da instância, desconectada e sem segredo local.

Motor de diferenças: unitários confirmam renomeação, criação/remoção, categoria/campos/formulários/opções/obrigatoriedade/descrição/relações, ordem e campos voláteis sem falsos positivos, possível troca de ID sugerida e revisão local, comparação não consecutiva e isolamento de instâncias. Falhas, coletas parciais, paginação incompleta e cancelamentos não geram remoção falsa. Pesos/limiares ainda requerem calibração real.

## Validações

- Unitários finais:73 arquivos,896 aprovados/3 pesados pulados. A rodada QA_HEAVY integral passou 13/13, incluindo os 3 pulados na suíte normal; total 899 casos únicos exercitados.
- Autenticação/segurança:24 arquivos,341/341.
- Read-Only/sync/módulos/sanitização:15 arquivos,137/137.
- Publicação:21 testes específicos dentro dos unitários finais.
- Typecheck passou. Build final de produção passou, além dos builds nos E2E.
- E2E simulador:15/15; reinício offline:1/1,175 versões preservadas.
- Produção local: 25/25 passaram. Desenvolvimento: 25/25 passaram.
- [CI final aprovado](https://github.com/mnstechbr/Freshservice-Local-Mapper/actions/runs/38238370583) no commit 7b7a68d: Fedora 896/3 pulados; Windows Server 883/3 POSIX pulados (arquivo de cenários POSIX excluído); bootstrap, typecheck e build nos dois. DPAPI real gravou/leu Unicode/removeu segredo fictício. Navegador Ubuntu: 25 produção, 15 simulador e 25 dev.
- setup.sh --check passou; instalação limpa com pnpm atualizado, SQLite/migrations/backup, idempotência, detecção de processo e início/encerramento cobertos em Fedora.

Falhas intermediárias resolvidas: EPERM na captura de subprocessos dentro do sandbox (repetição permitida passou), expectativa antiga pnpm 10.18 no teste C4 (atualizada), asserção que confundia preflight GET com iniciar OAuth (agora bloqueia launch/start/callback), comentário ts-expect-error sem erro correspondente (removido). Um teste dev também usava Origin da porta de produção (3110 em vez de 3111); passou usando a origem real da página, mantendo CSRF. No CI, root no contêiner causava semântica de permissões inadequada e ownership Git; corrigido rodando bootstrap/testes como usuário sem privilégios dono do checkout. E2E agora gera chave AES-GCM efêmera e isola D-Bus, em vez de herdar a chave local. DPAPI falhou em SecureString; import explícito do módulo Security do PowerShell do sistema resolveu o runner real, evitando a busca herdada por PSModulePath. Entrada usa $input/Text/base64, erros são marcadores fechados e os limites/cifra foram preservados. A incompatibilidade de herança é descrita pela [Microsoft](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath?view=powershell-7.6). Verificador offline passou após esperar a renderização via asserções Playwright. Nenhuma proteção foi relaxada para passar.

Auditoria do registro: 0 vulnerabilidades de produção; 1 moderada em esbuild 0.18.20 transitivo de drizzle-kit (desenvolvimento). Não executamos studio exposto; override transitivo sem validar compatibilidade foi evitado. pnpm atualizado pelo [advisory oficial GHSA-54hh-g5mx-jqcp](https://github.com/pnpm/pnpm/security/advisories/GHSA-54hh-g5mx-jqcp). Há avisos não fatais de tracing process.cwd no Next e carregamento de config Vitest; não impedem teste/build.

## Benchmark sintético

Rodada local do E2E 04, Fedora 44/Node 24.18: diagnóstico 597 ms; primeiro mapeamento 1252 ms (motor 149 ms); segunda sincronização 1252 ms (motor 145 ms). Cada execução 174 registros/23 módulos/30 páginas coletadas. Tempo inclui UI/polling, não é latência garantida. pages_fetched conta páginas de leitura, não todas as requisições HTTP. Houve alteração proposital de nome, duas versões preservadas. Não medimos latência isolada da consulta de diff ou quantidade total de requisições. JSON de apoio é gerado em test-results (não publicado). Não comprova economia financeira, cycle time ou NPS.

## Plataformas e riscos restantes

Fedora validado localmente como acima. Secret Service instalado, mas teste real de chaveiro desbloqueado/bloqueado não foi feito. Windows 11 não disponível; runner Windows Server é evidência parcial. DPAPI passou em smoke real no Server; winget/UAC, encerramento/navegador e ciclo completo do aplicativo/cofre ainda precisam de validação manual em Windows 11. Secret Service/Keychain reais continuam pendentes. macOS não é sistema-alvo.

SQLite/backups não cifrados e históricos antigos não limpos. Primeira coleta com nova sanitização pode produzir diff mostrando contato anterior. Campos por nome não detectam PII em texto livre. Rotas administrativas sem identidade local, HTTPloopback cookie sem Secure, CSP unsafe-inline e DNSrebinding residual ficam documentados em AUTH/VALIDACAO. Sem lock de refresh entre processos; não rodar dois servidores no mesmo banco. Domínios customizados não suportados. Nenhum teste real/corporativo foi feito.

## Publicação

Branch main, versão 0.1.0-beta. Código publicado no repositório existente após validações locais e auditoria do índice/histórico. Commits: d942067 (estabilização), a395769 (isolamento CI), cddeda7 (erros DPAPI redigidos), ef61c3b (entrada PowerShell), 7b7a68d (módulo Security/espera offline). O [CI final](https://github.com/mnstechbr/Freshservice-Local-Mapper/actions/runs/38238370583) passou nesse último commit; atualização documental posterior não modifica runtime. Release v0.1.0-beta é prerelease, com limitações explícitas e sem assets de dados locais. Sem forcepush nem sobrescrita de histórico. Imagens distribuídas são capturas sintéticas de demonstração, revisadas visualmente por digest. Nenhum banco/backup/log/trace/.env real publicado.

[Guia de demonstração integral](DEMONSTRACAO-SIMULADOR.md) reproduz duas coletas e reinício offline. A experiência do analista está pronta para demonstração com simulador. Uso contra serviço real permanece não homologado.
