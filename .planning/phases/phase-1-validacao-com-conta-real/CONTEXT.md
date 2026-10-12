# Phase 1: Validação com conta real - Context

**Gathered:** 2026-10-12
**Status:** Ready for planning
**Source:** Discuss interativo com o usuário (modo interactive)

## Phase Boundary

Esta fase **confirma ou refuta, com evidência em sessão real**, cada ponto de
`packages/worker/GAME.md` §9 (auth §9.1 e game loop §9.2) e ajusta o worker ao
comportamento observado. Entrega desta etapa de planejamento: este CONTEXT.md e
os PLAN(s). A execução contra o jogo real (`poke.idleworld.online`) é a etapa
seguinte, despachada no mesmo terminal quando o usuário confirmar que está pronto
e com qual conta.

Dentro do escopo:
- Smoke manual guiado contra o jogo real com uma conta do usuário.
- Marcar cada item de §9 como **confirmado / refutado / não-observável**, com data
  e evidência sanitizada (trecho de log, mensagem WS ou resposta HTTP — sem tokens,
  sem senhas, sem a chave do solver).
- Transformar cada divergência observada em correção em `packages/worker/src`,
  coberta por teste que reproduz o comportamento real, com a suíte verde.

Fora do escopo (fixado pelo roadmap / decisões, não se discute aqui):
- `apps/central-api`, `apps/control-plane`, `apps/web`: intocados.
- Comprar/vender qualquer coisa na conta real (AUTO-* é Phase 2).
- Forjar `cmid`/fingerprint de máquina (D-10): 4007 é bloqueio a registrar, não alvo de contorno.
- Políticas de autoplay (hunt/compras/vendas/horários/eventos): saem do discuss da Phase 2.
- Deploy/k8s.

## Constraints de execução (segurança)

- **Não conectar ao jogo real sem o usuário dizer explicitamente, neste terminal,
  que está pronto e qual conta usar.**
- **Uma sessão viva por conta** (logar em outro lugar → close 4005). Só um worker por
  conta por vez; smoke não concorre com outra sessão da mesma conta.
- **Nunca logar nem commitar** tokens, senhas ou a chave do solver 2captcha. A chave
  entra só via `SOLVER_KEY` no ambiente (preferencialmente um `.env` local já ignorado
  pelo git), nunca em `.planning/` nem em arquivo versionado.
- Regra Docker do projeto: nada de `prune` nem remoção por filtro/`xargs`; remover só,
  por nome exato, o que esta sessão criar.

## Implementation Decisions

### Autenticação / VAL-01
- **D-01 (Solver será testado):** o usuário tem chave 2captcha. VAL-01 observa o
  caminho completo `solver → POST /api/auth/login` (`SOLVER_KEY` + `POKEIDLE_USER`/
  `POKEIDLE_PASS`) **e** o fallback de tokens colados (`pokeweb:tokens` extraído do
  navegador → `ACCESS_TOKEN`/`REFRESH_TOKEN`). — Rationale: a pergunta central do §9.1
  é se o backend aceita o `captchaToken` gerado no IP do solver (`remoteip`); só dá
  para responder com uma chave real.
- **D-02 (Fallback é caminho principal se o solver for recusado):** se o login recusar
  o token do solver, registra-se o `lastError` e a conta passa a entrar pelos tokens
  colados, que viram o caminho principal documentado em GAME.md §9.1.

### Conta / rede
- **D-03 (Conta descartável):** a validação usa uma conta nova, criada só para isto.
  Rationale: se algo der errado (ban, 4007, estado corrompido) não afeta a conta de
  jogo do usuário. As credenciais só são fornecidas na execução.
- **D-04 (Sem proxy):** conecta pelo IP local (`PROXY_URL` vazio). Nota de teste: o
  token do solver vem do IP do solver, não do IP local — é exatamente o que VAL-01 verifica.

### Como rodar o worker
- **D-05 (Direto para observar, Docker no drain):** a maioria dos testes roda via
  `pnpm start` no pacote worker (`packages/worker`) com as env vars no ambiente, para
  logs diretos no terminal. VAL-05 (drain / farm offline) é repetido com o worker em
  container e `docker stop` real, para exercitar o SIGTERM de produção (o mesmo handler
  atende SIGINT/SIGTERM, mas o caminho de produção é `docker stop`).

### Hunt
- **D-06 (HUNT_SLUG fixo):** a validação fixa `HUNT_SLUG` numa hunt que o personagem
  aguenta, para `field-kill` subir rápido e deixar VAL-04 claro. O slug é informado na
  execução. O auto-pick por map-markers fica registrado como caminho alternativo, mas
  não é o alvo principal do smoke.

### Registro de evidência
- **D-07 (Dupla trilha de evidência):** cada ponto de §9 é marcado **no próprio
  `packages/worker/GAME.md`** (confirmado/refutado/não-observável + data) e os trechos
  de evidência sanitizados ficam em
  `.planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md`. GAME.md é a fonte de
  verdade do protocolo (fica com o código); EVIDENCE.md guarda os trechos de log/WS/HTTP
  que embasam cada marca. Nenhum dos dois contém segredo.

