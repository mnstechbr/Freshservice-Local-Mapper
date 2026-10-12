# v0.1.0-beta

Primeira beta pública, exclusivamente Read-Only em recursos Freshservice. OAuth com perfis administrativos, callback localhost/painel 127, API key independente, inventário local, versões e diferenças.

897 unitários aprovados; 3 cenários pesados também aprovados; 341 testes autenticação/segurança; 137 Read-Only; 15 E2E simulador; 25 E2E produção; 25 E2E dev; typecheck/build passaram. Reinício offline preservou 175 versões sintéticas. Os subconjuntos se sobrepõem aos unitários e não devem ser somados.

**Freshservice/Freshworks reais e Windows 11 NÃO HOMOLOGADOS.** Windows Server do CI é evidência parcial. Banco/backups sem cifra; nomes/assuntos/custom_fields e texto livre podem conter dados pessoais. Sanitização de novas coletas não reescreve histórico; risco residual documentado.

Leia [relatório final](https://github.com/mnstechbr/Freshservice-Local-Mapper/blob/v0.1.0-beta/docs/RELATORIO-FINAL-CODEX.md), [validação](https://github.com/mnstechbr/Freshservice-Local-Mapper/blob/v0.1.0-beta/docs/VALIDACAO.md), [guia](https://github.com/mnstechbr/Freshservice-Local-Mapper/blob/v0.1.0-beta/docs/GUIA-DE-USO-E-COLETA.md) e [demonstração](https://github.com/mnstechbr/Freshservice-Local-Mapper/blob/v0.1.0-beta/docs/DEMONSTRACAO-SIMULADOR.md). Nenhuma credencial/conta/dado corporativo foi usado. Sem escrita remota, nuvem adicional ou telemetria.

[CI aprovado](https://github.com/mnstechbr/Freshservice-Local-Mapper/actions/runs/38238370583) no commit de código 7b7a68d: Windows Server, Fedora e navegador. DPAPI real com segredo fictício passou; os 65 E2E passaram. Atualizações posteriores corrigem documentação e um falso positivo do scanner de publicação, com teste adicional; runtime do aplicativo permanece igual.
