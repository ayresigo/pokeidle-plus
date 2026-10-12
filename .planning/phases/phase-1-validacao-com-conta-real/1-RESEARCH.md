# Phase 1: Validação com conta real - Research

**Researched:** 2026-10-12
**Domain:** Smoke manual de protocolo (auth Turnstile/REST + WebSocket de jogo) contra `poke.idleworld.online`, com correções cirúrgicas no `packages/worker` cobertas por teste
**Confidence:** HIGH (todo o comportamento do worker foi lido direto do código; o comportamento do servidor real é exatamente o que o smoke vai medir — por isso os pontos server-side ficam marcados como a confirmar)

> READ-ONLY: esta pesquisa não conectou ao jogo, não rodou o worker e não editou código. Tudo
> abaixo é derivado de `packages/worker/GAME.md` §9/§3/§4.4, de `packages/worker/src/**` e dos
> documentos de planejamento. Nenhum token, senha ou chave de solver aparece aqui.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 (Solver será testado):** VAL-01 observa o caminho completo `solver → POST /api/auth/login`
  (`SOLVER_KEY` + `POKEIDLE_USER`/`POKEIDLE_PASS`) **e** o fallback de tokens colados
  (`pokeweb:tokens` → `ACCESS_TOKEN`/`REFRESH_TOKEN`). A pergunta central do §9.1 é se o backend
  aceita o `captchaToken` gerado no IP do solver (`remoteip`); só se responde com chave real.
- **D-02 (Fallback é caminho principal se o solver for recusado):** se o login recusar o token do
  solver, registra-se o `lastError` e a conta passa a entrar pelos tokens colados, que viram o
  caminho principal documentado em GAME.md §9.1.
- **D-03 (Conta descartável):** validação com conta nova, criada só para isto. Credenciais só na execução.
- **D-04 (Sem proxy):** conecta pelo IP local (`PROXY_URL` vazio). O token do solver vem do IP do
  solver, não do IP local — é exatamente o que VAL-01 verifica.
- **D-05 (Direto para observar, Docker no drain):** a maioria dos testes roda via `pnpm start` em
  `packages/worker` com env vars no ambiente, para logs diretos. VAL-05 (drain/farm offline) é
  repetido com o worker em container e `docker stop` real, para exercitar o SIGTERM de produção.
- **D-06 (HUNT_SLUG fixo):** a validação fixa `HUNT_SLUG` numa hunt que o personagem aguenta, para
  `field-kill` subir rápido. O slug é informado na execução. Auto-pick por map-markers fica como
  caminho alternativo, não o alvo do smoke.
- **D-07 (Dupla trilha de evidência):** cada ponto de §9 é marcado **no próprio `packages/worker/GAME.md`**
  (confirmado/refutado/não-observável + data) e os trechos sanitizados ficam em
  `.planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md`. Nenhum dos dois contém segredo.
- **D-08 (Correção só sob evidência, com teste real):** divergência observada vira edit em
  `packages/worker/src` + teste em `client.test.ts`/`provider.test.ts`/`loop.test.ts` (ou
  `refresh.test.ts`/`solver.test.ts`) que reproduz o comportamento **real observado**, não o presumido.
  Suíte inteira verde ao fim (baseline atual: 175 testes).

### Claude's Discretion
- A mecânica exata de VAL-05 (se precisa de `sleep-mode`, como medir o baseline do farm offline) é o
  que o plano detalha e o smoke decide.
- Ordem dos passos do smoke e formato dos trechos sanitizados em EVIDENCE.md.

### Deferred Ideas (OUT OF SCOPE)
- Políticas de hunt/compra/venda, rotina diária, Modo Soneca como comportamento autônomo → **Phase 2 (AUTO-*)**.
  Aqui só se observa o `sleep-mode` o suficiente para VAL-05.
- Run de aceite de 24 h com até 4 contas → **Phase 2 (AUTO-06)**.
- Forjar `cmid`/fingerprint (D-10): 4007 é bloqueio a registrar, não alvo de contorno.
- `apps/central-api`, `apps/control-plane`, `apps/web`, deploy/k8s: intocados.
- Comprar/vender qualquer coisa na conta real.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Descrição (REQUIREMENTS.md) | Suporte da pesquisa |
|----|------------------------------|---------------------|
| VAL-01 | `POST /api/auth/login` aceita (ou não) o `captchaToken` do `TurnstileTaskProxyless` resolvido no IP do solver; backend exige captcha em todo login; se recusado, `needs-login` com `lastError` claro e tokens colados viram caminho principal | Bloco 1 (roteiro A1/A2), Bloco 2 (§9.1), `auth/solver.ts`, `auth/provider.ts` (`loginComCaptcha`, `SolverTokenProvider`) |
| VAL-02 | Servidor aceita sessão WS sem `cmid` ou fecha com 4007; se 4007, worker para em `error` com motivo no `/health`, sem reconectar em loop e sem forjar `cmid` | Bloco 2 (§9.2 cmid/4007), Bloco 3, `game/client.ts` `montarUrlWs`+`FECHAMENTOS_TERMINAIS[4007]` |
| VAL-03 | Sessão conecta no shard djb2(`sub`)%88 igual ao do navegador e recebe `field-init` após `enter-hunt`; se divergir, corrigir cálculo ou overrides `GAME_WS_URL`/`GAME_WS_PATH`/`GAME_WS_SHARDS` | Bloco 1 (passo shard), Bloco 2 (§9.2 shard), `game/client.ts` `montarUrlWs`/`lerSub`, `config.ts` |
| VAL-04 | Em hunt real chegam `field-kill` reais; formato de `field-kill`/`catch-result`/`analyzer` registrado; contador de kills/capturas sobe sem o watchdog de stall disparar à toa | Bloco 1 (passo kills), Bloco 2 (§9.2 mensagens), `game/client.ts` switch de mensagens, `game/loop.ts` `watchdogStall` |
| VAL-05 | Farm offline continua após `docker stop` sem `sleep-mode`? Se não, drain passa a enviar `{"type":"sleep-mode"}` e esperar `sleep-ok` antes de fechar | Bloco 1 (sub-roteiro VAL-05), Bloco 2 (§9.2 drain), `index.ts` `encerrar`/`drenar`, `game/client.ts` `desconectar` |
| VAL-06 | Demais pontos de §9 na mesma sessão: rotação do refreshToken, access JWT com `exp`, `restart-state`/`balls-get` → `restart-freeze`/`balls`, `hunt-resume`+`enter-hunt resume:true`, close codes 4005-4009 | Bloco 1 e Bloco 2 (linhas §9.1/§9.2), `auth/refresh.ts`, `game/client.ts` |
| VAL-07 | Toda divergência vira correção em `packages/worker` com teste que reproduz o real, suíte verde | Bloco 2 (coluna "arquivo/função" + "teste"), Validation Architecture |
</phase_requirements>

## Summary

A Fase 1 não introduz stack nova: o worker Node puro (`packages/worker`, undici 8, vitest, `tsx`)
já implementa §9.1 (auth) e §9.2 (game loop). A pesquisa é um **roteiro de smoke seguro e
reprodutível** que exercita cada ponto de `GAME.md` §9 contra o jogo real e um **mapa ponto-a-ponto**
ligando cada afirmação não confirmada ao arquivo/função que mudaria e ao teste que cobriria a
correção, caso o servidor real divirja do presumido.

