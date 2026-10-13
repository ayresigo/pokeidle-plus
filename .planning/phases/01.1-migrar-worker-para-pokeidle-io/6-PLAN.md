---
phase: 01.1-migrar-worker-para-pokeidle-io
plan: 6
type: execute
wave: 4
depends_on: [1, 2, 3, 4, 5]
gated: true
gate: "Usuário confirma neste terminal que está pronto e fornece a conta descartável (D-S1)"
files_modified:
  - packages/worker/src/game/client.ts
  - packages/worker/src/game/client.test.ts
  - packages/worker/src/game/loop.ts
  - packages/worker/src/game/loop.test.ts
  - packages/worker/GAME.md
  - .planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md
  - k8s/base/kustomization.yaml
autonomous: false
requirements: [MIG-06]
must_haves:
  truths:
    - "Smoke real na conta descartável: login via solver, welcome, kills subindo, drain limpo — registrado em EVIDENCE.md (sanitizado)"
    - "VAL-05 (farm offline / sleep-mode) e VAL-06 (renovação via sessao.renovada; close codes reais) concluídos"
    - "A robustez de fechamento conservadora (D-S2) foi wired SÓ para os sinais que o smoke observou; o não observado ficou como gap documentado em GAME.md §9 (D-S3)"
    - "As observações read-only do 6-PLAN da Phase 1 estão registradas para a Phase 2; nada pago na conta"
    - "E2E verde e release beta com o worker migrado publicada"
  artifacts:
    - path: ".planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md"
      provides: "Evidência sanitizada do smoke do pokeidle.io (VAL-05/06, close codes, sessao.renovada)"
  key_links:
    - from: "sinal observado no smoke (close code / erro / sessao.renovada)"
      to: "packages/worker/src/game/client.ts + teste"
      via: "cada wiring de robustez é disparado por evidência (D-S3); sem evidência = gap"
      pattern: "describe|it|test"
---

<objective>
Fechar MIG-06 (SC5/SC6): **smoke real** na conta descartável, **concluir VAL-05/VAL-06**, **wire a
robustez de fechamento conservadora (D-S2) apenas para os sinais observados (D-S3)**, registrar as
**observações read-only da Phase 2**, deixar o **E2E verde** e **publicar a release beta** com o worker
migrado. **Nada pago na conta.**

GATE (D-S1): esta wave só executa quando o usuário confirmar neste terminal que está pronto e fornecer a
conta descartável. O coordenador avisa.

Purpose: provar o worker migrado contra o jogo real e fechar os gaps de robustez com evidência.
Output: EVIDENCE.md atualizado; close/error conservador wired para o observado; §9 fechado; E2E verde; beta.
</objective>

<execution_context>
Conexão real: `pnpm --filter @pokeidle/worker start` com env no ambiente (`SOLVER_KEY`, `POKEIDLE_USER`/
`PASS`, `GAME_URL=https://pokeidle.io`, `HUNT_SLUG=bellsprout`, `DISPOSITIVO`); observar via
`curl http://127.0.0.1:3001/health`. VAL-05 repetido com worker em container e `docker stop` real.
Segredos só no `.env` local (ignorado). Nada de compra/venda/cura. Regra Docker do projeto.
</execution_context>

<context>
@.planning/phases/01.1-migrar-worker-para-pokeidle-io/CONTEXT.md
@.planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md
@.planning/phases/phase-1-validacao-com-conta-real/6-PLAN.md
@packages/worker/GAME.md
@packages/worker/src/game/client.ts
@packages/worker/src/game/loop.ts
</context>

<tasks>

