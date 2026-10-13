# Phase 01.1: Migrar worker para pokeidle.io - Context

**Gathered:** 2026-10-13
**Status:** Ready for planning
**Source:** `/gsd-discuss-phase 01.1` interativo com o usuário (modo interactive), no worktree `migracao-pokeidle-io` (branch `ayresigo/migracao-pokeidle-io`, partindo de `ayresigo/validacao-real` já com `merge main`).

## Phase Boundary

O worker passa a funcionar contra o jogo que o usuário realmente joga, `https://pokeidle.io`,
com a mesma robustez revisada no v1.0, e **nenhuma** parte do sistema aponta mais para
`poke.idleworld.online`. Esta fase **parte da reescrita** já feita na validação (commits
`9750cd8` e `06341ed`), revisa-a arquivo a arquivo, restaura/adapta a robustez que foi
removida sem verificação (ou a remove com evidência), recupera a cobertura de testes,
migra o domínio/protocolo no repo inteiro e fecha com um smoke real na conta descartável.
Cobre MIG-01..MIG-06 e os 6 Success Criteria do ROADMAP §"Phase 01.1".

Dentro do escopo:
- Revisão e correção de `packages/worker/src` (auth + game loop) sobre o protocolo real.
- `packages/worker/GAME.md` como fonte única do protocolo `pokeidle.io`.
- Migração de domínio/protocolo fora do worker: `GAME_URL` do control-plane, instrução de
  tokens na UI (`apps/web`), `e2e/fake-game` + `e2e/smoke.spec.ts`, README, página raiz da central.
- Recuperação da suíte de testes do worker ao nível do v1.0.
- Smoke real na conta descartável (MIG-06), gated por confirmação do usuário, fechando VAL-05/VAL-06
  e registrando as observações read-only do 6-PLAN da Phase 1 para a Phase 2.
- Release beta com o worker migrado.

Fora do escopo (fixado pelo roadmap / decisões):
- Políticas de autoplay (hunt/compras/vendas/horários/eventos): Phase 2 (`02-CONTEXT.md`, 26 decisões).
- Persistência do estado desejado do supervisor e write-back de tokens à central (SUP-01/SUP-02): Phase 2.
- Forjar `cmid`/fingerprint de máquina (D-10). No pokeidle.io não há `cmid`; nada a contornar.
- Qualquer ação paga na conta real (comprar/vender). Hard limit em MIG-06.
- Registro de conta do zero (ACC-01): backlog.

## Constraints de execução (segurança)

- **Não conectar ao jogo real sem o usuário dizer explicitamente, neste terminal, que está pronto
  e qual conta usar** (D-S1). O smoke (MIG-06) é a última wave e só roda sob confirmação.
- **Uma sessão viva por conta** (o jogo derruba a sessão anterior). Só um worker por conta por vez;
  o smoke não concorre com você jogando na mesma conta.
- **Nunca logar nem commitar** tokens, senhas ou a chave do solver 2captcha. Segredos só via env
  (`.env` local já ignorado pelo git), nunca em `.planning/` nem em arquivo versionado.
- Regra Docker do projeto: nada de `prune` nem remoção por filtro/`xargs`; remover só, por nome
  exato, o que esta sessão criar. Repassar a regra a todo subagente que tocar em Docker.
- Kubernetes: nenhum comando que altere o cluster. Não fazer merge/push na main.

## Implementation Decisions

### Smoke real / MIG-06
- **D-S1 (Conta descartável, gated por aviso):** o smoke real contra `pokeidle.io` (login via solver →
  `welcome` → kills subindo → drain limpo; + VAL-05/VAL-06; + observações read-only da Phase 2) é a
  **última wave** e só executa quando o usuário confirmar neste terminal e fornecer a conta descartável
  (a mesma da validação). Nada pago na conta. — Rationale: evita brigar por sessão e protege a conta real.

### Sessão derrubada / robustez de fechamento
- **D-S2 (Conservador — parar sem reconectar):** quando o `pokeidle.io` sinalizar derrubada **definitiva**
  (sessão substituída, bloqueio), o worker vai para `needs-login` ou `error` e **não reconecta em loop**,
  como o v1.0. Só sinal **transitório** (queda comum, manutenção) reconecta com backoff. Isso **restaura**
  o tratamento diferenciado de fechamento/erro que a reescrita removeu (hoje `aoFechar` reconecta para
  qualquer código e o estado `error` nunca é usado).

### O que restaurar da robustez / evidência
- **D-S3 (Só restaurar o que o smoke confirmar):** os **sinais concretos** de que o `pokeidle.io` usa para
  derrubada/manutenção/renovação (close codes, chaves de `erro`, eventos) **não foram observados** e **não
  serão deduzidos lendo o bundle** nesta fase. O mecanismo conservador (D-S2) é implementado, mas o
  **mapeamento sinal→estado** é preenchido com o que o smoke (MIG-06) observar. Cada item da robustez é
  marcado em `GAME.md` §9 como **restaurado / adaptado / removido-com-evidência / gap a fechar depois**.
  O que o smoke não exercitar fica como **gap documentado** (não se inventa close code nem evento).

