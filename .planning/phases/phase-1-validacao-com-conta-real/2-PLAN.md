---
phase: 1-validacao-com-conta-real
plan: 2
type: execute
wave: 2
depends_on: [1]
files_modified:
  - packages/worker/GAME.md
  - .planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md
autonomous: false
requirements: [VAL-01, VAL-02, VAL-06]
user_setup:
  - service: conta-descartavel-pokeidle
    why: "VAL-01/VAL-02/VAL-06 precisam de uma sessão de login real (D-03)"
    env_vars:
      - name: SOLVER_KEY
        source: "Painel 2captcha (só no .env local ignorado pelo git; nunca em .planning/ nem commit)"
      - name: POKEIDLE_USER
        source: "Credencial da conta descartável (só no .env local)"
      - name: POKEIDLE_PASS
        source: "Credencial da conta descartável (só no .env local)"
      - name: ACCESS_TOKEN
        source: "sessionStorage['pokeweb:tokens'].accessToken extraído no DevTools (só no .env local)"
      - name: REFRESH_TOKEN
        source: "sessionStorage['pokeweb:tokens'].refreshToken extraído no DevTools (só no .env local)"
    dashboard_config:
      - task: "Criar uma conta descartável com personagem já criado (pós-login roteia para /play)"
        location: "https://poke.idleworld.online"
must_haves:
  truths:
    - "Está registrado se POST /api/auth/login aceita o captchaToken do solver (IP do solver)"
    - "Está registrado se o backend exige captchaToken em todo login"
    - "Em recusa do solver, o worker cai em needs-login com lastError claro e o caminho de tokens colados fica documentado como principal (D-02)"
    - "Está registrado se o refresh rotaciona o refreshToken e se o access é JWT com exp"
    - "Está registrado o comportamento de 4007 (machineLimited): error sem reconectar, sem forjar cmid"
  artifacts:
    - path: "packages/worker/GAME.md"
      provides: "Pontos de §9.1 marcados (confirmado/refutado/não-observável + data)"
      contains: "9.1"
    - path: ".planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md"
      provides: "Trechos sanitizados (log/HTTP/WS) que embasam cada marca de §9.1"
  key_links:
    - from: "packages/worker/GAME.md §9.1"
      to: ".planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md"
      via: "cada marca aponta um trecho de evidência sanitizado"
      pattern: "confirmado|refutado|não-observável"
---

<objective>
Roteiro de smoke manual, seguro e reprodutível, da **autenticação e início de sessão**
contra o jogo real (`poke.idleworld.online`), cobrindo VAL-01 (aceite do solver e
exigência de captcha), VAL-02 (parte de 4007/`machineLimited`) e VAL-06 (rotação de
refreshToken e `exp` do access). Cada ponto de GAME.md §9.1 vira
confirmado/refutado/não-observável, com data e evidência sanitizada em EVIDENCE.md (D-07).

Purpose: Responder as incógnitas server-side de §9.1 que só uma conta real resolve —
sobretudo "o backend aceita o `captchaToken` gerado no IP do solver?" (D-01/D-04).

Output: GAME.md §9.1 marcado + EVIDENCE.md com os trechos; nenhuma mudança de código aqui
(correções, se houver divergência, ficam no 4-PLAN, gated por D-08).

NOTA DE EXECUÇÃO: Os passos contra o jogo real só rodam quando o usuário confirmar,
neste terminal, que está pronto e com qual conta descartável (D-03). As credenciais
(`SOLVER_KEY`/`POKEIDLE_USER`/`POKEIDLE_PASS`/`ACCESS_TOKEN`/`REFRESH_TOKEN`) entram só
via `.env` local ignorado pelo git — nunca em `.planning/`, GAME.md, logs ou commits.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/phase-1-validacao-com-conta-real/CONTEXT.md
@.planning/phases/phase-1-validacao-com-conta-real/1-RESEARCH.md
@packages/worker/GAME.md
@packages/worker/src/config.ts
@packages/worker/src/auth/provider.ts
@packages/worker/src/auth/refresh.ts
</context>

