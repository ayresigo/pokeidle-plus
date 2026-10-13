---
phase: 01.1-migrar-worker-para-pokeidle-io
plan: 2
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/worker/src/auth/provider.ts
  - packages/worker/src/auth/solver.ts
  - packages/worker/src/auth/refresh.ts
  - packages/worker/src/auth/provider.test.ts
  - packages/worker/src/auth/solver.test.ts
  - packages/worker/src/auth/refresh.test.ts
  - packages/worker/src/config.ts
  - packages/worker/src/config.test.ts
autonomous: true
requirements: [MIG-02]
must_haves:
  truths:
    - "A auth do pokeidle.io (/auth/entrar, /auth/provedores, dispositivo, sitekey dinâmica, solver, token Bearer único) está revisada arquivo a arquivo"
    - "A robustez do v1.0 da auth está preservada e coberta por teste: invalidar com teto, transitório vs definitivo, sem segredos em log"
    - "O modelo de token (D-S6) está resolvido conforme a opção aprovada, sem shim pendente"
  artifacts:
    - path: "packages/worker/src/auth/provider.ts"
      provides: "Login + AuthManager revisados para o pokeidle.io"
  key_links:
    - from: "CONTEXT.md D-S5/D-S6"
      to: "provider.ts/refresh.ts/config.ts + testes"
      via: "cada decisão de robustez/token vira código + teste"
      pattern: "describe|it|test"
---

<objective>
Revisar **arquivo a arquivo** a auth do worker no `pokeidle.io` (MIG-02, SC2) e fechar a decisão de
modelo de token (D-S6). A reescrita já provou o login (VAL-01, HTTP 200); aqui o foco é **confirmar a
robustez do v1.0** e remover resíduos/ambiguidades, com teste para cada comportamento.

Purpose: auth confiável e revisada, sem buraco de robustez e sem shim de token.
Output: edits cirúrgicos em `auth/` + `config.ts`, com testes ao nível do v1.0 para o fluxo de auth.
</objective>

<context>
@.planning/phases/01.1-migrar-worker-para-pokeidle-io/CONTEXT.md
@.planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md
@packages/worker/src/auth/provider.ts
@packages/worker/src/auth/solver.ts
@packages/worker/src/auth/refresh.ts
@packages/worker/src/config.ts
</context>