<task type="human" tdd="false">
  <name>Task 1: Smoke real — login/welcome/kills/drain (VAL smoke)</name>
  <files>.planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md</files>
  <behavior>
    Com a conta descartável e `HUNT_SLUG=bellsprout`: rodar o worker; observar `authenticated via solver`,
    `welcome` → `in-game`, contador de kills subindo no `/health`, `lastError:null`, watchdog não disparando
    à toa; drain via SIGTERM/`docker stop` fecha limpo (close 1000). Registrar trechos sanitizados em
    EVIDENCE.md (sem token/senha/chave).
  </behavior>
  <action>Executar sob confirmação do usuário (D-S1). Capturar frames crus relevantes (sanitizados).</action>
  <verify><manual>`/health` mostra in-game + kills crescentes; drain sem erro.</manual></verify>
  <done>Smoke de login→kills→drain registrado em EVIDENCE.md.</done>
</task>

<task type="human" tdd="false">
  <name>Task 2: VAL-05 (farm offline / sleep-mode) e VAL-06 (renovação / close codes)</name>
  <files>.planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md</files>
  <behavior>
    - VAL-05: medir baseline (kills/saldo), `docker stop`, esperar uma janela, reabrir só para LER o estado,
      comparar. Observar se há Modo Soneca/`sleep`-equivalente no pokeidle.io e se o drain atual (close 1000)
      mantém o farm offline. Se não mantiver, registrar o sinal necessário (ex.: comando de soneca) — a
      implementação vai para a Task 4 se observada.
    - VAL-06: observar a renovação de sessão (`sessao.renovada`: formato, periodicidade) e **quais close
      codes / chaves de `erro` o pokeidle.io realmente usa** (sessão substituída logando em outro lugar;
      manutenção, se ocorrer). Nada forçado que exija gasto.
  </behavior>
  <action>Executar sob confirmação; registrar em EVIDENCE.md cada sinal observado (sanitizado) e marcar o
    não observável como tal.</action>
  <verify><manual>EVIDENCE.md tem VAL-05/06 com veredito e os sinais de fechamento/renovação observados.</manual></verify>
  <done>VAL-05 e VAL-06 concluídos (confirmado/refutado/não-observável) com evidência.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Observações read-only para a Phase 2</name>
  <files>.planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md</files>
  <behavior>
    Na mesma sessão, SÓ ler/registrar (sem gastar): formato cru de `estado`(xp/gold/items/dexMud/pkMud),
    `batalha`, `campo`, `coins`, `nivel`, `capturas`, `sessao.renovada`; fonte dos campos do dashboard;
    comandos de cura (`centro.curar`) e compra/venda (`shop.*`/`loja.*`) só mapeados; catálogos estáticos
    se públicos. Cobrir o checklist do 6-PLAN da Phase 1.
  </behavior>
  <action>Registrar em EVIDENCE.md a seção "Observações read-only p/ Phase 2". Nenhuma ação paga.</action>
  <verify><manual>Seção read-only preenchida; checklist do 6-PLAN coberto.</manual></verify>
  <done>Observações da Phase 2 registradas; limite de "nada pago" respeitado.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Wire da robustez de fechamento — SÓ o observado (D-S2/D-S3)</name>
  <files>packages/worker/src/game/client.ts, packages/worker/src/game/client.test.ts, packages/worker/src/game/loop.ts, packages/worker/src/game/loop.test.ts, packages/worker/GAME.md</files>
  <behavior>
    Para cada sinal que o smoke OBSERVOU, implementar o tratamento conservador:
    - Sessão substituída / bloqueio definitivo → `needs-login`/`error` SEM reconectar (usar o estado `error`
      hoje nunca setado; `aoFechar`/`aoErro` passam a classificar terminal vs transitório pelo sinal real).
    - Manutenção observada → backoff escalonado (5/10/15 min) só se houver sinal próprio; senão o backoff
      genérico cobre.
    - `sessao.renovada` → se VAL-06 mostrar formato diferente, ajustar `tokenHello`/agendamento.
    - VAL-05 → se o farm offline exigir soneca, implementar no drain (`desconectar` envia o comando e espera
      o ack antes de `close(1000)`, dentro do timeout de 20 s).
    Cada wiring vem com teste reproduzindo o frame/close real (sanitizado). O que o smoke NÃO observou fica
    como **gap documentado** em GAME.md §9 (não se inventa — D-S3).
  </behavior>
  <action>Editar client.ts/loop.ts só para os sinais observados; teste por sinal; atualizar §9 (restaurado/
    adaptado/removido-com-evidência/gap). Rodar `pnpm --filter @pokeidle/worker test`.</action>
  <verify><automated>pnpm --filter @pokeidle/worker test</automated></verify>
  <done>Robustez de fechamento wired só para o observado, com teste; gaps documentados em §9; suíte verde.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 5: E2E verde + alinhar o kick do fake-game</name>
  <files>e2e/fake-game/server.ts, e2e/smoke.spec.ts</files>
  <behavior>Se a Task 4 definiu como o pokeidle.io sinaliza sessão substituída, alinhar `POST /__e2e/kick`
    do fake-game (Plan 4) a esse sinal, para o E2E exercitar o caminho "definitivo → needs-login sem
    reconectar". Rodar o E2E completo.</behavior>
  <action>Ajustar o kick se necessário; `pnpm e2e` (Docker Desktop; regra Docker do projeto — remover só
    `mpw-e2e`/`mpw-worker-<id>` por nome exato).</action>
  <verify><automated>pnpm e2e</automated></verify>
  <done>E2E verde contra o fake-game com o sinal de kick alinhado ao real.</done>