### Reconexão / limites
- **D-S4 (Manter os limites atuais):** backoff `1,5 s·2^(n−1)` com teto 24 s nas 5 primeiras falhas, depois
  teto 5 min, com jitter; heartbeat ping a 45 s de silêncio / timeout 15 s; watchdog-stall 10 min → 1 h
  após 3 recuperações. O backoff escalonado de manutenção (5/10/15 min) só é adicionado se o smoke mostrar
  um sinal de manutenção próprio; senão o backoff genérico cobre (D-S3).

### Correção do inventário de robustez (evidência de código)
- **D-S5:** o inventário da tarefa listava `invalidar` 1×/5 min como "removido sem verificação", mas o
  código **tem** (`INTERVALO_MINIMO_INVALIDAR_MS = 5min`, `client.ts:66`; `invalidarLimitado`). Logo esse
  item é **preservado** — a fase apenas **verifica + cobre com teste**, não restaura. O plano trata cada
  item pela realidade do código, não pela lista.

### Modelo de token (DECIDIDO — opção (a))
- **D-S6 (aprovado pelo usuário, 2026-10-13 — opção (a)):** o `pokeidle.io` emite **um único token Bearer**
  (`/auth/entrar` → `{token}`), guardado no navegador (localStorage), e renova pelo WS (`sessao.renovada`),
  sem endpoint REST de refresh. **Decisão: manter o par interno** `accessToken/refreshToken` no worker
  (`refreshToken = token`); a **UI passa a pedir o token único** do pokeidle.io e o worker/extração preenche
  os dois campos com o mesmo valor. Menor blast radius; nada muda no schema da central nem na config do
  worker. **Token único ponta a ponta** (schema da central com um campo, UI com um campo, config) vai para o
  **backlog** (ver Deferred).

### Write-back do token renovado (DECIDIDO — escopo v1.0, não Phase 2)
- **D-S7 (coordenador, 2026-10-13):** ao receber `sessao.renovada`, o worker **troca o token em uso**
  (`tokenHello`) **e chama `health.setTokens({accessToken: token, refreshToken: token})`**. O write-back à
  central **já existe desde o v1.0**: o supervisor do control-plane lê `tokens` do `/health`
  (`supervisor.ts` `verificarTokens`/`onTokensRenovados`) e faz `PUT /accounts/:id/tokens`. Logo isto é
  **escopo desta fase (wave 3)**, não Phase 2 — com teste usando servidor ws local. (A renovação proativa
  por `exp` no `AuthManager` continua levando a re-login via solver quando o access expira sem um
  `sessao.renovada` recente.)

## Existing Code Insights

### Estado atual da reescrita (packages/worker/src) — PRESENTE vs AUSENTE vs RESÍDUO

**PRESENTE (preservado/adaptado ao pokeidle.io):**
- `game/client.ts` — WS raw `wss://pokeidle.io` (sem sharding/`?token`/`cmid`); handshake
  `{t:"hello", nick, token, delta:1, dispositivo}` → `welcome` (`aoAbrir`/`aoWelcome`); heartbeat
  ping/pong 45s/15s (`armarHeartbeat`); backoff+jitter com teto longo 5 min (`reconectarComBackoff`,
  `FALHAS_ATE_TETO_LONGO=5`, `TETO_LONGO_MS`); `invalidar` 1×/5 min (`invalidarLimitado`,
  `INTERVALO_MINIMO_INVALIDAR_MS`); transitório vs definitivo na rejeição de token
  (`tratarHelloRecusado` + `AuthAdiadaError` → reconecta; senão needs-login); drain close 1000
  (`desconectar`); kills via `batalha/morte quem:selvagem` (`processarBatalha`/`registrarKill`);
  reconciliação por `estado.dexMud` (`processarEstado`); `sessao.renovada` atualiza `tokenHello`.
- `game/loop.ts` — `garantirHunt` (`hunt.select` + prazo `campo.init`), `watchdog-stall`
  10 min → 1 h (`STALL_MS`/`STALL_ESPACADO_MS`/`MAX_RECUPERACOES_RAPIDAS`), `drenar()`.
- `auth/provider.ts` — login `/auth/entrar` `{id, senha, turnstileToken, dispositivo}`
  (`loginComCaptcha`), sitekey dinâmica `GET /auth/provedores` (`buscarSitekey`), solver 2captcha,
  `AuthManager` com renovação proativa por `exp` do JWT, `ocultarSegredos` em logs.
- `index.ts` — SIGTERM/SIGINT → `drenar` (timeout 20 s); `health.ts` expõe estado + contadores.

**AUSENTE (removido sem verificação — alvo de D-S2/D-S3):**
- Tratamento **diferenciado** de close codes: `aoFechar` reconecta para **qualquer** código; o estado
  `error` de `MotivoEncerramento` **nunca é setado**; não há `FECHAMENTOS_TERMINAIS` nem mapeamento
  sessão-substituída/ipLimited/machineLimited → parar.