Os dois caminhos de auth são mutuamente exclusivos no `config.ts` e rodam em execuções separadas
(D-01): o caminho **solver** (`SOLVER_KEY`+`POKEIDLE_USER`/`POKEIDLE_PASS`) e o caminho **tokens
colados** (`ACCESS_TOKEN`+`REFRESH_TOKEN`, extraídos de `sessionStorage["pokeweb:tokens"]`). O
`/health` (porta `HEALTH_PORT`, default 3001) é o painel de observação: expõe `state`, `lastAction`,
`lastError`, `uptimeSec` e, quando o worker renova, `tokens`. Atenção a uma divergência de
vocabulário já conhecida: os estados reais são `booting | authenticating | in-game | needs-login |
error` (não "running") — o observador deve esperar `in-game`, não `running`.

As incógnitas de maior risco que o smoke deve fechar: (1) o backend aceita o `captchaToken` gerado
no IP do solver? (VAL-01); (2) o servidor aceita WS sem `cmid` ou fecha 4007? (VAL-02); (3) o shard
calculado bate com o do navegador? (VAL-03); (4) o farm offline continua após `docker stop` sem
`sleep-mode`? (VAL-05). Uma limitação de observabilidade importante aparece desde já: **kills/capturas
ficam no estado interno do cliente e não são expostos no `/health` nem logados por kill** — o formato
cru de `field-kill`/`catch-result`/`analyzer` (VAL-04) só se captura pelo DevTools do navegador, e a
regra "uma sessão por conta" (close 4005) obriga a nunca ter worker e navegador na mesma conta ao
mesmo tempo.

**Primary recommendation:** Rodar o smoke em sessões curtas e sequenciais na conta descartável,
alternando worker (via `pnpm start`, logs diretos) e navegador (DevTools → Network → WS, só quando o
worker estiver parado), marcar cada ponto de §9 em `GAME.md` com data e espelhar o trecho sanitizado
em `EVIDENCE.md`; só então, e só sob evidência de divergência, aplicar a correção mínima com teste
que reproduza o comportamento real (D-08).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Resolver Turnstile e logar | Worker → Solver 2captcha (externo) → Backend do jogo (REST) | — | `auth/solver.ts` fala com `api.2captcha.com`; `auth/provider.ts` faz `POST /api/auth/login` no backend. O IP do token é o do solver (D-04) |
| Renovar/rotacionar tokens | Worker → Backend do jogo (REST) | — | `auth/refresh.ts` `POST /api/auth/refresh`; agendamento proativo pelo `exp` do JWT no `AuthManager` |
| Sessão de jogo e eventos | Worker (WS client) → Backend do jogo (WS) | — | `game/client.ts` abre `wss://.../ws[N]?token=&v=2`; shard calculado client-side a partir do `sub` do JWT |
| Loop de hunt / watchdogs | Worker (lógica local) | WS do jogo | `game/loop.ts` decide `enter-hunt`/`leave-hunt`/recuperação a partir do estado recebido por WS |
| Drain / farm offline | Worker (SIGTERM) → WS do jogo | — | `index.ts` `encerrar`→`drenar`; `game/client.ts` `desconectar` fecha com 1000; o farm offline é decisão **server-side** (o que VAL-05 mede) |
| Observação do smoke | `/health` local (porta 3001) + stdout do worker + DevTools do navegador | — | `health.ts` serve `GET /health`; kills/capturas NÃO estão no `/health` (limitação registrada em Open Questions) |

## Standard Stack

Nenhuma biblioteca nova. O stack do worker já está fixado e validado contra o jogo falso; a Fase 1
só o exercita contra o jogo real.

### Core (já no repositório)
| Library | Version | Purpose | Observação |
|---------|---------|---------|------------|
| undici | ^8.11.2 | `fetch` HTTP e `WebSocket` do worker (REST de auth + WS de jogo) | `[VERIFIED: packages/worker/package.json]`; `WebSocket` com `headers: { Origin }` e `dispatcher` opcional (proxy) |
| tsx | (via `pnpm start`) | Executa `src/index.ts` sem build | `[VERIFIED: packages/worker/package.json]` script `start` = `tsx src/index.ts` |
| vitest | (devDep do monorepo) | Suíte de testes; `pnpm test` = `vitest run` | `[VERIFIED: packages/worker/package.json]` baseline 175 testes `[CITED: CONTEXT.md D-08]` |

### Ferramentas externas do smoke
| Ferramenta | Purpose | When to use |
|------------|---------|-------------|
| 2captcha (`api.2captcha.com`) | `TurnstileTaskProxyless` que gera o `captchaToken` | Caminho solver (VAL-01). Chave só via `SOLVER_KEY` no ambiente/.env ignorado pelo git |
| Chrome/Chromium DevTools | Ler `sessionStorage["pokeweb:tokens"]` e inspecionar Network → WS (shard, frames crus) | Fallback de tokens (VAL-01), shard (VAL-03), formato de eventos (VAL-04/§9.2) |
| Docker + `docker stop` | SIGTERM de produção para o drain | VAL-05 |

**Nenhuma instalação nova.** `pnpm install` na raiz do monorepo basta; o smoke roda com
`pnpm start` dentro de `packages/worker`.

## Architecture Patterns

### System Architecture Diagram (fluxo do smoke)

```
                          ┌──────────────────────────── conta descartável (D-03) ────────────────────────────┐
                          │                                                                                   │
 [operador]              env vars (solver OU tokens colados)                                                  │
    │                        │                                                                                │
    │ pnpm start             ▼                                                                                │
    └──────────────▶  packages/worker (index.ts)                                                             │
                           │  carregarConfig() ─────────────── config.ts valida caminho de auth               │
                           │  startHealthServer() ──────────▶  GET /health  ◀──── curl 127.0.0.1:3001 (observa)│
                           │  auth.autenticar()                                                                │
                           │     ├─ caminho solver:  solver.ts ──HTTP──▶ api.2captcha.com (IP do solver)       │
                           │     │                   provider.ts ─POST /api/auth/login {identifier,pass,       │
                           │     │                                      captchaToken} ──▶ backend do jogo      │
                           │     └─ caminho tokens:  StoredTokenProvider (ACCESS/REFRESH do navegador)         │
                           │  refresh.ts ─POST /api/auth/refresh {refreshToken} ──▶ backend (rotação?)         │
                           ▼                                                                                   │
                     game/client.ts                                                                           │
                        montarUrlWs(base, access, 88): shard = abs(djb2(sub))%88                              │
                        WS: wss://poke.idleworld.online/ws[N]?token=<access>&v=2   (SEM cmid)                 │
                        Origin: <GAME_URL>                                                                    │
                           │  onopen → envia restart-state + balls-get                                         │
                           │  recebe field-init / field-kill / catch-result / analyzer / balls /               │
                           │          hunt-resume / restart-freeze / sleep-ok ...                              │
                           │  close 4001→refresh+reconnect; 4005/4008/4009→needs-login; 4006/4007→error        │
                           ▼                                                                                   │
                     game/loop.ts  [restart-freeze → garantir-hunt → watchdog-stall]                          │
                        enter-hunt {slug, resume} ; leave-hunt ; watchdog 10min                               │
                           │                                                                                   │
  SIGTERM (docker stop) ──▶ index.ts encerrar → drenar: loop.parar(20s) → client.desconectar()               │
                            (fecha WS com 1000 "drain"; NÃO envia sleep-mode hoje)                             │
                          └───────────────────────────────────────────────────────────────────────────────────┘

  [navegador DevTools]  — SÓ com o worker parado (uma sessão por conta: login concorrente → 4005) —
     Application → Session Storage → pokeweb:tokens  (extrai ACCESS/REFRESH p/ fallback)
     Network → WS → /ws[N] + Messages  (compara shard e captura formato cru dos eventos)
```

