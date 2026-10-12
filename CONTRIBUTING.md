# Contribuir

Use fixtures sintéticas e contas fictícias do simulador. Não envie credenciais, bancos, backups, dados corporativos, logs privados ou capturas com dados reais.

```bash
npm run bootstrap -- --yes
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
pnpm test:e2e:sim
pnpm test:e2e:dev
```

A instalação exige Node ≥22.12 (24.18.0 usado nesta beta), npm e rede; os E2E bloqueiam destinos externos no navegador. Consulte [VALIDACAO.md](docs/VALIDACAO.md) para as rodadas específicas de segurança e Read-Only.

Descreva o problema, comportamento esperado e evidências no PR. Preserve F4, guarda de origem/Host, state de uso único e isolamento do simulador. POST externo só nos endpoints OAuth de token; métodos de escrita em recursos de negócio devem falhar antes da rede. Nenhuma contribuição pode introduzir escrita no Freshservice ou telemetria.

Não altere migrations já publicadas; faça alterações aditivas e teste banco existente com backup. Revise mudanças de sanitização: versões anteriores ficam preservadas e podem aparecer no diff. Não enfraqueça asserções para passar testes.

Dependências diretas e Actions são fixadas. Atualizações precisam de justificativa, revisão de advisories e lockfile com integridade; use instalação frozen para verificação. O CI Windows Server não homologa Windows 11.

Ao enviar contribuições, confirme que tem direito de distribui-las sob a licença MIT do projeto.
