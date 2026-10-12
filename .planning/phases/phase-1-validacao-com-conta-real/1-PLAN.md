---
phase: 1-validacao-com-conta-real
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/worker/src/health.ts
  - packages/worker/src/health.test.ts
  - packages/worker/src/game/client.ts
  - packages/worker/src/game/client.test.ts
autonomous: true
requirements: [VAL-04]
must_haves:
  truths:
    - "Cada field-kill real gera uma linha de log do worker (sem dados sensíveis)"
    - "Cada captura bem-sucedida (catch-result success) gera uma linha de log do worker"
    - "GET /health expõe kills e capturas acumulados da sessão"
    - "O contador de kills/capturas no /health sobe junto com os eventos recebidos"
  artifacts:
    - path: "packages/worker/src/health.ts"
      provides: "HealthSnapshot com kills e capturas; setters correspondentes"
      contains: "kills"
    - path: "packages/worker/src/game/client.ts"
      provides: "Log por field-kill/catch-result e publicação dos contadores no health"
      contains: "field-kill"
    - path: "packages/worker/src/health.test.ts"
      provides: "Teste de kills/capturas no snapshot"
    - path: "packages/worker/src/game/client.test.ts"
      provides: "Teste de log e publicação de contadores ao receber field-kill/catch-result"
  key_links:
    - from: "packages/worker/src/game/client.ts"
      to: "HealthState"
      via: "setter de contadores chamado em field-kill/catch-result"
      pattern: "health\\.(setKills|setContadores|setCapturas)"
---

<objective>
Instrumentar a observabilidade de kills/capturas do worker: logar cada `field-kill`
e cada captura bem-sucedida (sem segredos) e expor os contadores acumulados em
`GET /health`. Hoje `kills`/`capturas` vivem só no `EstadoJogo` interno de
`game/client.ts` (campos `kills`/`capturas`, incrementados nas linhas 546/550), fora
do `HealthSnapshot` e sem log por evento.

Purpose: O Success Criterion 3 da Phase 1 (ROADMAP) exige que os logs do worker
mostrem `field-kill` reais e o contador de kills/capturas subindo. Essa instrumentação
é **pré-condição de VAL-04** e, por isso, **NÃO é gated por evidência** (D-08 só governa
correções de divergência; isto é melhoria de observabilidade requerida pelo Contract).
Rodar antes do smoke garante que o observador consiga evidenciar kills pelos logs/`/health`
sem depender de uma sessão paralela de navegador (impedida pela regra "uma sessão por conta").

Output: `health.ts` e `client.ts` com os contadores logados e expostos, cobertos por teste.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/phase-1-validacao-com-conta-real/CONTEXT.md
@.planning/phases/phase-1-validacao-com-conta-real/1-RESEARCH.md
@packages/worker/src/health.ts
@packages/worker/src/game/client.ts

<interfaces>
De packages/worker/src/health.ts:
```ts
export type WorkerState = "booting" | "authenticating" | "in-game" | "needs-login" | "error";
export interface HealthSnapshot {
  state: WorkerState;
  lastAction: string | null;
  lastError: string | null;
  uptimeSec: number;
  tokens?: Tokens;
}
export class HealthState {
  setState(state: WorkerState): void;
  setLastAction(action: string): void;
  setLastError(error: string | null): void;
  setTokens(tokens: Tokens): void;
  snapshot(): HealthSnapshot;
}
```