### Component Responsibilities
| Arquivo | Responsabilidade no smoke |
|---------|---------------------------|
| `src/config.ts` → `loadConfig(env)` | Valida e normaliza env; decide qual caminho de auth está ativo; monta `gameWsUrl` a partir de `GAME_WS_URL`/`GAME_URL`+`GAME_WS_PATH` |
| `src/index.ts` | Entrypoint `pnpm start`; sobe `/health`, autentica, monta client+loop, trata SIGTERM/SIGINT com `drenar(timeout 20s)` |
| `src/health.ts` → `HealthState`/`startHealthServer` | Serve `GET /health` em `HEALTH_PORT` (default 3001, host `0.0.0.0`) com `{state,lastAction,lastError,uptimeSec,tokens?}` |
| `src/auth/solver.ts` | `resolverTurnstile` (TurnstileTaskProxyless), `descobrirSitekey`/`extrairSitekey` (fallback se `TURNSTILE_SITEKEY` ausente) |
| `src/auth/provider.ts` | `SolverTokenProvider`/`StoredTokenProvider`/`AuthManager`; `loginComCaptcha` (`POST /api/auth/login`), agendamento de refresh pelo `exp` |
| `src/auth/refresh.ts` | `renovarTokens` (`POST /api/auth/refresh`), `lerExpiracao` (lê `exp` do JWT) |
| `src/game/client.ts` | `montarUrlWs`/`lerSub` (shard djb2), WS undici com `Origin`, dispatch de mensagens, `FECHAMENTOS_TERMINAIS` (4005-4009), `desconectar` (close 1000) |
| `src/game/loop.ts` | `criarAcoes` (`restart-freeze`→`garantir-hunt`→`watchdog-stall`), `runGameLoop` (5 erros→aborta), `drenar` |

### Pattern 1: Caminhos de auth mutuamente exclusivos (execuções separadas)
**What:** `config.ts` exige **ou** `ACCESS_TOKEN`+`REFRESH_TOKEN` **ou** `SOLVER_KEY`(+`POKEIDLE_USER`/`PASS`).
**When to use:** rode o smoke duas vezes — uma por caminho (D-01).
```
# Caminho SOLVER (VAL-01 principal):     ACCOUNT_ID, GAME_URL, SOLVER_KEY, POKEIDLE_USER, POKEIDLE_PASS, HUNT_SLUG
# Caminho TOKENS COLADOS (VAL-01 fallback): ACCOUNT_ID, GAME_URL, ACCESS_TOKEN, REFRESH_TOKEN, HUNT_SLUG
# Fonte: packages/worker/src/config.ts (loadConfig), linhas 113-126
```

### Anti-Patterns to Avoid
- **Abrir o navegador na conta enquanto o worker está conectado:** derruba uma das sessões (close
  4005) e contamina a observação. Alterne; nunca sobreponha.
- **Forjar `cmid` para contornar 4007:** proibido por D-10. 4007 é bloqueio a registrar (VAL-02).
- **Marcar ponto de §9 sem trecho de evidência:** D-07 exige evidência sanitizada em EVIDENCE.md.
- **Corrigir comportamento "presumido":** D-08 só permite correção sob evidência real, com teste que
  reproduz o observado.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Resolver Turnstile | Solver próprio / headless | `auth/solver.ts` + 2captcha `TurnstileTaskProxyless` | Já implementado; o que falta é o servidor aceitar — VAL-01 |
| Cálculo de shard | Reimplementar djb2 à mão no smoke | `montarUrlWs`/`lerSub` já no `game/client.ts` | Compare o shard do navegador com o do worker; não reescreva a fórmula |
| Backoff/reconexão/heartbeat | Loop de reconexão ad hoc | `game/client.ts` (backoff 1,5s·2^n teto 24s→5min, heartbeat 10/45/15s, manutenção 5/10/15min) | Já codificado e testado; o smoke só confirma em produção |
| Drenagem em SIGTERM | Script de shutdown | `index.ts` `encerrar`→`drenar` (timeout 20s) | O smoke usa `docker stop` para exercitar o handler existente |

**Key insight:** A Fase 1 é verificação, não construção. Qualquer "hand-roll" no smoke mascara o
comportamento que se quer medir. Instrumentos externos (curl ao `/health`, DevTools) observam; o
worker permanece como está até haver evidência de divergência.

## Runtime State Inventory

> Fase de validação-e-correção (não é rename), mas mexe com estado vivo de conta e tokens. Inventário:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data (conta) | Progresso/gold/capturas da conta descartável no servidor do jogo (autoritativo server-side). Nenhum banco local no worker (`[VERIFIED: REQUIREMENTS.md "Banco de dados local — Out of Scope"]`) | Nenhuma migração: é a conta de teste. Baseline de VAL-05 é lido do servidor |
| Live service config | Sessão viva única por conta no servidor (close 4005 ao duplicar login) `[CITED: GAME.md §3.3/§4.4]` | Procedimento: nunca worker+navegador simultâneos na mesma conta |
| OS-registered state | Nenhum. O worker não registra tarefas de SO; roda via `pnpm start` ou container efêmero `[VERIFIED: packages/worker/src, sem agendadores]` | None — verificado por leitura de `index.ts`/`package.json` |
| Secrets/env vars | `SOLVER_KEY`, `POKEIDLE_USER`/`PASS`, `ACCESS_TOKEN`/`REFRESH_TOKEN` passam só por ambiente/`.env` local ignorado pelo git `[CITED: CONTEXT.md Constraints]` | Nunca logar/commitar; `.env` fora de `.planning/` e do versionamento |
| Build artifacts | `tsx` roda direto de `src/` — sem artefato compilado persistente para o smoke `[VERIFIED: package.json script start]` | None |

**Tokens renovados:** quando o worker renova, `/health` passa a expor `tokens` (só se diferirem dos
iniciais — `health.ts` `renewedTokens()`). No smoke, isso serve para confirmar rotação (VAL-06) sem
precisar de banco, mas o valor é segredo: **registre só o fato "tokens mudaram", nunca o conteúdo**.

## Common Pitfalls

### Pitfall 1: Confundir o vocabulário de estado do `/health`
**What goes wrong:** esperar `state: "running"` (como o CONTEXT.md descreve informalmente).
**Why it happens:** o `/health` usa `WorkerState = booting|authenticating|in-game|needs-login|error`
(`[VERIFIED: packages/worker/src/health.ts:4]`). Não existe `running`.
**How to avoid:** no smoke, o sinal de "logado e jogando" é `state: "in-game"` + `lastAction`
avançando. Documente isso em EVIDENCE.md.
**Warning signs:** `grep` por "running" no `/health` não acha nada.