<tasks>
<task type="auto" tdd="false">
  <name>Task 0: Modelo de token — DECIDIDO (D-S6 = opção (a))</name>
  <files>(decisão registrada; sem edit de design)</files>
  <behavior>
    D-S6 aprovado = **opção (a)**: manter o par interno `accessToken/refreshToken` no worker
    (`refreshToken = token`); a UI (Plan 4) passa a pedir o **token único** do pokeidle.io e a extração
    preenche os dois campos com o mesmo valor. **Nada muda** no schema da central nem na config do worker.
    Token único ponta a ponta → backlog. Documentar em GAME.md (Plan 1) por que o par é mantido.
  </behavior>
  <action>Seguir a opção (a) nas tasks abaixo e no Plan 4; nenhuma migração Prisma nesta fase.</action>
  <done>Opção (a) fixada; escopo das tasks ajustado (config/worker inalterados no modelo de token).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 1: Revisar login + solver + sitekey dinâmica</name>
  <files>packages/worker/src/auth/provider.ts, packages/worker/src/auth/solver.ts, packages/worker/src/auth/provider.test.ts, packages/worker/src/auth/solver.test.ts</files>
  <behavior>
    - `loginComCaptcha` (provider.ts): confirma POST `/auth/entrar` `{id, senha, turnstileToken, dispositivo}`;
      `precisaNick:true` → `LoginError("conta sem personagem")` → needs-login; HTTP não-ok → `LoginError`
      com `erro` sanitizado; sucesso → token Bearer. Cobrir cada ramo em provider.test.ts (incl. caso real
      `400 {"erro":"login.turnstileFalhou"}`).
    - `buscarSitekey` (solver.ts): `GET /auth/provedores` → `.turnstile`; ausência → `SolverError` pedindo
      `TURNSTILE_SITEKEY`. Cobrir sucesso, corpo sem `turnstile`, HTTP não-ok, e override por
      `TURNSTILE_SITEKEY`.
    - Segredos: `ocultarSegredos` cobre `pokeidlePass`, `solverKey`, `turnstileToken`, tokens, em toda
      mensagem de erro/log. Teste que garante que nenhum segredo vaza em `descrever`/`LoginError`.
  </behavior>
  <action>Editar só onde houver divergência do comportamento desejado; adicionar/reforçar testes. Sem
    comentários em linhas de código. Rodar `pnpm --filter @pokeidle/worker test provider solver`.</action>
  <verify><automated>pnpm --filter @pokeidle/worker test provider solver</automated></verify>
  <done>Login/solver/sitekey revisados e cobertos; nenhum segredo em log; testes verdes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Revisar renovação e AuthManager (sem REST refresh)</name>
  <files>packages/worker/src/auth/refresh.ts, packages/worker/src/auth/provider.ts, packages/worker/src/auth/refresh.test.ts, packages/worker/src/auth/provider.test.ts</files>
  <behavior>
    - `pokeidle.io` não tem refresh REST: `renovarTokens()` lança `RefreshNaoSuportadoError`. Documentar que
      a renovação proativa por `exp` leva a **re-login via solver** quando o access expira (não a `adiar`,
      que é só `RefreshIndisponivelError`). Confirmar que esse caminho não entra em loop e cai em needs-login
      só quando o solver falha.
    - `lerExpiracao` lê `exp` do JWT; `precisaRenovar`/`aceitar` agendam com margem. Cobrir token sem `exp`
      (sem renovação proativa) e token com `exp` curto (aviso de skew).
    - Decisão de robustez (GAME.md §9): "renovação via `/api/auth/refresh`" do v1.0 → **removida-com-evidência**
      (pokeidle.io renova pelo WS `sessao.renovada`; o write-back à central é SUP-02/Phase 2).
  </behavior>
  <action>Ajustar refresh.ts/provider.ts se o comportamento divergir; cobrir em refresh.test.ts/
    provider.test.ts. Sem comentários em linhas de código. Rodar os testes afetados.</action>
  <verify><automated>pnpm --filter @pokeidle/worker test refresh provider</automated></verify>
  <done>Renovação coerente com o pokeidle.io (re-login via solver), coberta; decisão registrada em §9.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Limpar config de auth + dispositivo</name>
  <files>packages/worker/src/config.ts, packages/worker/src/config.test.ts</files>
  <behavior>
    - Confirmar `DISPOSITIVO` (UUID por install, default `randomUUID()`), `TURNSTILE_SITEKEY` opcional,
      `SOLVER_API_URL`, caminhos de auth mutuamente exclusivos.
    - Se D-S6 = (b) token único: ajustar os requisitos de `ACCESS_TOKEN`/`REFRESH_TOKEN` para um campo só;
      se (a): manter, e cobrir que o par duplicado (token==token) é aceito.
    - (A limpeza de `GAME_WS_SHARDS`/sharding é do Plan 3; aqui só o que é de auth.)
  </behavior>
  <action>Editar config.ts conforme D-S6; cobrir em config.test.ts. Rodar `pnpm --filter @pokeidle/worker test config`.</action>
  <verify><automated>pnpm --filter @pokeidle/worker test config</automated></verify>
  <done>Config de auth coerente com o modelo de token aprovado, coberta.</done>
</task>

</tasks>

<threat_model>
| Threat ID | Category | Component | Disposition | Mitigation |
|-----------|----------|-----------|-------------|-----------|
| T-2-01 | Information Disclosure | senha/solverKey/token em log de erro | mitigate | `ocultarSegredos` + teste que falha se vazar |
| T-2-02 | Spoofing | sitekey errada aceitando captcha inútil | mitigate | sitekey dinâmica de `/auth/provedores` + override `TURNSTILE_SITEKEY` |
</threat_model>

<verification>
- `pnpm --filter @pokeidle/worker test` (auth + config) verde.
- Nenhum segredo em mensagens de erro (teste dedicado).
</verification>

<success_criteria>
- MIG-02 / SC2: auth revisada arquivo a arquivo; robustez do v1.0 preservada e coberta; modelo de token resolvido.
</success_criteria>

<output>
Criar `.planning/phases/01.1-migrar-worker-para-pokeidle-io/2-SUMMARY.md` (opção de D-S6; por item de auth:
preservado/ajustado/removido-com-evidência + teste).
</output>
