# Motor de detecção de alterações (Fase 5)

Código: `src/lib/diff/` (núcleo puro em `core.ts`, `fields.ts`, `score.ts`, `canonical.ts`, `volatile.ts`; banco em `store.ts`; API pública em `index.ts`).
Rotas: `src/app/api/changes/` (GET lista, GET detalhe, POST revisão).
Testes: `tests/diff/` (fixtures sintéticas; sem dado real de cliente).

## 1. Entrada: snapshot de uma execução

Um snapshot é o conjunto de recursos observados por uma execução, com a versão vigente nela.

- Se a execução tem linhas em `resource_observations` (migration 0002, F4), o snapshot é exato: `(run_id, resource_id, version_id)`.
- Se não tem (execução anterior à 0002 ou sem observações), usa o fallback: recurso com `first_seen_run_id <= run <= last_seen_run_id` e a versão mais recente com `run_id <= run`.
  - Limitação: um recurso ausente no meio do intervalo (lacuna) aparece como observado. Isso só esconde remoções (nunca cria remoção falsa). O evidence marca `snapshotSource: {base, current}` como `fallback`.
- Relações (`resource_relations` da execução) entram só se a execução tiver linhas; caso contrário o score de relações fica sem dado.

Regra de decisão: observações são usadas por execução, nunca globalmente. Tabela existente com execução sem linhas não produz snapshot vazio.

## 2. Chave de identidade

`moduleKey + externalId + workspaceId`. Mesmo `externalId` em outro workspace é outro recurso. Ordem e saída são determinísticas: a entrada é ordenada pela chave antes de qualquer comparação.

## 3. Normalização e hash

- JSON canônico: chaves de objeto ordenadas em todos os níveis. Ordem de propriedades não é alteração. A ordem dos elementos de array é preservada no hash.
- Voláteis: lista em `src/lib/diff/volatile.ts` (`VOLATILE_KEYS_BY_MODULE`, chave `*` vale para todos). Removidos em qualquer profundidade antes do hash e do diff.
- Hash: SHA-256 hex do JSON canônico sem voláteis (`contentHashOf`).
- `contentHash` gravado por F4 é só atalho. Hash igual = sem mudança. Hash diferente recalcula o diff com a regra acima, então mudança só em volátil ou em ordem não gera registro.

## 4. Diff de um recurso presente nas duas execuções

- Nome diferente: `name_changed` (medium), com `previousName` e `currentName`.
- Demais campos (`fields_changed`): diff estrutural com caminho e tag:
  - `fields[id=12].required`, tag `required`, alterações em `required` e em opções geram `medium`; demais, `low`.
  - Arrays de objetos são pareados por identidade (`id`, `field_id`, `key`, `name`, nessa ordem, único em ambos os lados). Mesmo id com nome diferente: `field_renamed`. Elemento sem par: `field_added` / `field_removed`.
  - Sem identidade comum: pareamento por índice, com tag `value`.
  - Arrays de primitivos (ex.: opções): comparados como conjunto. Ordem não gera mudança. Valores em `options`/`choices`/`values`: `option_added` / `option_removed`.
  - Tags adicionais: `description`, `category`, `visibility`, `relation`, `value`.
- Ausência de chave:
  - Chave presente nos dois lados: comparada, inclusive `null` explícito.
  - Chave em um lado só: conta (added/removed) apenas se estiver em `ALWAYS_RETURNED_BY_MODULE` (hoje `name`, para todos os módulos). Fora dessa lista é ignorada, pois pode ser omissão da API. Ausência nunca é tratada como `null`.
  - A lista de sempre retornadas é inicial e precisa ser revisada com respostas reais de cada módulo (pendência).

## 5. Completude e escopo

Por módulo, a partir de `sync_module_results`:
- `baseComplete` / `currentComplete`: `status = completed` e `complete = 1`. Sem registro: não completo.
- `scopeComparable`: mesma conexão (`connection_id`) e mesma identidade (`identity_label`) nas duas execuções.

