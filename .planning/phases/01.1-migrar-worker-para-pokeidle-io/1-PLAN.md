---
phase: 01.1-migrar-worker-para-pokeidle-io
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/worker/GAME.md
autonomous: true
requirements: [MIG-01]
must_haves:
  truths:
    - "GAME.md descreve o protocolo do pokeidle.io como fonte única (auth, WS, eventos, comandos, close codes observados)"
    - "O material do poke.idleworld.online sai ou fica num apêndice claramente marcado como histórico"
    - "§9 vira os pontos de verificação do pokeidle.io, com VAL-01..04 confirmados e VAL-05/06 + close codes como pendentes do smoke"
  artifacts:
    - path: "packages/worker/GAME.md"
      provides: "Fonte única do protocolo pokeidle.io para o módulo game/ e para a Phase 2"
  key_links:
    - from: "EVIDENCE.md (mapa do protocolo real)"
      to: "packages/worker/GAME.md (seções reescritas)"
      via: "cada afirmação factual do GAME.md cita a fonte (EVIDENCE.md VAL-01..04 ou código)"
      pattern: "pokeidle.io"
---

<objective>
Reescrever `packages/worker/GAME.md` para que o **protocolo do `pokeidle.io`** seja a fonte única
(MIG-01, SC1). Hoje o documento descreve `poke.idleworld.online` com um banner de aviso no topo; o
conteúdo real do `pokeidle.io` está espalhado entre o banner, o §9 e `EVIDENCE.md`.

Purpose: deixar o protocolo real consolidado e confiável, para o game loop e a Phase 2.
Output: GAME.md reescrito; material antigo removido ou em apêndice "Histórico (poke.idleworld.online)".
</objective>

<context>
@.planning/phases/01.1-migrar-worker-para-pokeidle-io/CONTEXT.md
@.planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md
@packages/worker/GAME.md
@packages/worker/src/game/client.ts
@packages/worker/src/auth/provider.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Reescrever o corpo do GAME.md para o pokeidle.io</name>
  <files>packages/worker/GAME.md</files>
  <behavior>
    O topo deixa de ter "banner de correção" e passa a descrever o jogo real diretamente:
    - §1 Alvo: `https://pokeidle.io` (nome do jogo conforme observado). O bloco de `poke.idleworld.online`
      vira um apêndice "Histórico — deployment antigo (poke.idleworld.online)" ou é removido; nada no corpo
      principal afirma algo do servidor antigo como se fosse o atual.
    - Auth: `POST /auth/entrar` `{id, senha, turnstileToken, dispositivo}` → `{nick, token, provedor,
      precisaNick, termosVersao}`; token Bearer único (onde o navegador o guarda — localStorage — para o
      fluxo de token colado); sitekey dinâmica em `GET /auth/provedores.turnstile`; solver 2captcha aceito
      (VAL-01, HTTP 200); sem endpoint REST de refresh (renovação via WS `sessao.renovada`).
    - WS: `new WebSocket(wss://pokeidle.io)` raw (sem shard, sem `?token`, sem `cmid`); handshake
      `{t:"hello", nick, token, delta:1, dispositivo}` → `welcome` (traz `estado`); keepalive `{t:"ping"}`/
      `{t:"pong"}`; fechamento limpo `close(1000)`.
    - Vocabulário: enviados `hunt.select`, `centro.curar`, `shop.*`/`loja.*`, `team.*`, etc.; recebidos
      `welcome`, `campo.init`, `campo`, `batalha` (ev[].k: `ataque`/`morte`/`captura`/`spawn`/`aviso`/`hunt`),
      `estado` (xp/gold/items/dexMud/pkMud), `sessao.renovada`, `erro`. Kill = `batalha` com
      `ev[].k==='morte' && quem==='selvagem'`. HUNT_SLUG correto `bellsprout` (dois L).
    - §5 Loop idle: adaptado ao vocabulário real (escolher hunt via `hunt.select`, auto-batalha do herói,
      cura via `centro.curar`, interrupções a confirmar).
  </behavior>
  <action>
    Reescrever as seções do GAME.md citando a fonte ao lado de cada afirmação (EVIDENCE.md VAL-01..04 ou o
    arquivo/linha do código). Marcar como `[INFERENCE]` o que não foi observado. Não inventar close codes
    nem eventos não vistos. Sem segredos. Sem comentários em linhas de código (N/A, é doc).
  </action>
  <verify>
    <manual>Ler o GAME.md de ponta a ponta: nenhuma afirmação do corpo principal descreve
    poke.idleworld.online como atual; cada fato tem fonte; `grep -n "idleworld" GAME.md` só aparece no
    apêndice histórico (se mantido).</manual>
  </verify>
  <done>Corpo do GAME.md descreve só o pokeidle.io; antigo em apêndice/removido; fontes presentes.</done>
</task>

<task type="auto">
  <name>Task 2: Reestruturar §9 como pontos de verificação do pokeidle.io</name>
  <files>packages/worker/GAME.md</files>
  <behavior>
    §9 passa a listar os pontos de verificação do pokeidle.io, cada um com status:
    - CONFIRMADO (data + evidência): solver aceito no login (VAL-01); handshake hello/welcome sem cmid/shard
      (VAL-02/03); `hunt.select`→`campo.init` (VAL-03); kills via `batalha/morte`, contador via `dexMud`
      (VAL-04).
    - PENDENTE DO SMOKE (MIG-06): VAL-05 (farm offline / `sleep-mode`), VAL-06 (renovação via
      `sessao.renovada`), close codes / sinal de sessão substituída / sinal de manutenção reais, reciclagem.
    Cada ponto de robustez (D-S2/D-S3) ganha uma linha: **restaurado / adaptado / removido-com-evidência /
    gap a fechar**, a ser atualizada pelo 6-PLAN após o smoke.
  </behavior>
  <action>
    Substituir o §9 atual (que mistura o smoke do servidor errado) por essa estrutura. Preservar os
    vereditos já confirmados (com data). Deixar explícito o que falta observar.
  </action>
  <verify>
    <manual>§9 tem cada ponto com status confirmado/pendente; os pendentes batem com o escopo do 6-PLAN.</manual>
  </verify>
  <done>§9 reflete o estado real (confirmado vs pendente) e serve de checklist para o smoke.</done>
</task>

</tasks>

<verification>
- `grep -n "poke.idleworld.online\|idleworld" packages/worker/GAME.md` só retorna linhas do apêndice histórico.
- Cada seção reescrita cita fonte (EVIDENCE.md VAL-xx ou arquivo:linha).
</verification>

<success_criteria>
- MIG-01 / SC1: GAME.md é a fonte única do protocolo pokeidle.io; antigo removido/histórico.
</success_criteria>

<output>
Criar `.planning/phases/01.1-migrar-worker-para-pokeidle-io/1-SUMMARY.md` (seções reescritas; o que virou
histórico; pontos de §9 pendentes do smoke).
</output>
