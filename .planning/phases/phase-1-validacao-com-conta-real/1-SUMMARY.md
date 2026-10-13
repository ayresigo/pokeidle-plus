# 1-PLAN — Summary: Instrumentação de kills/capturas

**Executado:** 2026-10-12
**Wave:** 1 (autônomo, não depende do jogo real)
**Status:** Concluído — suíte verde, smoke de runtime OK

## O que foi feito
- `packages/worker/src/health.ts`: `HealthSnapshot` passou a incluir `kills` e `capturas` (obrigatórios, nunca segredos); `HealthState` ganhou os campos (iniciando em 0) e o setter `setContadores({kills, capturas})` com valores absolutos; `snapshot()` publica os dois.
- `packages/worker/src/game/client.ts`: no dispatch (`aoReceber`), `field-kill` agora loga uma linha `worker <accountId>: field-kill <speciesName?> (kills N)` e publica os contadores via `health.setContadores`; `catch-result` com `success:true` loga `worker <accountId>: captura (capturas N)` e publica os contadores (`success:false` não incrementa nem loga). Adicionado `accountId` a `OpcoesClient`, repassado por `criarGameClient(config.accountId)`.
- Testes: `health.test.ts` cobre `setContadores` (valores absolutos) e os snapshots incluem `kills:0/capturas:0`; `client.test.ts` tem novo caso que envia `field-kill`×2 + `catch-result` success/fail, confirma `/health` (kills=2, capturas=1), que o log foi emitido e que **nenhum token** aparece nas linhas de log.

## Verificação
- `pnpm --filter worker test`: **177 passam** (baseline 175 + 2 novos).
- `pnpm --filter worker build` (tsc): limpo.
- Smoke de runtime (sem jogo real, tokens dummy, `GAME_URL` em porta morta): `GET /health` retornou `{"state":"authenticating",...,"kills":0,"capturas":0}` — confirma os contadores expostos em runtime. Worker encerrado por PID da porta (sem prune/filtro).

## Observações
- Nenhum segredo logado: as linhas usam apenas `speciesName` e contadores.
- SC3 agora é observável pelos logs do worker e pelo `/health` durante o smoke real, sem depender de uma sessão paralela de navegador (regra 4005).

## Requisitos
- VAL-04 (pré-condição de observabilidade). Não gated por evidência (Contract do plano).