### Pitfall 2: Worker e navegador na mesma conta ao mesmo tempo (close 4005)
**What goes wrong:** um dos dois cai com 4005 `replaced`; a evidência fica poluída e parece um bug.
**Why it happens:** uma sessão viva por conta (`[CITED: GAME.md §3.3/§4.4]`).
**How to avoid:** alterne — pare o worker (`Ctrl-C`/`docker stop`) antes de abrir o navegador na conta.
**Warning signs:** `lastError` com "WS 4005" logo após abrir o jogo no navegador.

### Pitfall 3: Esperar ver kills/capturas no `/health`
**What goes wrong:** querer ler o contador de kills por `curl /health` e não achar.
**Why it happens:** `kills`/`capturas` vivem em `EstadoJogo` dentro do `game/client.ts` (linhas 22-23,
546, 550) e **não** entram no `HealthSnapshot`; o loop só publica `lastAction` ("em hunt <slug>") e
`lastError` (`[VERIFIED: health.ts:63-73`, `loop.ts:178]`).
**How to avoid:** para VAL-04, capture o formato cru de `field-kill`/`catch-result`/`analyzer` pelo
DevTools (Network → WS → Messages) numa sub-sessão do navegador; confirme o comportamento do contador
no worker indiretamente (ausência de `lastError` "sem kills" e `lastAction` permanecendo "em hunt").
**Warning signs:** `/health.lastError` = "hunt <slug> sem kills há <N>min" indica stall real ou falta
de kills; sua ausência por >10 min indica kills chegando.

### Pitfall 4: Turnstile/Cloudflare pode variar por IP/score
**What goes wrong:** o backend aceita o token do solver numa tentativa e recusa noutra.
**Why it happens:** `TURNSTILE_ENABLED` é condicional e a Cloudflare pontua por IP (`[CITED: GAME.md §6/§8]`).
**How to avoid:** rode VAL-01 mais de uma vez; registre o HTTP status e a mensagem (sanitizada) de
cada tentativa. Se recusar, siga para os tokens colados (D-02).
**Warning signs:** `lastError` com "login recusado (HTTP 4xx)".

### Pitfall 5: `docker stop` com timeout curto corta o drain
**What goes wrong:** o drain do worker espera até 20 s a ação em voo (`index.ts` `TIMEOUT_DRENAGEM_MS`);
`docker stop` default dá 10 s de SIGTERM antes do SIGKILL.
**Why it happens:** `docker stop` manda SIGTERM e espera `--time` (default 10 s) antes do KILL.
**How to avoid:** use `docker stop --time 30 <nome-exato>` para deixar o drain completar e observar os
logs de drenagem. Nunca `prune`/filtro/`xargs` (regra do projeto); pare só o container pelo nome exato.
**Warning signs:** worker morto sem log "drenando"/"ação em andamento não terminou".

## Code Examples

### Caminho solver — o que o worker faz no login (fonte do que VAL-01 confirma)
```ts
// Source: packages/worker/src/auth/provider.ts:79-105 (loginComCaptcha)
resposta = await fetch(new URL("/api/auth/login", gameUrl).toString(), {
  method: "POST",
  headers,                                   // content-type + user-agent do solver, se vier
  body: JSON.stringify({ identifier, password, captchaToken: captcha.token }),
});
// twoFactor na resposta  -> LoginError "conta com 2FA não suportada pelo worker"
// sem accessToken/refreshToken -> LoginError "resposta do login sem accessToken/refreshToken"
```

### Refresh — rotação do refreshToken (fonte do que VAL-06 confirma)
```ts
// Source: packages/worker/src/auth/refresh.ts:81-87 (renovarTokens)
return {
  accessToken: corpo.accessToken,
  refreshToken:
    typeof corpo.refreshToken === "string" && corpo.refreshToken !== ""
      ? corpo.refreshToken          // backend rotacionou -> usa o novo
      : refreshToken,               // backend não mandou  -> mantém o atual
};
// lerExpiracao(token) lê o `exp` do JWT (refresh.ts:36-47) -> agendamento proativo no AuthManager
```

### Shard + URL do WS (fonte do que VAL-02/VAL-03 confirmam)
```ts
// Source: packages/worker/src/game/client.ts:119-137 (montarUrlWs) + 142 (Origin)
// shard = abs(djb2(sub do JWT)) % shards(88); shard>0 -> /ws{N} (ou porta+N se base sem path)
// query: ?token=<accessToken>&v=2   (SEM cmid)
const socket = new WebSocket(url, { dispatcher, headers: { Origin: origem } });
```

### Drain atual — NÃO envia sleep-mode (fonte do que VAL-05 investiga)
```ts
// Source: packages/worker/src/game/client.ts:215-228 (desconectar)
async desconectar(): Promise<void> {
  this.encerrar({ estado: "desconectado", motivo: "desconectado pelo worker" });
  // ...
  socket.close(1000, "drain");        // fecha limpo; nenhum {type:"sleep-mode"} é enviado
  await Promise.race([fechado, prazo.promise]);
}
// Confirmado: grep por "sleep-mode"/"sleep-ok" em packages/worker/src não retorna nenhuma ocorrência.
```

---

## BLOCO 1 — Roteiro de smoke manual (seguro e reprodutível)

### 1.0 Pré-requisitos
- **Conta descartável** criada só para o smoke (D-03), com personagem já criado (pós-login deve
  rotear para `/play`, não `/create-character` nem `/verify-email` — `[CITED: GAME.md §3.3`
  `routeAfterAuth]`). Credenciais fornecidas só na execução.
- **`HUNT_SLUG` fixo** (D-06), informado na execução, numa hunt que o personagem aguenta (para
  `field-kill` subir rápido). Slug é o `slug` de uma entrada de `/api/game/map-markers` com `level>0`
  fora de cidades/ginásios (`[CITED: GAME.md §4.3]`).
- **`SOLVER_KEY`** (chave 2captcha) só via ambiente ou `.env` local já ignorado pelo git — nunca em
  `.planning/` nem versionado (D-01, Constraints). Idem `POKEIDLE_USER`/`POKEIDLE_PASS`.
- **`GAME_URL`** = `https://poke.idleworld.online` (`[CITED: GAME.md §7]`). `PROXY_URL` vazio (D-04).
- **Portas:** `HEALTH_PORT` default 3001 (host `0.0.0.0`); garanta que 3001 está livre, ou defina
  outra. O container de VAL-05 deve publicar/encaminhar essa porta para o `curl` do host.
- `pnpm install` na raiz do monorepo feito.

### 1.1 Execução A — caminho SOLVER (VAL-01 principal, D-01)
Env (num `.env` local ignorado pelo git, nunca ecoado no terminal):
```
ACCOUNT_ID=<id-descartavel>
GAME_URL=https://poke.idleworld.online
SOLVER_KEY=<chave 2captcha>          # só no ambiente
POKEIDLE_USER=<identifier>
POKEIDLE_PASS=<senha>
HUNT_SLUG=<slug informado>
# opcionais: SOLVER_API_URL (default https://api.2captcha.com), TURNSTILE_SITEKEY (fallback se o
#            chunk mudar), HEALTH_PORT, GAME_WS_URL/GAME_WS_PATH/GAME_WS_SHARDS (só se shard divergir)
```
Comando exato (D-05):
```
pnpm --filter worker start      # equivalente a: cd packages/worker && pnpm start  (tsx src/index.ts)
```
O que observar:
1. **Login:** stdout do worker com `autenticado via solver` (sucesso) ou `needs-login (...)` /
   `autenticação adiada (...)` (`[VERIFIED: index.ts:20-25,66-67]`). Confirme VAL-01: o
   `captchaToken` do solver foi aceito?