- Reciclagem ligada a `restart-freeze`/`restart-resumed` (eventos do protocolo antigo): removida.
- Backoff escalonado de manutenção (5/10/15 min): removido (resta o backoff genérico).
- Write-back do token renovado por `sessao.renovada` para o health/central: só atualiza `tokenHello`
  em memória (o restante é SUP-02 / Phase 2).

**RESÍDUO antigo a limpar:**
- `config.ts` — `GAME_WS_SHARDS`/`gameWsShards`/`DEFAULT_WS_SHARDS=88` e a lógica de shard em
  `resolverWsUrl` estão **mortos** (o client usa `wsUrl` raw). `GAME_WS_PATH` default `/`.

### Referências ao servidor/protocolo antigo fora do worker (MIG-05)
- `apps/control-plane/src/app.ts:70` — `GAME_URL` default `"https://poke.idleworld.online"`.
- `apps/web/components/AccountForm.tsx:311-326` — instrução de colar `pokeweb:tokens` (accessToken+
  refreshToken) apontando para `poke.idleworld.online`; `apps/web/lib/conta.ts` `extrairTokens`
  (`conta.test.ts`) espera o par — não bate com o token Bearer único do `pokeidle.io`.
- `e2e/fake-game/server.ts` + `e2e/fake-game/token.ts` — fala o **protocolo antigo** (`/api/auth/login`,
  `enter-hunt`→`field-init`, `field-kill`, kick 4005). Com o worker migrado, o **E2E está quebrado**;
  precisa falar `pokeidle.io` (`/auth/entrar`, `hello`→`welcome`, `hunt.select`→`campo.init`,
  `batalha/morte`, ping/pong). `e2e/smoke.spec.ts:46-48` usa o label/formato antigo de tokens.
- `README.md:38-43,161` — passo de extração de `pokeweb:tokens` em `poke.idleworld.online` e descrição
  do fake-game antigo.
- `apps/central-api` página raiz (`root/routes.ts`) — **não cita domínio**; menciona só "Poke Idle World".
  Verificar se o nome/descrição precisa ajuste para o jogo real; sem referência funcional ao domínio antigo.

### Baseline de testes (factual, 2026-10-13)
- `pnpm vitest run` no worker: **8 arquivos, 134 testes, todos verdes**
  (`config` 20, `provider` 18, `solver` 11, `refresh` 3, `client` 21, `loop` 24, `health` 10, `http` 6).
- Fixtures: só `src/auth/__fixtures__/jwt.ts` (os `login.html`/`login-chunk.txt` do fluxo DOM antigo
  foram apagados na reescrita). Nenhum resíduo de vocabulário antigo nos testes.
- Referência de nível v1.0 citada na Phase 1 (`CONTEXT.md` D-08): ~175 testes — a reescrita encolheu a
  cobertura; MIG-04 a traz de volta para auth + game loop (reconexão, rejeição, drain, watchdog).

### Established Patterns
- Caminhos de auth mutuamente exclusivos no `config.ts`: `SOLVER_KEY`⇒`POKEIDLE_USER`/`PASS`;
  `ACCESS_TOKEN`⇒`REFRESH_TOKEN`; sem nenhum → erro de config.
- TDD com vitest + fake timers + servidor ws local (padrão de `client.test.ts`/`loop.test.ts`).
- Sem comentários em linhas de código; commits conventional em PT-BR; só nesta branch.
- `/health` (porta 3001) é o painel de observação: `curl http://127.0.0.1:3001/health` mostra `state`
  (`in-game`/`needs-login`/`error`) + `lastError` + contadores.

## Observações read-only para a Phase 2 (autoplay)
Na MESMA sessão de smoke, sem comprar/vender/curar nem gastar gold (cobre o 6-PLAN da Phase 1):
- Fonte dos campos do dashboard via `GET /api/characters/me` equivalente e eventos `estado`/`welcome`.
- Formato cru de `estado`(xp/gold/items/dexMud/pkMud), `batalha`, `campo`, `coins`, `nivel`, `capturas`
  para os cards de sessão (02-CONTEXT D-19/D-23) e critério de pokémon fraco/duplicado (D-11).
- Mecanismo de cura (`centro.curar`) e comandos de compra/venda (`shop.buy`/`loja.comprar`/
  `shop.autoVendaLoot`) — **só mapear** (D-07/D-11/D-14), nada executado.
- Catálogos estáticos p/ whitelist de venda (D-08) e hunt otimizada (D-01).
Hard limit: nenhuma ação paga; o que exigir gasto fica marcado não-observável e vai para a Phase 2.

## Deferred Ideas
- **Token único ponta a ponta na central** (schema com um campo, UI com um campo, config do worker): backlog
  (D-S6 = opção (a) aprovada — mantém o par interno nesta fase).
- (Write-back do token renovado por `sessao.renovada` → movido para a wave 3 desta fase, D-S7; não é mais Phase 2.)
- Políticas de autoplay, rotina, Modo Soneca como comportamento autônomo: Phase 2 (AUTO-*).
- Backoff escalonado de manutenção, se o smoke não observar um sinal próprio de manutenção: gap documentado.

---

*Phase: 01.1-migrar-worker-para-pokeidle-io*
*Context gathered: 2026-10-13*