### Correções e testes (VAL-07)
- **D-08 (Correção só sob evidência, com teste real):** divergência observada vira edit
  em `packages/worker/src` + teste em `client.test.ts` / `provider.test.ts` / `loop.test.ts`
  (ou `refresh.test.ts`/`solver.test.ts`) que reproduz o comportamento real observado, não
  o comportamento presumido. Suíte inteira verde ao fim (baseline atual: 175 testes).

## Existing Code Insights

### Reusable Assets
- `packages/worker/src/config.ts` → `loadConfig(env)`: já expõe todas as env vars do
  smoke: `ACCOUNT_ID`, `GAME_URL`, `ACCESS_TOKEN`/`REFRESH_TOKEN`, `SOLVER_KEY`,
  `POKEIDLE_USER`/`POKEIDLE_PASS`, `PROXY_URL`, `HEALTH_PORT`, `SOLVER_API_URL`,
  `TURNSTILE_SITEKEY`, `GAME_WS_URL`, `GAME_WS_PATH`, `GAME_WS_SHARDS`, `HUNT_SLUG`.
- `packages/worker/src/health.ts` → `HealthState` + `startHealthServer`: o `/health`
  (porta `HEALTH_PORT`, default 3001) expõe `state`/`lastError` — é como observar o
  estado da conta durante o smoke sem depender só dos logs.
- `packages/worker/src/index.ts`: entrypoint que monta auth → game client → loop e trata
  SIGTERM/SIGINT com `drenar(...)` (timeout 20s). É o processo que o smoke roda.
- `packages/worker/src/auth/` (provider, solver, refresh) e `packages/worker/src/game/`
  (client, loop): lógica de §9.1 e §9.2 que o smoke exercita.
- Fixtures em `src/auth/__fixtures__/` (`jwt.ts`, `login.html`, `login-chunk.txt`) e padrão
  de teste com vitest já estabelecido — correções de VAL-07 seguem esse padrão.

### Established Patterns
- Caminhos de auth mutuamente exclusivos no config: `SOLVER_KEY` exige `POKEIDLE_USER`/`PASS`;
  `ACCESS_TOKEN` exige `REFRESH_TOKEN`; sem nenhum → erro de config. O smoke usa os dois
  caminhos em execuções separadas.
- Close codes já tratados no client: 4001 (auth, invalida ≤1x/5min), 4005/4008/4009 →
  needs-login, 4006/4007 → error, 4003 → backoff de manutenção, todos sem reconectar em loop.
  O smoke confirma 4005-4009 em produção (§9.2 / VAL-06).
- Shard = djb2(`sub` do JWT) % `GAME_WS_SHARDS` (default 88). VAL-03 compara com o shard do navegador (DevTools → Network → WS).
- Sem comentários em linhas de código; commits conventional em PT-BR; só nesta branch.

## Specific Ideas
- O `/health` do worker é o painel de observação do smoke: `curl http://127.0.0.1:3001/health`
  mostra `state` (`running`/`needs-login`/`error`) e `lastError`, úteis para VAL-01/02.
- Para VAL-05 (farm offline), medir um baseline (kills/capturas ou saldo) com a sessão viva,
  parar via `docker stop`, esperar uma janela, e reabrir só para ler o estado (sem jogar),
  comparando o progresso. A mecânica exata (e se precisa de `sleep-mode`) é o que o plano
  detalha e o smoke decide.
- Capturar as mensagens WS cruas (formato de `field-kill`/`catch-result`/`analyzer`) é
  evidência direta para VAL-04 e para o formato dos eventos de §9.2.

## Observações read-only para a Fase 2 (autoplay)
A discussão da Fase 2 (`.planning/phases/02-autoplay/02-CONTEXT.md`, integrada da main) deixou
pontos "(condicional à Fase 1)" que são observação pura de protocolo e cabem na MESMA sessão de
smoke, sem o worker comprar/vender/curar nem gastar gold. Cobertos pelo `6-PLAN.md`:
- Fonte dos campos do dashboard via `GET /api/characters/me` (02-CONTEXT D-20).
- Formato cru de `analyzer`/`balls`/`pokes`/`poke-xp` para os cards de sessão (D-19/D-23) e critério de pokémon fraco/duplicado (D-11).
- Mecanismo de cura em `field-teleport-city` e endpoints de compra de potion / venda de pokémon — **só mapear** (D-07/D-11/D-14).
- Catálogos estáticos `items.json` (`npcPrice`) e `creatures.json` para whitelist de venda (D-08) e hunt otimizada (D-01).
Limite duro: nenhuma ação paga na conta real nesta fase; o que exigir gasto fica marcado não-observável e vai para a Fase 2.

## Deferred Ideas
- Políticas de hunt/compra/venda, rotina diária, Modo Soneca como comportamento autônomo:
  **Phase 2 (AUTO-*)**. Aqui só observamos o `sleep-mode` o suficiente para VAL-05.
- Run de aceite de 24 h com até 4 contas: **Phase 2 (AUTO-06)**.
- Rate limit / logger na central, canais de release, E2E no CI: backlog v2.
