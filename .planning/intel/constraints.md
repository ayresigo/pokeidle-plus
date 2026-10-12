# Constraints (intel sintetizada)

Gerado por gsd-doc-synthesizer em 2026-10-12 (modo new). Fontes SPEC: docs/plans/2026-10-11-multiacc-pokeidle-design.md (precedência 0) e packages/worker/GAME.md (precedência 1). Itens superados por resolução em `.planning/INGEST-CONFLICTS.md` estão marcados como [SUPERADO].

## Do design (docs/plans/2026-10-11-multiacc-pokeidle-design.md)

### C-design-01 Auth central (JWT)
- type: api-contract
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Componentes/Central API; Fluxos/Auth)
- conteúdo:
  - access JWT de 15 min + refresh de 30 d (o refresh fica em arquivo no volume local)
  - grace offline de 7 dias no refresh; expirado → UI read-only
  - workers em execução nunca são derrubados por auth; revogação efetiva no próximo refresh
  - fluxo: UI local → control-plane → central

### C-design-02 Criptografia de segredos
- type: nfr
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Componentes/Central API)
- conteúdo: senhas PokeIdle (e tokens/solver key, conforme o modelo de dados) criptografadas em repouso com AES-256-GCM, chave em env var.

### C-design-03 Modelo de dados central
- type: schema
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Modelo de dados central)
- conteúdo:
  - `users`: id, username, password_hash, role (admin/user), active
  - `refresh_tokens`: id, user_id, token_hash, expires_at, revoked_at
  - `accounts`: id, user_id, label, pokeidle_user, pokeidle_pass_enc, access_token_enc, refresh_token_enc, proxy_url, solver_key_enc, created_at
  - `releases`: id, version, channel, image_digest, changelog, published_at
  - nota: colunas físicas em camelCase padrão Prisma (sem `@map`), tabelas em snake_case via `@@map`; acesso sempre via Prisma Client

### C-design-04 Componentes locais
- type: nfr
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Arquitetura; Componentes)
- conteúdo:
  - UI: Next.js App Router + Tailwind em :3000 (vigente: Next.js 16, ver INFO em INGEST-CONFLICTS.md)
  - control-plane: Fastify + dockerode; valida JWT em todo endpoint, busca configs no central (cache em memória), cria/destrói/reinicia workers via Docker socket, executa updates, faz health-check e backoff
  - worker: efêmero, nunca no compose; `node:22-slim`, sem browser, `ws` + `fetch`, ~50 MB por conta, config por env, healthcheck HTTP local, logs JSON no stdout, drain em SIGTERM, sem credencial do central
  - [SUPERADO] "O jogo é server-authoritative (Socket.IO + REST ...)" → WebSocket nativo (ver C-game-05)

### C-design-05 Login (TokenProvider)
- type: protocol
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Componentes/Login)
- conteúdo:
  1. Solver Turnstile (primária): chave 2captcha-compatível por conta ou global; worker resolve e faz `POST /api/auth/login`
  2. Token colado (fallback): `sessionStorage['pokeweb:tokens']` colado na UI, criptografado no central
  - refresh automático via `/api/auth/refresh` (sem CAPTCHA); tokens renovados persistidos no central pelo control-plane
  - [SUPERADO no detalhe do código] "Sessão derrubada (WS close 4001)" → 4001 = token recusado, 4005 = sessão substituída (ver C-game-05)

### C-design-06 Orquestração
- type: nfr
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Orquestração)
- conteúdo: workers via dockerode, nome `mpw-worker-<accountId>`, labels de rastreio, restart com backoff exponencial 1m → 15m pelo control-plane; compose declara apenas `web` e `control-plane`.

### C-design-07 Fluxo de update
- type: protocol
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Fluxos/Update)
- conteúdo: `GET /version` no boot e a cada 6 h; automático: pull, recreate rolling dos workers (drain SIGTERM), updater efêmero recria control-plane + UI e se autodestrói; manual: badge na UI; compose referencia `:stable`; digest exato registrado para rollback em um clique (escopo em WARNING); workers e control-plane versionam de forma independente (contrato de env vars versionado).

### C-design-08 Erros por design
- type: nfr
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Erros por design)
- conteúdo:
  - central fora → grace de 7 dias; workers seguem; sem start/config novo (o texto original diz "VPS fora"; vigente: central no k8s)
  - GHCR falhou → mantém a imagem atual, retry com backoff, badge de erro
  - Docker socket indisponível → UI mostra "Docker não responde"
  - worker em crash-loop → backoff + flag na UI após 3 falhas
  - update quebrado → rollback por digest