Regras:
- Removido só com `baseComplete && currentComplete && scopeComparable`. Caso contrário: `not_observed` (low), nunca `removed`. Evidence traz `reason`: `base_incomplete`, `current_incomplete` ou `scope_not_comparable`.
- Módulo fora do escopo comparável (ausente em uma das execuções, ou escopo diferente): nenhum `added` nem `removed`. Itens que só existem na execução B viram nota `scope_not_comparable` em `DiffResult.notes` (com `baseItems` e `currentItems`), sem linha em `detected_changes`. Itens que só existem na A seguem como `not_observed`, porque B não os observou.
- Novo recurso com base incompleta (módulo comparável): `added` com `evidence.baseIncomplete = true`.

## 6. Possível troca de ID

Candidatos: removidos (com coleta completa) x novos, no mesmo módulo.

Score (0 a 1), com breakdown por componente:

| Componente | Peso | Cálculo |
|---|---|---|
| name | 0.40 | nome normalizado (minúsculas, sem acento, sem pontuação); máximo entre Jaccard de tokens e Levenshtein (textos até 200 caracteres) |
| category | 0.10 | igualdade normalizada |
| description | 0.10 | `description` ou `description_text` sem tags HTML; mesma similaridade do nome |
| fields | 0.20 | Jaccard dos nomes/rótulos/chaves de campos e valores de opções |
| relations | 0.10 | Jaccard de `relations` (se gravadas) |
| workspace | 0.10 | igualdade |

`score = soma(peso x valor) / soma(todos os pesos)`. Componente sem dado em um lado tem valor `null`: contribui 0 no numerador e o peso segue no denominador. Conservador: falta de dado reduz o score. Exemplo: nome, categoria, descrição, campos e workspace iguais, sem relações gravadas, dá 0.90.

Limiares (`THRESHOLDS`):
- `low = 0.50`: abaixo disso o par não é considerado.
- `high = 0.75`: acima disso, sem disputa, é sugestão com `band = suggested`.
- `low <= score < high`: `band = ambiguous`, `evidence.ambiguous = true`, `reason = score_band`.
- `closeDelta = 0.05`: dois pares que compartilham um recurso e têm score a menos disso são ambíguos.
- `maxPairsPerModule = 200 000`: acima, o matching do módulo é pulado. Vai para `notes`, e os recursos saem como removed/added (conservador).

Algoritmo por módulo:
1. Arestas: pares com `score >= low`.
2. Aresta ambígua: outro candidato compartilha um dos recursos com score a menos de `closeDelta`.
3. Recursos ligados a aresta ambígua formam um grupo (fechamento transitivo). Não há escolha automática. Gera uma mudança `possible_id_change` por recurso removido, com `evidence.candidates` (todos os candidatos, com score e breakdown), `reviewStatus = pending` e um match `suggested` por candidato. Os novos do grupo não viram `added`.
4. O restante é casado de forma gulosa, do maior score para o menor, sem repetir recurso. Cada par vira uma mudança `possible_id_change` com `reviewStatus = pending` e um match `suggested`. Os recursos casados não geram `removed`/`added` duplicados.
5. Sem par: removido vira `removed`; novo vira `added`.

Nunca há confirmação automática.

## 7. Severidade e revisão

| Tipo | Severidade | `reviewStatus` inicial |
|---|---|---|
| `possible_id_change` | high | pending (confirmed/rejected se decidido) |
| `removed` | high | not_applicable |
| `not_observed` | low | not_applicable |
| `added` | low | not_applicable |
| `name_changed` | medium | not_applicable |
| `fields_changed` | medium ou low | not_applicable |

## 8. Persistência, idempotência e histórico

- `detectChangesForRun(db, {runId, baseRunId}, {now?, decisions?})`: transação única. Faz upsert por chave natural dentro do par `(runId, baseRunId)`: chave já existente é atualizada (mesmo `id`), chave nova é inserida e linha que sumiu é apagada junto com seus candidatos. Atualiza `sync_runs.changes_count` e `compared_to_run_id`. Devolve `{ changesCount, notes }`.
- Chave natural (determinística): `(change_type, module_key, resource_id, previous_resource_id, previous_external_id, current_external_id)`. Não usa id, status, score, nomes nem conteúdo. Se a mesma chave aparecer mais de uma vez, os pares seguem a ordem de `id` e a ordem da saída (já ordenada).
- Candidatos (`change_matches`) são pareados por `(old_resource_id, new_resource_id)`. `decided_at` só muda quando o status muda.
- Idempotente: reprocessar o mesmo par não muda ids nem duplica linhas (`tests/diff/store.test.ts`).
- Pares diferentes não se apagam. O histórico de comparações anteriores fica preservado.
- `baseRunId = null` (primeira execução): sem comparação, `changes_count = 0`, `compared_to_run_id = null`.
- Base precisa ser anterior à execução comparada (`baseRunId < runId`), e as duas execuções precisam ser da mesma instância.
- Decisões humanas sobrevivem à nova detecção: as decisões gravadas (`change_matches` com status `confirmed` ou `rejected`) são lidas e reaplicadas a cada detecção.
  - Confirmado: par fixado. Sem `removed`/`added` do par. Linha `possible_id_change` com `reviewStatus = confirmed`.
  - Rejeitado: par retirado do matching. A linha `possible_id_change` fica com `reviewStatus = rejected`, no mesmo id. Os dois recursos voltam como `removed`/`not_observed` e `added`.
