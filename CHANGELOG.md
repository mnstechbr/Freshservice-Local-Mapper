# Changelog

## v0.1.0-beta — 2026-10-12

Primeira beta pública do inventário local Read-Only. Preserva OAuth com perfis administrativos e a F4 (callback localhost, dashboard 127.0.0.1, state/cookie por host e passagem assinada de uso único).

- Teste de conexão renova OAuth uma vez após 401 antecipado; chamadas concorrentes compartilham refresh, e desconexão em voo permanece desconectada.
- Transporte bloqueia métodos de escrita em recursos antes de DNS/fetch.
- Consentimento explícito também para escopos .edit; padrão apenas .view.
- URL pode ser salva independentemente de OAuth/API key.
- Contatos/endereço de Locais/Fornecedores omitidos; padrão ITSM somente metadados.
- Detalhes e relações delimitados pela instância ativa.
- Executáveis Windows usam caminhos absolutos; orientação segura para chave de cofre.
- Domínios customizados recusados de forma consistente, preservando registros legados.
- Dependências/Actions fixadas e pnpm atualizado para corrigir advisory de integridade.
- Simulador OAuth/API v2 com fixtures, duas coletas e regressão de diferenças.

Não homologa Freshservice/Freshworks reais nem Windows 11. SQLite/backups não cifrados; minimização não reescreve histórico. Resultados e limitações em [relatório](docs/RELATORIO-FINAL-CODEX.md).