### C-design-09 Estratégia de testes
- type: nfr
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Testes (Vitest))
- conteúdo:
  - unit: game loop, parser de versão, grace de auth ([SUPERADO] "game loop vs DOM mockado": worker sem DOM)
  - integração: control-plane contra Docker real (DinD no CI); central API contra Postgres de teste
  - E2E smoke: [WARNING aberto] design diz `mpw-worker-mock`; o README e o repo usam worker real + `e2e/fake-game` com Playwright

### C-design-10 Riscos aceitos
- type: nfr
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Riscos)
- conteúdo:
  - solver Turnstile é aposta não validada; fallback de token colado já está no design
  - game loop depende do protocolo WS/REST, isolado no módulo `game/`
  - central é dependência dura para start/config (decisão do usuário: sem banco local)
  - automação pode violar os ToS do PokeIdle; risco assumido pelo usuário

## Do GAME.md (packages/worker/GAME.md)

### C-game-01 Alvo
- type: protocol
- source: packages/worker/GAME.md (seção 1)
- conteúdo: o alvo é Poke Idle World, `https://poke.idleworld.online/` (`GAME_URL` padrão). Não confundir com pokeidle.net, pokeidle.web.app, pokeidle.com, pokeidle.fun, pokaidle.com.

### C-game-02 Auth do jogo
- type: api-contract
- source: packages/worker/GAME.md (seções 3.2, 3.3 e 9.1)
- conteúdo:
  - `POST /api/auth/login` `{ identifier, password, captchaToken }`; 2FA → `twoFactor` + `twoFactorToken` → `POST /api/auth/2fa/login` `{ twoFactorToken, code }` (worker: 2FA → needs-login)
  - `POST /api/auth/refresh` `{ refreshToken }` → novo `accessToken` (rotação do refresh não confirmada; o worker trata os dois casos)
  - `POST /api/auth/google`, `/api/auth/motus` existem (não usados)
  - Turnstile sitekey `0x4AAAAAADkKBnFEMDt0MGBM` (override `TURNSTILE_SITEKEY`); `TURNSTILE_ENABLED = !!sitekey`
  - tokens em `sessionStorage["pokeweb:tokens"]` como `{ accessToken, refreshToken }`; REST com `Authorization: Bearer`
  - renovação proativa pelo `exp` do JWT com margem de 60 s (piso de 30 s entre refreshes)
  - pós-login: `GET /api/characters/me` → `/play`, `/verify-email` ou `/create-character`

### C-game-03 Sessão única por conta
- type: nfr
- source: packages/worker/GAME.md (seções 3.3 e 6)
- conteúdo: uma sessão viva por conta; logar em outro lugar derruba a anterior (WS 4005 `replaced`). Relogar em menos de ~5 min cancela o farm offline (Modo Soneca).

### C-game-04 REST do jogo
- type: api-contract
- source: packages/worker/GAME.md (seção 4.3)
- conteúdo:
  - `GET /api/characters/me` → `{ character, needsEmailVerification }`
  - `GET /api/auth/me`
  - `POST /api/game/balls/buy` `{ ballId, qty }` → `{ counts, gold, bought }` (Bearer obrigatório)
  - `GET /api/game/depot` → `{ depot: [{ itemId, quantity }] }`
  - `GET /api/game/map-markers` (público, sem Bearer) → `{ map: { w, h }, hunts: [{ slug, name, looktype, level, pixel, area, range }] }`
  - `GET /api/game/used-balls`
  - `POST /api/game/shop/sell` `{ items: [{ itemId, qty }] }` → `{ gold, goldGained, soldCount }`
  - `POST /api/game/flint/sell` `{ itemId, qty }` → `{ sold, item, goldGained }`
  - estáticos: `/game/items.json`, `/game/creatures.json`

