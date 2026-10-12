---
phase: 1-validacao-com-conta-real
plan: 4
type: execute
wave: 4
depends_on: [2, 3]
files_modified:
  - packages/worker/src/auth/provider.ts
  - packages/worker/src/auth/refresh.ts
  - packages/worker/src/auth/provider.test.ts
  - packages/worker/src/auth/refresh.test.ts
  - packages/worker/src/auth/solver.test.ts
  - packages/worker/src/game/client.ts
  - packages/worker/src/game/client.test.ts
  - packages/worker/src/game/loop.ts
  - packages/worker/src/game/loop.test.ts
  - packages/worker/src/config.ts
  - packages/worker/src/config.test.ts
  - packages/worker/src/index.ts
  - packages/worker/GAME.md
autonomous: true
requirements: [VAL-01, VAL-02, VAL-03, VAL-04, VAL-05, VAL-06, VAL-07]
must_haves:
  truths:
    - "Toda divergência observada no smoke (2-PLAN/3-PLAN) virou correção em packages/worker/src"
    - "Cada correção tem teste que reproduz o comportamento REAL observado (não o presumido)"
    - "Onde não houve divergência, o ponto fica marcado em GAME.md como confirmado, sem alteração de código"
  artifacts:
    - path: "packages/worker/GAME.md"
      provides: "Pontos de §9 atualizados conforme as correções aplicadas (ou confirmados)"
    - path: "packages/worker/src/game/client.test.ts"
      provides: "Casos novos reproduzindo divergências de WS/shard/eventos/drain/close codes, se houver"
  key_links:
    - from: "EVIDENCE.md (divergência)"
      to: "packages/worker/src/<arquivo> + <teste>"
      via: "cada edit é disparado por uma evidência de divergência (D-08)"
      pattern: "describe|it|test"
---

<objective>
Aplicar as correções no `packages/worker/src` decorrentes das divergências observadas no
smoke (2-PLAN e 3-PLAN), cumprindo VAL-07 e fechando VAL-01..VAL-06 do lado do código.

REGRA DE DISPARO (D-08 — gated por evidência): cada tarefa abaixo SÓ vira edit de código se
EVIDENCE.md registrar a divergência correspondente. **Sem divergência, a tarefa fecha como
"confirmado, sem correção"** — nenhuma linha de código muda; só se garante que o ponto de §9
em GAME.md está marcado como confirmado (feito no 2/3-PLAN). Cada correção aplicada vem com um
teste que reproduz o comportamento REAL observado (não o presumido), nos arquivos
`client.test.ts`/`provider.test.ts`/`loop.test.ts`/`refresh.test.ts`/`solver.test.ts`/`config.test.ts`.

Purpose: Converter observação em worker ajustado ao jogo real, com a suíte verde.
Output: edits cirúrgicos + testes para cada divergência; GAME.md §9 coerente com o código.