2. **`/health`:** `curl http://127.0.0.1:3001/health` → `state` deve ir de `authenticating` a
   `in-game`; `lastError` nulo no sucesso. Em recusa, `state: needs-login` com `lastError` tipo
   "login recusado (HTTP …)".
3. **Registro:** se o solver for recusado, anote o status HTTP sanitizado em EVIDENCE.md, marque
   GAME.md §9.1 "Solver aceito pelo jogo?" como **refutado** + data, e passe para a Execução B como
   caminho principal (D-02).

### 1.2 Extrair `pokeweb:tokens` do navegador (para a Execução B / fallback)
Com o **worker parado** (evita 4005), na conta descartável:
1. Faça login manual em `https://poke.idleworld.online/login` (você resolve o Turnstile; D-04: IP local).
2. Chegue em `/play`. Abra DevTools → **Application → Session Storage → `https://poke.idleworld.online`**.
3. Abra a chave **`pokeweb:tokens`** — é um JSON `{ accessToken, refreshToken }` (`[CITED: GAME.md §3.3]`).
   (Ou no Console: `JSON.parse(sessionStorage['pokeweb:tokens'])`.)
4. Copie `accessToken` → `ACCESS_TOKEN` e `refreshToken` → `REFRESH_TOKEN` no `.env` local.
   **Nunca cole esses valores em EVIDENCE.md, GAME.md, logs ou commits** — registre apenas "tokens
   extraídos em <data>".
5. **Feche a aba do jogo** antes de rodar o worker (uma sessão por conta).

### 1.3 Execução B — caminho TOKENS COLADOS (VAL-01 fallback / caminho principal se solver recusar)
Env:
```
ACCOUNT_ID=<id-descartavel>
GAME_URL=https://poke.idleworld.online
ACCESS_TOKEN=<do passo 1.2>          # exige REFRESH_TOKEN (config.ts)
REFRESH_TOKEN=<do passo 1.2>
HUNT_SLUG=<slug informado>
```
Comando: `pnpm --filter worker start`. Observe o mesmo que 1.1, com `autenticado via tokens salvos`.

### 1.4 Passo WS/shard (VAL-02, VAL-03)
Com o worker em `in-game`:
1. **Sem `cmid`:** o worker abre `wss://…/ws[N]?token=…&v=2` sem `cmid` (`[VERIFIED: client.ts:119-137;
   client.test.ts:168]`). Se a sessão se mantém (recebe `field-init`), VAL-02 = "aceita sem cmid".
   Se fecha com 4007, VAL-02 = 4007 (ver Bloco 3).
2. **Shard:** calcule o shard esperado `abs(djb2(sub))%88` a partir do `sub` do JWT do `accessToken`
   (`lerSub`/`montarUrlWs`, `client.ts:109-137`). Para o do navegador: numa sub-sessão (worker
   parado), DevTools → **Network → WS** → veja o path do upgrade (`/ws` = shard 0, `/wsN` = shard N).
   Compare. Igual → VAL-03 confirmado. Divergente → corrigir cálculo/overrides (Bloco 2 §9.2 shard).
   > Nota de observabilidade: o worker não loga a URL/shard escolhido hoje; o shard do worker é
   > derivado pela fórmula acima a partir do mesmo `sub`. (Ver Open Questions.)
3. **`field-init`:** confirme que após `enter-hunt <slug>` chega `field-init` (worker passa a
   `lastAction: "garantir-hunt: em hunt <slug>"`) — VAL-03.

### 1.5 Passo kills/eventos (VAL-04)
1. Com o worker em hunt, `/health.lastAction` deve permanecer "em hunt <slug>" e **não** aparecer
   `lastError` "hunt <slug> sem kills há <N>min" (watchdog de stall, `loop.ts:138`). Isso evidencia
   kills chegando sem o watchdog disparar à toa.
2. **Formato cru** de `field-kill`/`catch-result`/`analyzer`: capture numa sub-sessão do navegador
   (worker parado) via DevTools → Network → WS → Messages, e cole o JSON sanitizado em EVIDENCE.md.
   Compare com os campos que o worker lê: `field-kill.speciesName`, `catch-result.success`,
   `analyzer.seconds`/`analyzer.balance` (`client.ts:543-568`). Divergência de campo → correção.

### 1.6 Passo VAL-06 (demais pontos de §9 na mesma sessão)
- **Rotação do refreshToken:** deixe o worker rodar até um refresh (ou force expiração aguardando o
  `exp`); se `/health` passar a expor `tokens` (diferentes dos iniciais), o backend rotacionou
  (`health.ts:50-61`; `refresh.ts:81-87`). Registre só o fato.
- **Access é JWT com `exp`:** `lerExpiracao` decodifica o `exp`; confirme que há renovação proativa
  (não só reativa a 401/4001). Se `exp` ausente, só há renovação reativa (`[CITED: GAME.md §9.1]`).
- **`restart-state`/`balls-get` → `restart-freeze`/`balls`:** ao abrir, o worker envia os dois
  (`client.ts:363-364`); confirme respostas no DevTools e no estado (`balls` populado).
- **`hunt-resume` + `enter-hunt resume:true`:** reconecte com hunt em andamento (reinicie o worker
  rápido) e confirme `hunt-resume` seguido de `enter-hunt` com `resume:true` sem zerar progresso
  (`client.ts:540-541`; `loop.ts:112`).
- **Close codes 4005-4009:** ver Bloco 2 §9.2; 4005 reproduzível logando a mesma conta noutro lugar.

### 1.7 Sub-roteiro VAL-05 (drain / farm offline com `docker stop` real)
Objetivo: o farm offline continua depois do drain **sem** `sleep-mode`? (hoje o worker não envia
`sleep-mode` — `client.ts:215-228`.)
1. **Baseline (server-side):** a conta é a única fonte autoritativa de progresso; kills/capturas não
   estão no `/health`. Capture o baseline pela própria conta: numa sub-sessão do navegador (worker
   parado), em `/play`, anote gold/capturas/tempo de sessão (ou o `analyzer`: `seconds`/`balance`).
   **Feche a aba.**
2. **Rodar em container e deixar farmar:** suba o worker como container (D-05), publicando a porta de
   `/health`, e deixe-o em `in-game` numa janela curta. Confirme kills chegando (ausência de
   `lastError` "sem kills" por >10 min).
3. **`docker stop` real:** `docker stop --time 30 <nome-exato-do-container>` (SIGTERM → drain de até
   20 s → close 1000; nunca `prune`/filtro/`xargs`). Observe nos logs "drenando" e, se for o caso,
   "ação em andamento não terminou em 20s" (`index.ts:42-48`).
4. **Janela de espera offline:** aguarde uma janela definida (ex.: 15-30 min) com a conta **sem
   nenhuma sessão viva**.
5. **Reabrir só para ler:** numa sub-sessão do navegador (nada de jogar), compare gold/capturas/tempo
   com o baseline. Subiu durante a janela → farm offline continua **sem** `sleep-mode` → VAL-05
   confirmado, GAME.md §9.2 "Drain sem sleep-mode" = **confirmado** + data.
