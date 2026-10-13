---
phase: 01.1-migrar-worker-para-pokeidle-io
plan: 4
type: execute
wave: 2
depends_on: [2]
files_modified:
  - apps/control-plane/src/app.ts
  - apps/web/components/AccountForm.tsx
  - apps/web/lib/conta.ts
  - apps/web/lib/conta.test.ts
  - e2e/fake-game/server.ts
  - e2e/fake-game/token.ts
  - e2e/smoke.spec.ts
  - README.md
  - apps/central-api/src/root/routes.ts
  - apps/central-api/src/root/root.test.ts
autonomous: true
requirements: [MIG-05]
must_haves:
  truths:
    - "Nenhuma referência FUNCIONAL a poke.idleworld.online sobra no repo (GAME_URL default, UI, e2e, README, raiz)"
    - "A instrução de tokens na UI reflete o formato real do pokeidle.io (token Bearer único)"
    - "O e2e/fake-game imita o protocolo do pokeidle.io (/auth/entrar, hello/welcome, hunt.select/campo.init, batalha/morte, ping/pong) e o worker migrado conecta"
    - "pnpm e2e passa contra o fake-game novo"
  artifacts:
    - path: "e2e/fake-game/server.ts"
      provides: "Jogo falso falando o protocolo pokeidle.io para o E2E"
  key_links:
    - from: "worker migrado (hello/welcome/hunt.select/batalha)"
      to: "e2e/fake-game/server.ts"
      via: "o fake-game responde exatamente os frames que o GameClient espera"
      pattern: "welcome|campo.init|batalha"
---

<objective>
Tirar `poke.idleworld.online`/protocolo antigo de **todo o resto do repo** (MIG-05, SC4) e deixar o
**E2E verde** contra um fake-game que fala `pokeidle.io` (parte de SC6). O worker já foi migrado; o
fake-game ainda fala o protocolo antigo, então o E2E está quebrado hoje.

Purpose: cutover completo do domínio/protocolo fora do worker + E2E funcional.
Output: control-plane default, UI de tokens, fake-game + smoke.spec, README, raiz da central — tudo no pokeidle.io.
</objective>