</task>

<task type="human" tdd="false">
  <name>Task 6: Release beta com o worker migrado</name>
  <files>k8s/base/kustomization.yaml</files>
  <behavior>Publicar uma release beta com o worker migrado (workflow de release existente, canal beta).
    Atualizar `newTag` se aplicável. O deploy/`kubectl apply` e qualquer publicação exigem **confirmação
    explícita do usuário** (não é automático).</behavior>
  <action>Disparar a release beta conforme o processo do projeto, com aprovação do usuário. Sem alterar o
    cluster sem confirmação.</action>
  <verify><manual>Release beta publicada; worker migrado na imagem beta.</manual></verify>
  <done>Release beta com o worker migrado disponível, com aprovação do usuário.</done>
</task>

</tasks>

<threat_model>
| Threat ID | Category | Component | Disposition | Mitigation |
|-----------|----------|-----------|-------------|-----------|
| T-6-01 | Information Disclosure | token/senha/chave em EVIDENCE.md ou log | mitigate | só trechos sanitizados; segredos só no `.env` local |
| T-6-02 | DoS/abuse | brigar por sessão com a conta real | avoid | conta descartável; uma sessão por conta; smoke não concorre |
| T-6-03 | Elevation | gasto não autorizado na conta | avoid | hard limit "nada pago"; só observar compra/venda/cura |
| T-6-04 | Tampering | Docker: remoção por filtro/prune | avoid | remover só `mpw-e2e`/`mpw-worker-<id>` por nome exato |
</threat_model>

<verification>
- EVIDENCE.md com smoke + VAL-05/06 + observações read-only, sanitizado.
- `pnpm --filter @pokeidle/worker test` e `pnpm e2e` verdes.
- GAME.md §9 fechado (cada ponto confirmado/refutado/não-observável/gap).
- Release beta publicada com aprovação do usuário.
</verification>

<success_criteria>
- MIG-06 / SC5: smoke real ok; VAL-05/06 concluídos; observações read-only registradas; nada pago.
- SC6: E2E verde + release beta com o worker migrado.
- SC2 (fechamento): robustez conservadora wired só para o observado; resto como gap documentado.
</success_criteria>

<output>
Criar `.planning/phases/01.1-migrar-worker-para-pokeidle-io/6-SUMMARY.md` (vereditos do smoke; o que foi wired
vs gap; estado do E2E; release beta).
</output>