- Id estável na revisão: a revisão não troca o `id` da mudança revisada. Se ela era um grupo (vários candidatos, `resource_id` nulo) e passa a ser um par decidido, a chave muda, mas a linha revisada recebe o par decidido e mantém o `id`. Linhas de outras mudanças só trocam de id quando o conjunto de candidatos do par muda por causa de outra revisão: a que sumiu é apagada e a nova recebe id novo.

## 9. Revisão e linhagem

- `POST /api/changes/[id]/review` com `{ "decision": "confirm" | "reject", "matchId"?: number }`. Resposta: `{ "changeId": <mesmo id>, "status": "confirmed" | "rejected" }`.
  - Pendente: confirma ou rejeita um candidato. `matchId` é obrigatório quando há mais de um. Confirmada ou rejeitada: pode trocar a decisão do par já decidido (ex.: rejeitar uma confirmada).
  - Atualiza a linha no lugar (`review_status` e o candidato decidido) e refaz a detecção do par com a decisão, mantendo o id da linha revisada.
  - Erros: `not_found` (404), `not_reviewable` (409, tipo diferente de `possible_id_change` ou `not_applicable`), `conflict` (409, outro par confirmado usa o mesmo id antigo ou novo; checado antes de gravar), `match_required` (400), `invalid_match` (400).
  - Nunca chama o Freshservice. Origem local validada por `src/proxy.ts` (métodos mutáveis).
  - Tudo na mesma transação: em erro, nada é gravado.
- `getIdLineage(db, resourceId)`: percorre `change_matches` confirmados em ambos os sentidos e devolve nós (recursos) e ligações (troca, mudança, score, data), ordenadas pela data da decisão.

## 10. Comparação arbitrária

`compareRuns(db, runA, runB, {thresholds?, weights?})`: compara duas execuções sem gravar e sem decisões. Base é `runA`, atual é `runB`, sem exigir ordem cronológica. Para `/historico/comparar`.

Atenção: `compareRuns` tem o mesmo nome de `compareRuns(db, instanceId, baselineId, targetId)` em `src/lib/queries/runs.ts` (F2). Os dois não se misturam, porque o de F2 não é importado aqui. Na Fase 6, trocar a tela de comparação para o `compareRuns` deste módulo e remover o de F2.

## 11. Limitações e pendências

- Fallback sem observações tem o problema das lacunas (seção 1). Só some quando F4 gravar observações em todas as execuções.
- Listas de voláteis e de sempre retornadas são iniciais. Precisam de revisão com as respostas reais de cada módulo do catálogo (`src/lib/modules/catalog.ts`).
- `relations` só entram no score se F4 gravar `resource_relations` por execução.
- Matching é O(removidos x novos) por módulo, com limite de `maxPairsPerModule`. Para instâncias grandes, o próximo passo é um pré-filtro (ex.: por categoria ou por token do nome).
- O score usa pesos e limiares iniciais, sem calibração com dado real. Devem ser ajustados com revisão humana e registrados aqui.
- Nota de escopo não é persistida em `sync_runs`: fica em `DiffResult.notes` (`compareRuns` e retorno de `detectChangesForRun`). Exibir na tela de `/diferencas` exigiria coluna nova (migration 0003), não criada nesta fase.
- Upsert sem índice único por chave natural: a unicidade é garantida na aplicação, dentro de transação (better-sqlite3 é síncrono).