NOTA: o gate final (suíte verde ≥175 + todo §9 marcado) está no 5-PLAN.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/phase-1-validacao-com-conta-real/CONTEXT.md
@.planning/phases/phase-1-validacao-com-conta-real/1-RESEARCH.md
@.planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md
@.planning/phases/phase-1-validacao-com-conta-real/2-SUMMARY.md
@.planning/phases/phase-1-validacao-com-conta-real/3-SUMMARY.md
@packages/worker/GAME.md
@packages/worker/src/auth/provider.ts
@packages/worker/src/auth/refresh.ts
@packages/worker/src/game/client.ts
@packages/worker/src/game/loop.ts
@packages/worker/src/config.ts
@packages/worker/src/index.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Correções de auth (gated) — VAL-01, VAL-06</name>
  <files>packages/worker/src/auth/provider.ts, packages/worker/src/auth/refresh.ts, packages/worker/src/auth/provider.test.ts, packages/worker/src/auth/refresh.test.ts, packages/worker/src/auth/solver.test.ts</files>
  <behavior>
    Aplicar APENAS os sub-itens com divergência registrada em EVIDENCE.md:
    - Solver recusado pelo backend (VAL-01): confirmar que `loginComCaptcha` produz LoginError →
      needs-login com lastError claro e sem loop; se a mensagem/fluxo divergir do observado, ajustar e
      cobrir em provider.test.ts (caso "login recusado (HTTP …)"). D-02: documentar tokens colados como principal.
    - Turnstile sempre ligado (VAL-01): se o backend aceitar login sem captcha em algum caso observado,
      ajustar `loginComCaptcha`; teste em provider.test.ts.
    - Refresh não rotaciona / sem exp (VAL-06): se o backend divergir do tratado hoje (usa novo refreshToken
      se vier, mantém atual se não; lerExpiracao lê o exp), ajustar refresh.ts e cobrir em refresh.test.ts.
    - Sitekey do Turnstile (VAL-01): se a extração do chunk falhar no real, ajustar solver.ts/doc do
      TURNSTILE_SITEKEY; teste em solver.test.ts.
  </behavior>
  <action>
    Para CADA sub-item: se não há evidência de divergência em EVIDENCE.md, NÃO alterar código — registrar no
    SUMMARY "confirmado, sem correção" e seguir. Se há divergência, editar o arquivo/função indicado e
    adicionar um teste que reproduz exatamente o comportamento observado (status HTTP, corpo, mensagem já
    sanitizados). Sem comentários em linhas de código. Rodar o arquivo de teste afetado.
  </action>
  <verify>
    <automated>pnpm --filter worker test provider refresh solver</automated>
  </verify>
  <done>Cada sub-item de auth está confirmado (sem edit) ou corrigido com teste reproduzindo o real; testes de auth verdes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Correções de WS / shard / eventos / close codes (gated) — VAL-02, VAL-03, VAL-04, VAL-06</name>
  <files>packages/worker/src/game/client.ts, packages/worker/src/game/client.test.ts, packages/worker/src/config.ts, packages/worker/src/config.test.ts, packages/worker/src/game/loop.ts, packages/worker/src/game/loop.test.ts</files>
  <behavior>
    Aplicar APENAS os sub-itens com divergência em EVIDENCE.md:
    - Shard divergente (VAL-03): se o shard do navegador ≠ djb2(sub)%88, corrigir o cálculo em
      `montarUrlWs`/`lerSub` OU ajustar os overrides GAME_WS_URL/GAME_WS_PATH/GAME_WS_SHARDS em config.ts;
      teste em client.test.ts (montagem de URL/shard reproduzindo o path real) e/ou config.test.ts.
    - WS sem cmid / 4007 (VAL-02): confirmar que sem cmid a sessão se mantém, ou que 4007 → error sem
      reconectar (FECHAMENTOS_TERMINAIS). Se o mapeamento divergir do observado, ajustar client.ts; teste em
      client.test.ts. NUNCA forjar cmid (D-10).
    - Formato de eventos (VAL-04): se os campos reais de field-kill/catch-result/analyzer/balls divergirem do
      que o switch lê (client.ts ~521-591), ajustar a leitura e cobrir em client.test.ts com o frame real.
    - Close codes 4005-4009 (VAL-06): se algum código observado mapear para estado diferente do atual,
      ajustar FECHAMENTOS_TERMINAIS; teste em client.test.ts.
    - Hunt inválida / watchdog (VAL-04): se o comportamento de garantir-hunt/watchdog divergir, ajustar
      loop.ts; teste em loop.test.ts.
  </behavior>
  <action>
    Para CADA sub-item: sem evidência de divergência → NÃO alterar código, registrar "confirmado, sem
    correção". Com divergência → edit cirúrgico no arquivo indicado + teste que reproduz o frame/close code
    real observado (sanitizado). Sem comentários em linhas de código. Rodar os arquivos de teste afetados.
  </action>
  <verify>
    <automated>pnpm --filter worker test client config loop</automated>
  </verify>
  <done>Cada sub-item de WS/shard/eventos/close está confirmado (sem edit) ou corrigido com teste reproduzindo o real; testes verdes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Correção de drain / farm offline (gated) — VAL-05</name>
  <files>packages/worker/src/game/client.ts, packages/worker/src/game/client.test.ts, packages/worker/src/index.ts, packages/worker/src/game/loop.ts, packages/worker/src/game/loop.test.ts</files>
  <behavior>
    - Se o 3-PLAN registrou que o farm offline CONTINUA após docker stop sem sleep-mode: confirmado, sem
      correção (GAME.md §9.2 "Drain sem sleep-mode" já marcado confirmado).
    - Se registrou que o farm offline NÃO continua: `desconectar()` passa a enviar `{"type":"sleep-mode"}` e
      aguardar `sleep-ok` (com ghost) ANTES do `close(1000, "drain")`, respeitando o timeout de drenagem de
      20s de `index.ts`/`drenar`. Comportamento testável: ao drenar, o client envia sleep-mode; ao receber
      sleep-ok fecha limpo; se sleep-ok não chega dentro do prazo, fecha mesmo assim sem travar o processo.
  </behavior>
  <action>
    Gated: só editar se EVIDENCE.md mostrar que o farm offline não continua sem sleep-mode. Então implementar
    o envio de sleep-mode + espera de sleep-ok em `client.ts` `desconectar`, coordenado com `drenar`
    (loop.ts) e o TIMEOUT_DRENAGEM_MS de `index.ts`, sem exceder o prazo. Teste em client.test.ts (novo caso:
    desconectar envia sleep-mode e espera sleep-ok; e caso de timeout fecha assim mesmo). Sem comentários em
    linhas de código. Se não houver divergência, registrar "confirmado, sem correção".
  </action>
  <verify>
    <automated>pnpm --filter worker test client loop</automated>
  </verify>
  <done>Drain confirmado sem correção, OU drain envia sleep-mode/espera sleep-ok dentro do prazo, com teste verde.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| WS do jogo → worker | Frames reais agora reproduzidos em testes |
| worker → sessão da conta | Correção do drain altera o fechamento da sessão |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-4-01 | Elevation/abuse | tentação de forjar cmid para contornar 4007 | mitigate | Proibido por D-10; nenhuma tarefa gera cmid; 4007 permanece bloqueio a registrar |
| T-4-02 | Information Disclosure | frame real colado em teste/commit | mitigate | Usar fixtures sanitizados (padrão `__fixtures__/`); sem token/identifier no teste |
| T-4-03 | Denial of Service | sleep-mode travando o drain além de 20s | mitigate | Espera de sleep-ok com `Promise.race` contra o prazo; fecha mesmo sem sleep-ok |
</threat_model>

<verification>
- `pnpm --filter worker test` do worker verde após cada correção aplicada.
- Cada edit tem um teste correspondente reproduzindo o comportamento real (D-08); sub-itens sem divergência
  não têm edit (confirmados no SUMMARY).
</verification>

<success_criteria>
- Toda divergência de EVIDENCE.md virou correção com teste real (VAL-07).
- Nenhuma correção foi aplicada sem evidência (D-08); sub-itens sem divergência ficam só "confirmado".
- GAME.md §9 coerente com o código resultante.
</success_criteria>

<output>
Após concluir, criar `.planning/phases/phase-1-validacao-com-conta-real/4-SUMMARY.md`
(lista: por sub-item, "confirmado sem correção" ou "corrigido: <arquivo> + <teste>").
</output>