De packages/worker/src/game/client.ts (EstadoJogo interno e dispatch):
```ts
export interface EstadoJogo { kills: number; capturas: number; ultimoKill: string | null; /* ... */ }
// GameClient recebe opcoes.health (HealthState) e já chama health.setState/setLastAction/setLastError.
// No switch de aoReceber():
//   case "field-kill": e.ultimoKill = m.speciesName; e.kills += 1;   (linhas ~543-548)
//   case "catch-result": if (m.success === true) e.capturas += 1;    (linhas ~549-551)
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Expor kills/capturas no HealthSnapshot</name>
  <files>packages/worker/src/health.ts, packages/worker/src/health.test.ts</files>
  <behavior>
    - snapshot() inicial retorna kills: 0 e capturas: 0.
    - Após setContadores({ kills: 3, capturas: 1 }), snapshot() retorna kills: 3, capturas: 1.
    - Chamadas repetidas a setContadores refletem sempre o último valor (contadores absolutos, não deltas).
    - Os campos existentes (state, lastAction, lastError, uptimeSec, tokens) seguem no snapshot sem mudança de comportamento.
  </behavior>
  <action>
    Em `health.ts`, adicionar `kills: number` e `capturas: number` ao `HealthSnapshot`
    (campos obrigatórios, nunca segredos). Em `HealthState`, armazenar `kills`/`capturas`
    (iniciando em 0) e expor um setter único `setContadores(c: { kills: number; capturas: number })`
    que grava os valores absolutos; incluir os dois campos no retorno de `snapshot()`.
    Manter o estilo do arquivo (sem comentários em linhas de código). Em `health.test.ts`,
    cobrir o comportamento descrito em <behavior>.
  </action>
  <verify>
    <automated>pnpm --filter worker test health</automated>
  </verify>
  <done>HealthSnapshot inclui kills e capturas; setContadores grava valores absolutos; teste verde.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Logar field-kill/captura e publicar contadores no health</name>
  <files>packages/worker/src/game/client.ts, packages/worker/src/game/client.test.ts</files>
  <behavior>
    - Ao receber field-kill, o worker registra em stdout uma linha com o prefixo `worker <accountId>:` contendo "field-kill", o speciesName (quando presente) e o total acumulado de kills — sem accessToken/refreshToken/identifier/senha/captchaToken.
    - Ao receber catch-result com success:true, o worker registra uma linha de captura com o total acumulado de capturas; catch-result com success:false NÃO incrementa nem loga captura.
    - A cada field-kill/catch-result, client chama health.setContadores com { kills, capturas } atuais de EstadoJogo.
    - Mensagens malformadas (sem speciesName, etc.) não quebram o dispatch (comportamento atual preservado).
  </behavior>
  <action>
    No switch de `aoReceber()` de `client.ts`, nos casos `field-kill` e `catch-result`
    (após incrementar `e.kills`/`e.capturas` como já é feito nas linhas ~543-551), emitir
    um `console.log` seguindo o padrão de log existente do worker (prefixo
    `worker ${this.config.accountId}: ...`, como em `index.ts`/`client.ts`) e chamar
    `this.opcoes.health.setContadores({ kills: e.kills, capturas: e.capturas })`.
    O log de `field-kill` inclui `speciesName` (quando string) e o total de kills; o de
    captura inclui o total de capturas. NUNCA logar tokens, identifier, senha ou captcha
    (a mensagem só usa speciesName e contadores — nenhum desses é segredo). Sem comentários
    em linhas de código. Em `client.test.ts`, adicionar casos que enviam `field-kill` e
    `catch-result` ao client e verificam: (a) `health.snapshot()` reflete os contadores;
    (b) o log foi emitido (espiar `console.log` com vi.spyOn) sem conter segredos.
  </action>
  <verify>
    <automated>pnpm --filter worker test client</automated>
  </verify>
  <done>field-kill e captura geram log sanitizado e atualizam /health via setContadores; testes verdes.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| WS do jogo → worker | Mensagens `field-kill`/`catch-result` cruas entram no dispatch |
| worker → stdout/`/health` | Saída observável pelo operador; não pode vazar segredo |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-1-01 | Information Disclosure | log de field-kill/captura em client.ts | mitigate | Log usa apenas speciesName e contadores; teste assegura ausência de token/identifier/senha na linha emitida |
| T-1-02 | Tampering | campo numérico vindo do WS (speciesName/counts) | mitigate | Mantém as guardas de tipo existentes (`typeof ... === "string"`, `success === true`); mensagem malformada não quebra o dispatch |
</threat_model>

<verification>
- `pnpm --filter worker test health client` verde.
- `GET /health` passa a conter `kills` e `capturas` (inspeção do snapshot no teste).
- Nenhum segredo aparece nas linhas de log novas (assert no teste).
</verification>

<success_criteria>
- `HealthSnapshot` expõe `kills` e `capturas`.
- Cada `field-kill`/captura gera log sanitizado e atualiza o `/health`.
- Suíte do worker continua verde (baseline ≥175, agora com os casos novos).
</success_criteria>

<output>
Após concluir, criar `.planning/phases/phase-1-validacao-com-conta-real/1-SUMMARY.md`.
</output>