<tasks>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 1: Pré-requisitos e guardas de segurança</name>
  <what-built>Nada de código. Preparação do ambiente de smoke.</what-built>
  <how-to-verify>
    1. Confirmar com o usuário, NESTE terminal, que está pronto e com qual conta descartável (D-03).
    2. Conferir toolchain: `node --version`, `pnpm --version`, `docker --version`; `pnpm install` na raiz.
    3. Criar/validar um `.env` local (ignorado pelo git, FORA de `.planning/`) com, no mínimo:
       `ACCOUNT_ID`, `GAME_URL=https://poke.idleworld.online`, `HUNT_SLUG=<slug informado>`,
       `PROXY_URL` vazio (D-04). Para a Execução A: `SOLVER_KEY`, `POKEIDLE_USER`, `POKEIDLE_PASS`.
    4. Confirmar que a conta descartável tem personagem (pós-login roteia para `/play`).
    5. Garantir a porta de `/health` (default 3001) livre.
    Guardas (checklist, aplicar em TODOS os passos): uma sessão por conta (login concorrente → 4005,
    nunca worker+navegador na mesma conta); não comprar/vender; não forjar `cmid` (D-10);
    segredos só no `.env` local; nunca ecoar segredos no terminal nem colá-los em arquivos.
  </how-to-verify>
  <resume-signal>Digite "pronto" com a conta confirmada, ou descreva o bloqueio.</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Execução A (solver) e Execução B (tokens colados) — VAL-01</name>
  <what-built>Observação dos dois caminhos de auth em execuções separadas (D-01), com registro de evidência.</what-built>
  <how-to-verify>
    EXECUÇÃO A — caminho SOLVER (VAL-01 principal):
    1. Com o `.env` do caminho solver, rodar `pnpm --filter worker start` (tsx src/index.ts, logs diretos; D-05).
    2. Observar stdout: `autenticado via solver` (sucesso) OU `needs-login (...)`/`autenticação adiada (...)`.
    3. `curl http://127.0.0.1:3001/health`: `state` deve ir de `authenticating` a `in-game` (NÃO "running";
       o vocabulário real é booting|authenticating|in-game|needs-login|error). Em recusa: `state: needs-login`
       com `lastError` tipo "login recusado (HTTP …)".
    4. Repetir A 2-3 vezes (Turnstile/Cloudflare pontua por IP — pode variar). Registrar o status HTTP
       sanitizado de cada tentativa.
    5. Parar o worker (Ctrl-C).

    EXTRAIR pokeweb:tokens (para a Execução B) — com o worker PARADO (evita 4005):
    6. Login manual em `https://poke.idleworld.online/login`, chegar em `/play`.
    7. DevTools → Application → Session Storage → chave `pokeweb:tokens` (JSON `{accessToken, refreshToken}`).
    8. Copiar os valores para `ACCESS_TOKEN`/`REFRESH_TOKEN` no `.env` local. Registrar só "tokens extraídos em <data>".
    9. FECHAR a aba do jogo antes de religar o worker.

    EXECUÇÃO B — caminho TOKENS COLADOS (VAL-01 fallback / principal se o solver recusar, D-02):
    10. Com o `.env` de tokens colados, rodar `pnpm --filter worker start`; esperar `autenticado via tokens salvos`
        e `state: in-game`.

    REGISTRO (D-07): marcar em GAME.md §9.1 os pontos "Solver aceito pelo jogo?" e "Turnstile sempre ligado?"
    como confirmado/refutado/não-observável + data; espelhar em EVIDENCE.md o trecho sanitizado
    (status HTTP, mensagem de erro já ocultada por `ocultarSegredos`). Se o solver for recusado,
    documentar em §9.1 que os tokens colados viram o caminho principal (D-02).
  </how-to-verify>
  <resume-signal>Digite "registrado" com §9.1 solver/captcha marcado e EVIDENCE.md atualizado, ou descreva a divergência observada (vira input do 4-PLAN).</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Refresh, exp do JWT e close 4007 — VAL-06 (auth) / VAL-02</name>
  <what-built>Observação de rotação de token, exp do access e comportamento de 4007 na mesma sessão.</what-built>
  <how-to-verify>
    ROTAÇÃO DE REFRESH / EXP (VAL-06):
    1. Com o worker em `in-game`, deixar rodar até um refresh (ou aguardar a expiração pelo `exp`).
    2. Se `/health` passar a expor `tokens` diferentes dos iniciais, o backend rotacionou o refreshToken
       (`health.ts` renewedTokens; `refresh.ts` renovarTokens). Registrar SÓ o fato "tokens mudaram", nunca o valor.
    3. Confirmar que há renovação proativa (pelo `exp` do JWT) e não só reativa a 401/4001. Se o access não
       tiver `exp`, registrar "só renovação reativa".
    4. Marcar em GAME.md §9.1 "Refresh rotaciona o refreshToken?" e "Validade do access token (exp)" +
       data; evidência sanitizada em EVIDENCE.md.

    CLOSE 4007 (VAL-02, parte auth/sessão):
    5. Observar se a sessão WS sem `cmid` se mantém ou fecha com 4007 (`machineLimited`). Se fechar 4007:
       `curl /health` deve mostrar `state: error` com `lastError` "limite de contas por máquina atingido (WS 4007)",
       SEM reconectar em loop e SEM forjar `cmid` (D-10). Se NÃO fechar 4007 (aceita sem cmid), registrar isso.
    6. Marcar em GAME.md §9.2 o ponto "Sem cmid"/4007 + data; evidência em EVIDENCE.md. (O comportamento
       detalhado do WS/shard/kills fica no 3-PLAN.)
  </how-to-verify>
  <resume-signal>Digite "registrado" com §9.1 (refresh/exp) e o ponto 4007 de §9.2 marcados, ou descreva a divergência (input do 4-PLAN).</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operador → `.env` local | Segredos (solver key, senha, tokens) entram só aqui |