6. **Se o farm offline NÃO continuar:** a correção prevista (D-08) é o drain passar a enviar
   `{"type":"sleep-mode"}` e esperar `sleep-ok` (`ghost`) antes de fechar o socket, e então repetir
   os passos 2-5 para confirmar o farm offline de novo. (Detalhe no Bloco 2 §9.2 drain.)

### 1.8 Registro de evidência (D-07) e marcação de §9
- Para cada ponto de §9 exercitado: escreva uma linha de marca **no próprio `packages/worker/GAME.md`**
  ao lado do item, no formato `✅ confirmado 2026-mm-dd` / `❌ refutado 2026-mm-dd` /
  `⬜ não-observável 2026-mm-dd`, e espelhe o trecho que embasa (log do worker, mensagem WS do
  DevTools, ou resposta HTTP) **sanitizado** em
  `.planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md`.
- **Sanitização obrigatória:** remova `accessToken`/`refreshToken`/`captchaToken`/`identifier`/senha/
  `SOLVER_KEY`; substitua por `<redacted>`. O worker já oculta senha e token do captcha nas mensagens
  de erro (`ocultarSegredos`, `provider.ts:38-43`), mas confira manualmente antes de colar.

### 1.9 Guard de segurança em cada passo (checklist)
- **Uma sessão por conta:** nunca worker + navegador simultâneos na mesma conta (close 4005).
- **Não comprar/vender:** o smoke só observa; nenhuma ação de `balls/buy`/`shop/sell` (Phase 2).
- **Não forjar `cmid`:** 4007 é bloqueio a registrar (D-10/VAL-02), não a contornar.
- **Não logar segredos:** segredos só no `.env` local ignorado pelo git; EVIDENCE.md/GAME.md/commits
  ficam sem token/senha/chave.
- **Docker:** parar só o container do smoke, por nome exato; nunca `prune`/filtro/`xargs`.

---

## BLOCO 2 — Mapa ponto-a-ponto GAME.md §9 → confirmar → correção esperada (VAL-07)

> "Arquivo/função" = onde a correção entraria se o servidor real divergir. "Teste" = arquivo da
> suíte vitest que cobriria a correção reproduzindo o comportamento real (D-08).

### §9.1 Auth
| Ponto §9.1 | O que confirmar | Arquivo/função se divergir | Teste |
|------------|-----------------|----------------------------|-------|
| Sitekey do Turnstile (`0x4AAAAAADkKBnFEMDt0MGBM`) | Extração do chunk ainda funciona; senão usar `TURNSTILE_SITEKEY` | `auth/solver.ts` `extrairSitekey`/`descobrirSitekey`/`listarChunks` | `solver.test.ts` |
| **Solver aceito pelo jogo?** (token do IP do solver, `remoteip`) | `POST /api/auth/login` aceita o `captchaToken` do `TurnstileTaskProxyless` | `auth/provider.ts` `loginComCaptcha`/`SolverTokenProvider`; se recusado, VAL-01→D-02 (tokens colados viram principal), sem código a mudar além de doc | `provider.test.ts` (caso login recusado → `LoginError`/needs-login), `solver.test.ts` |
| **Turnstile sempre ligado?** (backend exige `captchaToken` em todo login?) | Se o backend aceita login sem captcha em algum caso | `auth/provider.ts` `loginComCaptcha` (hoje sempre envia `captchaToken`) | `provider.test.ts` |
| **Refresh rotaciona o `refreshToken`?** | `/api/auth/refresh` devolve novo `refreshToken` (ou só `accessToken`) | `auth/refresh.ts` `renovarTokens` (já trata os dois casos: usa novo se vier, mantém atual se não) | `refresh.test.ts` |
| **Access é JWT com `exp`?** | O `accessToken` tem `exp` para renovação proativa | `auth/refresh.ts` `lerExpiracao` + agendamento no `AuthManager` (`provider.ts`); se sem `exp`, só renovação reativa a 401/4001 | `refresh.test.ts` (`lerExpiracao`), `provider.test.ts` (agendamento) |
| **2FA** | Conta com 2FA → `twoFactor` na resposta → needs-login | `auth/provider.ts` `loginComCaptcha` ("conta com 2FA não suportada") | `provider.test.ts` |

### §9.2 Game loop
| Ponto §9.2 | O que confirmar | Arquivo/função se divergir | Teste |
|------------|-----------------|----------------------------|-------|
| **Sessão autenticada no shard** | Recebe `field-init`/`field-kill`; shard djb2(`sub`)%88 = o do navegador | `game/client.ts` `montarUrlWs`/`lerSub`; overrides `GAME_WS_URL`/`GAME_WS_PATH`/`GAME_WS_SHARDS` em `config.ts` | `client.test.ts` (montagem de URL/shard) |
| **Sem `cmid`** (VAL-02) | Servidor aceita WS sem `cmid`, ou fecha 4007 `machineLimited` | `game/client.ts` `montarUrlWs` (não envia `cmid`); 4007 já mapeado em `FECHAMENTOS_TERMINAIS` → `error` sem reconectar | `client.test.ts` (sem `cmid`; close 4007 → `error`) |
| **Headers do WS** | `Origin: <GAME_URL>` + UA undici passam pela Cloudflare com token válido | `game/client.ts` `criarSocketUndici` (header `Origin`); UA via dispatcher se preciso | `client.test.ts` |
| **Mensagens ao abrir** | Servidor responde `restart-state`→`restart-freeze` e `balls-get`→`balls` | `game/client.ts` `aoAbrir` (envia os dois) + dispatch de `restart-freeze`/`balls` | `client.test.ts` |
| **Retomada de hunt** | `hunt-resume` ao reconectar; `enter-hunt resume:true` não reinicia progresso | `game/client.ts` (`hunt-resume`→`huntRetomavel`); `game/loop.ts` `garantir-hunt` (`resume = huntRetomavel===slug`) | `loop.test.ts`, `client.test.ts` |
| **Hunt inválida / sem field-init** | 3 `enter-hunt` sem `field-init` → `lastError` "HUNT_SLUG inválido ou hunt ignorada: <slug>" | `game/loop.ts` `garantir-hunt` (contador `entradasSemFieldInit`) | `loop.test.ts` |
| **Formato de eventos** (VAL-04) | Campos reais de `field-kill`(`speciesName`)/`catch-result`(`success`)/`analyzer`(`seconds`,`balance`)/`balls`(`counts`) | `game/client.ts` switch de mensagens (521-591) | `client.test.ts` |
| **Drain sem `sleep-mode`** (VAL-05) | Farm offline continua após close 1000 sem `sleep-mode`? | Se não: `game/client.ts` `desconectar` envia `{"type":"sleep-mode"}` e aguarda `sleep-ok` antes do `close(1000)`; coordenação em `index.ts`/`drenar` (`loop.ts`) respeitando o timeout de 20 s | `client.test.ts` (novo: desconectar envia sleep-mode e espera sleep-ok) |
| **Close codes 4005-4009** (VAL-06) | 4005→needs-login, 4006→error, 4007→error, 4008→needs-login, 4009→needs-login, sem reconexão | `game/client.ts` `FECHAMENTOS_TERMINAIS` (93-103) | `client.test.ts` |
| **Política de reconexão / 4001 / manutenção 4003** | Backoff e invalidação do 4001 conforme o bundle; 4003 com 5/10/15 min | `game/client.ts` `reconectarComBackoff`/tratamento de 4001/4003 | `client.test.ts` |