<context>
@.planning/phases/01.1-migrar-worker-para-pokeidle-io/CONTEXT.md
@.planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md
@apps/control-plane/src/app.ts
@apps/web/components/AccountForm.tsx
@apps/web/lib/conta.ts
@e2e/fake-game/server.ts
@e2e/fake-game/token.ts
@e2e/smoke.spec.ts
@README.md
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: GAME_URL default do control-plane</name>
  <files>apps/control-plane/src/app.ts</files>
  <behavior>`gameUrl` default (`app.ts:70`) passa de `https://poke.idleworld.online` para `https://pokeidle.io`.
    Verificar se há testes do control-plane que fixam o default antigo e ajustá-los.</behavior>
  <action>Trocar o literal; rodar os testes do control-plane que tocam `gameUrl`/montarEnv.</action>
  <verify><automated>pnpm --filter control-plane test</automated></verify>
  <done>Default é pokeidle.io; testes do control-plane verdes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Instrução de tokens na UI (token Bearer único)</name>
  <files>apps/web/components/AccountForm.tsx, apps/web/lib/conta.ts, apps/web/lib/conta.test.ts</files>
  <behavior>
    - `AccountForm.tsx:311-326`: a instrução passa a apontar para `https://pokeidle.io` e a explicar como
      obter o **token Bearer único** no navegador (localStorage do pokeidle.io — chave real confirmada no
      GAME.md/EVIDENCE), em vez de `sessionStorage.getItem('pokeweb:tokens')`.
    - `conta.ts`/`conta.test.ts` `extrairTokens`: conforme D-S6 — se (a) par mantido, aceitar o token único
      e preencher os dois campos com o mesmo valor, com mensagem de erro adaptada; se (b) token único,
      simplificar para um campo. Ajustar os testes para o formato real.
    Decisão em §9/GAME.md: formato de token colado → **adaptado** ao pokeidle.io.
  </behavior>
  <action>Editar copy + extração conforme D-S6; ajustar `conta.test.ts`. Rodar `pnpm --filter web test`.</action>
  <verify><automated>pnpm --filter web test</automated></verify>
  <done>UI instrui o token real do pokeidle.io; extração coberta; web verde.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Reescrever o e2e/fake-game para o protocolo pokeidle.io</name>
  <files>e2e/fake-game/server.ts, e2e/fake-game/token.ts, e2e/smoke.spec.ts</files>
  <behavior>
    O fake-game passa a falar o protocolo que o worker migrado espera:
    - HTTP: `POST /auth/entrar` `{id, senha, turnstileToken, dispositivo}` → `{nick, token, provedor,
      precisaNick:false}`; `GET /auth/provedores` → `{turnstile:"<sitekey-fake>"}`. (Substitui `/api/auth/login`.)
    - WS raw: ao receber `{t:"hello", nick, token, delta:1, dispositivo}` com o token fake válido → `welcome`
      com `estado`; `{t:"hunt.select", slug}` → `{t:"campo.init", slug, mobs, heroi}`; emitir
      `{t:"batalha", ev:[{k:"morte", quem:"selvagem", nome, xp, ouro}]}` periodicamente (gera kills);
      `{t:"ping"}` → `{t:"pong"}`. (Substitui `enter-hunt`/`field-init`/`field-kill`.)
    - Kick/sessão substituída: `POST /__e2e/kick` fecha a sessão do jeito que o smoke precisa validar
      (alinhar com o que o Plan 6 definir como "definitivo"; se ainda gap, usar `close(1000)` + marcar).
    - `token.ts`: gerar/validar o token Bearer único fake (JWT com `exp` para exercitar `lerExpiracao`).
    - `smoke.spec.ts:46-48`: usar o label/campo de token novo (Task 2) e o token fake único.
  </behavior>
  <action>Reescrever server.ts/token.ts; ajustar smoke.spec.ts ao novo fluxo. Não conectar ao jogo real.</action>
  <verify><automated>pnpm e2e</automated> <note>Requer Docker Desktop; regra Docker do projeto. Se o E2E
    depender do Plan 6 para o close "definitivo", rodar após o Plan 6 e deixar o caso de kick marcado.</note></verify>
  <done>fake-game fala pokeidle.io; worker migrado conecta e mata no E2E; `pnpm e2e` verde.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 4: README + raiz da central</name>
  <files>README.md, apps/central-api/src/root/routes.ts, apps/central-api/src/root/root.test.ts</files>
  <behavior>
    - README `:38-43` (extração de token) → passo do pokeidle.io (token Bearer único); `:161` (descrição do
      fake-game) → protocolo novo. `grep -n "idleworld\|pokeweb:tokens\|field-init\|enter-hunt" README.md`
      só sobra em contexto histórico explícito, se houver.
    - Raiz da central (`root/routes.ts`): confirmar que o nome/descrição do jogo está coerente com o
      pokeidle.io (hoje diz "Poke Idle World", sem domínio). Ajustar o texto se o nome real divergir;
      manter o teste `root.test.ts` verde.
  </behavior>
  <action>Atualizar README e, se necessário, o texto da raiz + teste. Rodar `pnpm --filter central-api test`.</action>
  <verify><automated>pnpm --filter central-api test</automated></verify>
  <done>README e raiz coerentes com o pokeidle.io; central verde.</done>
</task>

</tasks>

<threat_model>
| Threat ID | Category | Component | Disposition | Mitigation |
|-----------|----------|-----------|-------------|-----------|
| T-4-01 | Information Disclosure | token/segredo no fake-game ou smoke | mitigate | tokens fake sintéticos; nada real em e2e |
| T-4-02 | Tampering | Docker: remoção por filtro ao rodar E2E | avoid | regra do projeto; remover só `mpw-e2e`/`mpw-worker-<id>` por nome exato |
</threat_model>

<verification>
- `grep -rn "poke.idleworld.online\|idleworld" apps e2e README.md` → vazio (ou só histórico marcado).
- `pnpm --filter control-plane test`, `pnpm --filter web test`, `pnpm --filter central-api test`, `pnpm e2e` verdes.
</verification>

<success_criteria>
- MIG-05 / SC4: nenhuma referência funcional a poke.idleworld.online; UI com o token real.
- Parte de SC6: E2E verde contra o fake-game novo.
</success_criteria>

<output>
Criar `.planning/phases/01.1-migrar-worker-para-pokeidle-io/4-SUMMARY.md` (arquivos migrados; resultado do E2E;
dependência eventual do Plan 6 para o caso de kick).
</output>
