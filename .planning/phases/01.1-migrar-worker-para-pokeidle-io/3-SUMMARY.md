# 3-SUMMARY — MIG-03 (game loop/WS revisado)

**Wave 3, 2026-10-13.** Suíte do worker: **132 testes verdes**; `tsc --noEmit` limpo.

## Task 1 — resíduo de sharding removido (removido-com-evidência)
`config.ts`: removidos `gameWsShards` (interface), `GAME_WS_SHARDS` (env), `DEFAULT_WS_SHARDS=88`
(constante) e a validação do shard. Mantidos `GAME_WS_URL`/`GAME_WS_PATH`/`resolverWsUrl` (override útil do
host/path do WS; default = origem de `GAME_URL` em `wss://`). `config.test.ts`: removidos os casos de
`GAME_WS_SHARDS` (aceite e `it.each` de rejeição); `provider.test.ts`: removido `gameWsShards` do configBase.
`grep "shard|djb2|GAME_WS_SHARDS" src` → vazio. Evidência: pokeidle.io não usa shard (VAL-02/03).

## Task 2 — robustez preservada do client (confirmada)
Revisado `client.ts`; já presente e coberto por `client.test.ts` (22 casos): handshake hello/welcome,
backoff+jitter (teto 24 s → 5 min), heartbeat ping/pong, `invalidarLimitado` ≤1×/5 min, rejeição transitória
(`AuthAdiadaError` → reconecta) vs definitiva (needs-login), drain close 1000, kills por `batalha/morte`,
reconciliação por `estado.dexMud`. Sem divergência → sem edit (o adensamento fica na Wave 5).

## Task 2b — sessao.renovada → tokenHello + health.setTokens (D-S7, implementado)
`client.ts` case `sessao.renovada`: além de trocar `tokenHello`, agora chama
`health.setTokens({accessToken: token, refreshToken: token})`. O write-back do v1.0 (`supervisor.ts`
`verificarTokens`/`onTokensRenovados` → `PUT /accounts/:id/tokens`) propaga à central. Teste novo em
`client.test.ts` ("sessao.renovada troca o token em uso e publica via health.setTokens") com ws local.

## Task 3 — loop/watchdog/drain (confirmado)
`loop.ts` `garantirHunt`/`watchdog-stall`/`drenar` presentes e cobertos por `loop.test.ts` (24 casos).
Watchdog-stall → preservado-adaptado (caminho de 10 min a confirmar no smoke que não dispara à toa).

## Task 4 — gaps de fechamento nomeados (GAME.md §9)
§9 do GAME.md (reescrito na Wave 1) já registra, com destino à wave 6 (gated por smoke):
- close codes / sessão substituída / manutenção → GAP (política conservadora D-S2 wired só com sinais observados);
- reciclagem `restart-freeze`/`restart-resumed` → removido-com-evidência (protocolo antigo);
- backoff escalonado de manutenção → GAP (só se houver sinal próprio);
- VAL-05 (farm offline/soneca) e VAL-06 (`sessao.renovada` ao vivo) → pendentes do smoke.

## Verificação
`pnpm vitest run` (worker) → 132 verdes; `tsc --noEmit` exit 0.
Arquivos: `config.ts`, `config.test.ts`, `auth/provider.test.ts`, `game/client.ts`, `game/client.test.ts`.
