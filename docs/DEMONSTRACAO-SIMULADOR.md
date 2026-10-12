# Demonstração integral sem conta Freshservice

**Dados e credenciais fictícios.** Simula OAuth e contratos REST v2, não homologa Freshworks/Freshservice. Rede necessária apenas para instalar dependências/Chromium.

## Execução automatizada reproduzível

```bash
npm run bootstrap -- --yes
pnpm exec playwright install chromium
pnpm test:e2e:sim
```

O Playwright inicia build local em 127.0.0.1:3112, liga FSLM_SIMULATOR explicitamente e cria um SQLite novo em `.e2e-data/`. O navegador só aceita loopback; hosts fictícios *.simulador.invalid são atendidos em processo, sem DNS/socket externo. Não usa o banco padrão do usuário. A produção local/testes dev desligam explicitamente a flag e verificam ausência da faixa de simulação.

`01-fluxo-principal.spec.ts` reproduz URL sem perfil → configuração administrativa → Conectar → login → callback localhost → dashboard 127.0.0.1 Conectado sem recarga → Testar conexão → coleta → alteração/remoção → segunda coleta → diferenças → desconectar. O cookie de state existe somente no host do callback, é removido e não é compartilhado com o dashboard.

`02-cenarios.spec.ts` cobre negação, credenciais inválidas, MFA fictício, escopos/papel, state inválido/reutilizado, refresh aceito/recusado, falha transitória e callback 127.0.0.1.

`04-estabilizacao.spec.ts` salva URL sem OAuth, recusa API key inválida, conecta API key fictícia, diagnostica e coleta os 23 módulos, abre todos os grupos/detalhes e relações, executa duas coletas, conserva versões/observações no SQLite e consulta offline após desconexão. O benchmark JSON em `test-results/` é sintético: tempo inclui navegador/polling; pages_fetched não representa todas as requisições de autenticação/diagnóstico.

## Apresentação no navegador

Use um diretório novo e exclusivo sob `.e2e-data/` (nunca o banco do usuário):

```bash
FSLM_DATA_DIR="$PWD/.e2e-data/apresentacao" FSLM_SIMULATOR=1 PORT=3112 FSLM_NO_BROWSER=1 pnpm dev
```

No PowerShell, defina essas variáveis no ambiente da sessão usando caminho absoluto para FSLM_DATA_DIR. Abra http://127.0.0.1:3112. Todas as páginas mostram **Simulador local — dados fictícios**.

Em Configurações → Administração da integração crie o perfil fictício: nome livre, organização `https://demo.myfreshworks.simulador.invalid`, client ID `sim-client-fslm`, secret `sim-secret-ficticio-fslm`, domínio `demo.freshservice.simulador.invalid`, callback localhost. Mantenha .view por padrão; agentes/grupos/catálogo/formulário podem ficar bloqueados por escopo ou papel, de propósito.

No dashboard use `https://demo.freshservice.simulador.invalid`, Conectar, login `analista.ficticio@simulador.invalid` / `SenhaFicticia-2026`, Autorizar. O status muda sozinho. Rode Testar conexão, Diagnosticar acesso e Mapear tudo.

Para alterar a fixture, no console do navegador **deste app local**, execute:

```javascript
await fetch('/simulador/control', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'upsert_record', resource: 'tickets',
    record: { id: 1, subject: 'Ticket alterado na demonstração' } }) });
await fetch('/simulador/control', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'delete_record', resource: 'tickets', id: 2 }) });
```

Execute Sincronizar novamente. Em Diferenças verá alteração de nome e remoção; em Histórico consulte as duas execuções. Os POSTs acima alteram somente memória do simulador. Não existem em uso normal (404 sem flag).

Desconecte, encerre o servidor com Ctrl+C e inicie novamente **com o mesmo diretório dedicado**. Consulte Tickets, Diferenças e Histórico offline: versões persistem. O simulador volta às fixtures iniciais a cada novo processo; snapshots já gravados permanecem. Não reconecte/recolete se quiser mostrar o estado offline.

Encerre a sessão de apresentação e retire FSLM_SIMULATOR antes do uso normal. Não reutilize esse diretório para dados reais e não publique SQLite, cofre, logs ou traces.