**Regra de ouro (D-08):** nenhuma linha acima vira edit sem um trecho de evidência em EVIDENCE.md que
mostre a divergência, e o teste correspondente reproduz exatamente o comportamento observado. Suíte
inteira verde ao fim (baseline 175 testes).

---

## BLOCO 3 — Riscos e cenários de bloqueio (mudam o plano)

| Cenário | Comportamento esperado (já implementado) | Impacto no plano / Phase 2 (nota, sem agir) |
|---------|------------------------------------------|---------------------------------------------|
| **4007 sem `cmid`** (servidor exige fingerprint de máquina) | WS fecha 4007; `FECHAMENTOS_TERMINAIS[4007]` → `state: error`, `lastError` "limite de contas por máquina atingido (WS 4007)", **sem reconectar** e **sem forjar `cmid`** (`client.ts:100-103`) | Bloqueio a registrar (D-10). Phase 2 (AUTO-*) seria replanejada: sem `cmid` legítimo, worker Node puro não sustenta sessão → reavaliar viabilidade/escopo antes de executar o autoplay contra o real `[CITED: ROADMAP.md "se a Phase 1 encontrar um bloqueio…"]` |
| **Token do solver recusado** no login | `LoginError`/needs-login com `lastError` "login recusado (HTTP …)"; worker não fica em loop (`provider.ts:88-94`). D-02: tokens colados viram caminho principal | Phase 2: login 100% automatizado via solver fica inviável; o autoplay dependeria de tokens colados periódicos (relogin manual) → ajustar a rotina diária (AUTO-04) e a estratégia de refresh/relogin antes de executar |
| **Hunt inválida** (3 `enter-hunt` sem `field-init`) | `garantir-hunt` seta `lastError` "HUNT_SLUG inválido ou hunt ignorada: <slug>" após 3 tentativas; não aborta o loop (`loop.ts:113-116`) | Phase 2: a política de escolha/troca de hunt (AUTO-01) precisa tratar slugs inválidos e recuperação; o smoke deve entregar um `HUNT_SLUG` válido para não mascarar VAL-04 |
| **`docker stop` corta o drain** (timeout curto) | Drain espera ação em voo até 20 s (`index.ts`); SIGKILL antes disso perde o fim | Usar `docker stop --time 30`; se o drain de produção precisar de mais, Phase 2/ops ajustam o grace do orquestrador |
| **Farm offline só com `sleep-mode`** | Hoje o drain não envia `sleep-mode` (`client.ts:215-228`) | VAL-05 corrige o drain (enviar `sleep-mode`/esperar `sleep-ok`); Phase 2 (AUTO-04) depende desse achado para a rotina de pausas sem cancelar o farm offline |
| **Cloudflare/Turnstile variável por IP** | Sucesso intermitente do login via solver | Phase 2: estratégia de login resiliente (retry/janela) depende do que VAL-01 medir |

---

## BLOCO 4 — Pontos de incerteza que só a sessão real resolve

1. **Aceite do `captchaToken` do solver pelo backend.** O token vem do IP do solver (não do IP local,
   D-04); se o backend valida `remoteip` no siteverify, pode recusar. Só uma chave real responde (VAL-01).
2. **Backend exige `captchaToken` em todo login?** `TURNSTILE_ENABLED` é condicional; indeterminável
   sem tentar logar com/sem captcha na conta real.
3. **Servidor aceita WS sem `cmid` ou fecha 4007?** O probe anterior foi só com token inválido (close
   4001); o comportamento com token válido e sem `cmid` é desconhecido (VAL-02) — é o maior risco de
   bloqueio para a Phase 2.
4. **Shard do navegador bate com djb2(`sub`)%88?** A fórmula foi extraída do bundle; só uma sessão
   autenticada confirma o path real do WS (VAL-03).
5. **Formato completo e nomes de campos dos eventos** (`field-init`, `field-kill`, `catch-result`,
   `analyzer`, `balls`) além dos campos que o worker já lê — precisa dos frames crus do DevTools (VAL-04).
6. **`refresh` rotaciona o `refreshToken` e o access tem `exp`?** O worker trata os dois casos, mas o
   comportamento real do backend (rotaciona? emite `exp`?) só a sessão revela (VAL-06).
7. **Farm offline continua após close 1000 sem `sleep-mode`?** A hipótese do §9.2 é que talvez não;
   só medindo o progresso pós-`docker stop` se decide (VAL-05).
8. **Quais close codes 4005-4009 aparecem de fato em produção**, e com qual contexto — só observáveis
   provocando as condições (ex.: 4005 logando a conta noutro lugar) (VAL-06).
9. **Observabilidade de kills/capturas:** não estão no `/health` nem são logados por kill; o smoke
   depende do DevTools para o formato cru. (Ver Open Questions — pode exigir decisão do planejador.)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `docker stop` default dá ~10 s de SIGTERM antes do SIGKILL, insuficiente para o drain de 20 s | Pitfall 5 / Bloco 1.7 | Baixo — mitigado recomendando `--time 30`; se o default local diferir, só muda a flag |
| A2 | Fechar a aba do navegador do jogo libera a sessão da conta a tempo de o worker reconectar sem 4005 | Bloco 1.2/1.7 | Médio — se o servidor segurar a sessão por um tempo, pode haver 4005 transitório ao alternar; aguardar antes de religar |
| A3 | O baseline de VAL-05 (gold/capturas/`analyzer`) é lido de forma confiável pelo navegador sem "jogar" | Bloco 1.7 | Médio — abrir `/play` pode disparar farm online; ler rápido e sair; considerar usar o `analyzer` como métrica |
| A4 | Reiniciar o worker "rápido" reproduz `hunt-resume` (hunt ainda em andamento no servidor) | Bloco 1.6 | Baixo — se a hunt expirar antes, repetir com janela menor |

## Open Questions (RESOLVED)

1. **kills/capturas não são observáveis externamente.**
   - O que sabemos: vivem em `EstadoJogo` (`client.ts:22-23`), incrementados em `field-kill`/`catch-result`,
     mas fora do `HealthSnapshot` e sem log por kill. `/health` só mostra `lastAction`/`lastError`.
   - O que não está claro: se o smoke consegue evidência direta do contador subindo **pelo worker** sem
     uma sessão de navegador paralela (impedida por 4005).
   - Recomendação: VAL-04 captura o **formato cru** pelo DevTools (worker parado) e confirma o
     comportamento do contador **indiretamente** no worker (ausência de `lastError` "sem kills",
     `lastAction` "em hunt"). Se o usuário/planejador exigir observabilidade direta, isso seria uma
     **melhoria de instrumentação** (expor kills/capturas no `/health` ou logar `field-kill`) — mas é
     aprimoramento, não correção de divergência; decidir no `/gsd-plan-phase` se entra no escopo da
     Fase 1 ou fica para a Phase 2 (relatório da run AUTO-06).
   - **RESOLVED (no `/gsd-plan-phase 1`):** a instrumentação de kills/capturas ENTRA no escopo da Fase 1 (não fica para a Phase 2). O `1-PLAN.md` adiciona, de forma **não gated**, log por `field-kill`/captura e os contadores no `/health`, como pré-condição de VAL-04/SC3.