| worker → EVIDENCE.md/GAME.md/commit | Saída versionada; não pode conter segredo |
| conta real ↔ sessão viva única | Login concorrente derruba sessão (4005) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-2-01 | Information Disclosure | tokens/senha/solver key em log/EVIDENCE.md/commit | mitigate | `ocultarSegredos` do worker + sanitização manual antes de colar; `.env` fora de `.planning/` e do git; registrar só o fato "tokens mudaram" |
| T-2-02 | Denial of Service (auto) | duas sessões na mesma conta (4005) | mitigate | Uma sessão por conta; alternar worker/navegador com a aba fechada antes de religar |
| T-2-03 | Repudiation/abuse | ban/estado corrompido da conta | accept | Conta descartável (D-03); smoke só observa, não compra/vende/forja cmid |
</threat_model>

<verification>
- GAME.md §9.1 (sitekey, solver aceito, Turnstile sempre ligado, refresh rotaciona, exp, 2FA) e o ponto
  4007 de §9.2 têm marca (confirmado/refutado/não-observável) + data.
- EVIDENCE.md tem um trecho sanitizado por marca; `grep` por token/senha/solver key em EVIDENCE.md e GAME.md não retorna segredo.
</verification>

<success_criteria>
- Está registrado, com evidência, se o `captchaToken` do solver é aceito e se o backend exige captcha em todo login.
- Em recusa, o caminho de tokens colados está documentado como principal (D-02) e o worker cai em needs-login com motivo claro.
- Rotação de refreshToken, `exp` do access e o comportamento de 4007 estão registrados.
- Divergências observadas estão anotadas como input do 4-PLAN (gated por D-08).
</success_criteria>

<output>
Após concluir, criar `.planning/phases/phase-1-validacao-com-conta-real/2-SUMMARY.md`
(listando os pontos de §9.1/4007 marcados e quais divergências alimentam o 4-PLAN).
</output>