### C-game-05 WebSocket do jogo
- type: protocol
- source: packages/worker/GAME.md (seções 2 e 4.4)
- conteúdo:
  - WebSocket nativo (não Socket.IO), JSON `{type, ...}`
  - URL: base `wss://poke.idleworld.online/ws`; `shard = abs(djb2(sub)) % 88`; shard 0 → `/ws`, shard k → `/ws{k}`; falha ao ler o JWT → base sem shard
  - auth na query: `?token=<accessToken>&v=2` (+ `&cmid=` no cliente oficial; o worker não envia)
  - heartbeat: checagem a cada 10 s; 45 s sem nada → `{"type":"ping"}`; 15 s sem resposta → fecha e reconecta
  - reconexão do bundle: `t = min(24000, 1500·2^min(n-1,4))` ms + jitter `random·t`
  - close: 4001 token recusado; 4002 reload; 4003 manutenção; 4005 replaced; 4006 ipLimited; 4007 machineLimited; 4008 namelock; 4009 trocar senha
  - enviados pelo worker: `enter-hunt {slug, resume}`, `leave-hunt`, `set-city {slug}`, `restart-state`, `restart-resume`, `balls-get`, `ping`
  - recebidos relevantes: `field-init`, `field-none`, `field-lost`, `field-kill`, `field-teleport-city`, `hunt-cooldown`/`fishing-cooldown`, `hunt-resume`, `restart-freeze`, `restart-resumed`, `catch-result`, `balls`, `inventory`, `pokes`, `analyzer`, `sleep-ok`

### C-game-06 Políticas do worker (decisões em cima do protocolo)
- type: protocol
- source: packages/worker/GAME.md (seção 9.2)
- conteúdo:
  - reconexão: backoff do bundle nas 5 primeiras falhas seguidas, depois teto de 5 min; o contador só zera com mensagem do servidor; 4003 → 5, 10 e depois 15 min com jitter de até −20%
  - 4001: invalida no máximo 1 vez a cada 5 min; falha transitória de refresh → reconecta com backoff; falha definitiva → needs-login. 4005 → needs-login; 4006/4007 → error; 4008/4009 → needs-login; sempre sem reconectar e com prioridade sobre reciclagem
  - reciclagem (após `restart-resumed` ou 8 s sem ele): no máximo 1 a cada 60 s; 3 reciclagens sem `field-init`/`field-kill` → para e avisa no lastError até chegar `restart-freeze` com `frozenAt` novo
  - watchdog de stall: leave+enter após 10 min sem kill; 3 recuperações sem kill → lastError `hunt <slug> sem kills há <N>min` e tentativas de hora em hora
  - hunt sem `HUNT_SLUG`: menor `level > 0` fora de cidades/ginásios via map-markers; 3 `enter-hunt` sem `field-init` → lastError `HUNT_SLUG inválido ou hunt ignorada: <slug>`
  - ao abrir: envia `restart-state` e `balls-get`; headers `Origin: <GAME_URL>` + UA do undici
  - drain: para o loop, espera a ação em voo (até 20 s), fecha com 1000, sem `sleep-mode` (pendente de confirmação)
  - env overrides: `GAME_URL`, `GAME_WS_URL`, `GAME_WS_PATH` (padrão `/ws`), `GAME_WS_SHARDS` (padrão 88), `HUNT_SLUG`, `TURNSTILE_SITEKEY`

### C-game-07 Anti-bot e regras oficiais
- type: nfr
- source: packages/worker/GAME.md (seção 6)
- conteúdo:
  - Cloudflare Turnstile no login; Cloudflare challenge-platform na borda; checagem de UA/fingerprint
  - regras oficiais (https://poke.idleworld.online/rules): macros/auto-clickers proibidos (seção 03); trade com botter → ban permanente (seção 09); mais de 4 contas por jogador sem autorização → deleção (seção 10). O design fala em "4 contas/IP": WARNING aberto
  - detecção comportamental server-side provável [INFERENCE no GAME.md]

### C-game-08 Pendências de verificação manual (não confirmadas)
- type: protocol
- source: packages/worker/GAME.md (seções 8, 9.1 e 9.2)
- conteúdo:
  - o jogo aceita `captchaToken` de `TurnstileTaskProxyless` (IP do solver)?
  - o backend exige `captchaToken` em todo login?
  - o refresh rotaciona o refreshToken?
  - o access é JWT com `exp`?
  - sessão autenticada no shard calculado recebe `field-init`/`field-kill`?
  - sessão sem `cmid` aceita, ou leva a 4007?
  - `restart-state`/`balls-get` respondidos?
  - `hunt-resume` + `enter-hunt resume:true` preserva o progresso?
  - farm offline continua após `docker stop` sem `sleep-mode`?
  - 4005-4009 em produção
  - política de compra de balls/venda de loot ainda não definida (bodies confirmados, fora da Task 20)
  - payloads de `use-heal`, `joy-heal`, `switch`, `catch`; rate limits; detecção de headless; fluxo de `/create-character` e `/verify-email`