2. **O worker não loga a URL/shard do WS escolhido.**
   - O que sabemos: `montarUrlWs` é determinístico a partir do `sub` do JWT.
   - O que não está claro: VAL-03 compara o shard do navegador com o do worker calculando djb2 à mão.
   - Recomendação: aceitável para o smoke (fórmula verificada em `client.test.ts`). Se o planejador
     quiser facilitar a evidência, um log do shard escolhido seria aprimoramento de observabilidade.
   - **RESOLVED (no `/gsd-plan-phase 1`):** manter o cálculo djb2 manual no smoke para VAL-03 (fórmula já coberta em `client.test.ts`); não se adiciona log de shard. Caso a evidência de VAL-03 fique difícil na execução, um log do shard escolhido vira aprimoramento pontual, mas não é requisito.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node + pnpm + tsx | `pnpm start` do worker | A verificar na máquina do operador | — | — |
| undici (WS/HTTP) | Worker | ✓ (dep do pacote) | ^8.11.2 | — |
| Chrome/Chromium + DevTools | Extrair `pokeweb:tokens`, inspecionar WS, baseline VAL-05 | A verificar | — | Qualquer navegador Chromium com DevTools |
| Docker | VAL-05 (`docker stop` real) | A verificar | — | SIGTERM via `kill` no `pnpm start` exercita o mesmo handler (`index.ts` trata SIGINT/SIGTERM), mas D-05 pede o `docker stop` de produção para VAL-05 |
| Chave 2captcha | Caminho solver (VAL-01) | Fornecida pelo usuário na execução (D-01) | — | Caminho de tokens colados (D-02) |
| Conta descartável com personagem | Todo o smoke | Fornecida na execução (D-03) | — | — |

**Missing dependencies with no fallback:** nenhuma identificável sem a máquina do operador; a
verificação (`node`/`pnpm`/`docker --version`) roda no início da execução, não nesta pesquisa READ-ONLY.

## Validation Architecture

> `workflow.nyquist_validation: true` em `.planning/config.json` → seção incluída.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (monorepo) |
| Config file | `packages/worker` usa o vitest do monorepo (sem config próprio dedicado observado) |
| Quick run command | `pnpm --filter worker test` (= `vitest run`) |
| Full suite command | `pnpm -r test` (suíte inteira do monorepo) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VAL-01 | Login via solver / tokens colados; recusa → needs-login | unit | `pnpm --filter worker test provider solver` | ✅ `provider.test.ts`, `solver.test.ts` |
| VAL-02 | WS sem `cmid`; 4007 → error sem reconectar | unit | `pnpm --filter worker test client` | ✅ `client.test.ts` |
| VAL-03 | Shard djb2(`sub`)%88 e montagem de URL | unit | `pnpm --filter worker test client` | ✅ `client.test.ts` |
| VAL-04 | Dispatch de `field-kill`/`catch-result`/`analyzer`; watchdog de stall | unit | `pnpm --filter worker test client loop` | ✅ `client.test.ts`, `loop.test.ts` |
| VAL-05 | Drain (close 1000) e, se necessário, `sleep-mode`/`sleep-ok` | unit | `pnpm --filter worker test client` | ✅ `client.test.ts` (novo caso se houver correção) |
| VAL-06 | Rotação do refresh, `exp` do JWT, close codes 4005-4009 | unit | `pnpm --filter worker test refresh client` | ✅ `refresh.test.ts`, `client.test.ts` |
| VAL-07 | Toda correção coberta por teste; suíte verde | unit | `pnpm -r test` | ✅ suíte inteira (baseline 175) |

### Sampling Rate
- **Per task commit:** `pnpm --filter worker test` (arquivo afetado).
- **Per wave merge:** `pnpm -r test`.
- **Phase gate:** suíte inteira verde (≥175 testes) antes de `/gsd-verify-work`.

### Wave 0 Gaps
- None — a infraestrutura de teste do worker (vitest + `__fixtures__/` com `jwt.ts`, `login.html`,
  `login-chunk.txt`) já cobre os módulos exercitados. Correções de VAL-07 adicionam casos nos
  arquivos existentes, seguindo o padrão atual.

## Security Domain

> Fase de validação com correções cirúrgicas; não cria nova superfície de rede. O risco de segurança
> dominante é **vazamento de segredos** (tokens, senha, chave do solver) e a **integridade da conta**.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Reuso do fluxo existente (`/api/auth/login` + Turnstile, refresh com `exp`); sem credenciais versionadas |
| V3 Session Management | yes | Uma sessão por conta (4005); tokens só em memória/`/health` (nunca em disco versionado) |
| V6 Cryptography / Secrets | yes | Segredos só via ambiente/`.env` ignorado pelo git; `ocultarSegredos` em logs (`provider.ts:38-43`); sanitização manual antes de EVIDENCE.md/GAME.md |
| V5 Input Validation | partial | `config.ts` valida URLs/porta/caminho de auth antes de subir |
| V4 Access Control | no | Sem nova autorização introduzida nesta fase |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Segredo em log/commit/EVIDENCE.md | Information Disclosure | `ocultarSegredos` + sanitização manual; `.env` fora do versionamento |
| Ban da conta por automação | Repudiation/abuse | Conta descartável (D-03); smoke só observa (não compra/vende/forja `cmid`) |
| Derrubar outra sessão (4005) | Denial of Service (auto-inflingido) | Uma sessão por conta; alternar worker/navegador |

## Sources

### Primary (HIGH confidence)
- `packages/worker/src/config.ts`, `index.ts`, `health.ts`, `auth/{provider,solver,refresh}.ts`,
  `game/{client,loop}.ts` e `.test.ts` correspondentes — lidos em 2026-10-12 (comportamento do worker).
- `packages/worker/GAME.md` §3, §4.3, §4.4, §6, §9.1, §9.2 — protocolo e pontos de verificação.
- `.planning/phases/phase-1-validacao-com-conta-real/CONTEXT.md` — decisões D-01..D-08.
- `.planning/REQUIREMENTS.md` (VAL-01..VAL-07), `.planning/ROADMAP.md` (Phase 1), `.planning/config.json`.

### Secondary (MEDIUM confidence)
- `packages/worker/package.json` — scripts (`start`=`tsx src/index.ts`, `test`=`vitest run`) e deps (undici ^8.11.2).

### Tertiary (LOW confidence)
- Comportamento do servidor real de `poke.idleworld.online` — **não observado nesta pesquisa**
  (READ-ONLY); é exatamente o que o smoke mede. Todos os pontos server-side de §9 permanecem "a confirmar".

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — lido direto de `package.json` e `src/`; nenhuma dependência nova.
- Architecture / mapa §9→código: HIGH — cada ponto citado com arquivo/função/linha verificados.
- Comportamento do servidor real: a medir — por design, só o smoke responde (LOW até a execução).
- Pitfalls / riscos: MEDIUM-HIGH — derivados do código e de GAME.md; alguns dependem do runtime (A1-A4).

**Research date:** 2026-10-12
**Valid until:** ~2026-11-11 (30 dias; reavaliar se o bundle de `/play`/`/login` ou os chunks mudarem,
o que pode invalidar a sitekey e o cálculo de shard).
