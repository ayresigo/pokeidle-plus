# GAME.md — Protocolo do PokeIdle (referência para o módulo `game/`)

Jogo-alvo: **`https://pokeidle.io`** — "The idle Pokémon MMORPG" que o usuário realmente joga.
Documento de referência para a auth e o game loop do worker. Toda afirmação factual tem a fonte ao
lado. O que não foi observado está em **§8 Desconhecido** ou marcado `[INFERENCE]`.

Fonte do protocolo: validação real da Phase 1 (`.planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md`,
VAL-01..04, 2026-10-12) + o bundle `https://pokeidle.io/app.js` (lido read-only) + o código do worker.
O deployment antigo `poke.idleworld.online` (outro protocolo) está só no **Apêndice — Histórico** no fim.

## 1. Qual jogo é o alvo

- **URL: `https://pokeidle.io`**. Páginas de auth em `/auth/*`; o jogo roda client-side (bundle `app.js`).
- O farm é **server-authoritative**: o herói do time batalha sozinho no servidor, mesmo com a página
  parada/offline; o cliente só envia comandos e recebe eventos. Fonte: EVIDENCE.md VAL-04 (kills chegam
  do servidor via `batalha`).
- Comunicação em jogo: **WebSocket nativo raw** com mensagens JSON `{t, ...}` (campo `t` = tipo), no mesmo
  host (`wss://pokeidle.io`), **sem shard, sem `?token`, sem `cmid`**. Fonte: EVIDENCE.md VAL-02/03.
- Regra oficial: limite de 4 contas por jogador; **uma sessão viva por conta** (logar em outro lugar
  derruba a anterior). Fonte: regras do jogo + comportamento observado.

## 2. Stack do cliente

- Front-end web; o jogo (`/app`) é client-side e abre o WebSocket. Fonte: bundle `app.js`.
- Auth via REST em `/auth/*`; token Bearer único guardado no navegador (localStorage). Fonte: EVIDENCE.md VAL-01.

## 3. Fluxo de login (pokeidle.io)

### 3.1 Endpoints de auth
Fonte: EVIDENCE.md VAL-01 (probe real, HTTP 200) + bundle.

- **`POST /auth/entrar`** — body `{ id, senha, turnstileToken, dispositivo }` →
  `{ nick, token, provedor, precisaNick, termosVersao }`.
  - `id` = e-mail ou usuário; `senha` = senha; `turnstileToken` = token do Cloudflare Turnstile resolvido;
    `dispositivo` = UUID por install (id de dispositivo do cliente, **não** fingerprint anti-limite).
  - Sucesso: `provedor:"local"` (conta nativa), `token` = Bearer único. `precisaNick:true` → conta sem
    personagem (tratar como needs-login).
  - `turnstileToken` inválido → `400 {"erro":"login.turnstileFalhou"}`. **O backend exige captcha em todo
    login** (VAL-01 CONFIRMADO).
- **`GET /auth/provedores`** → `{ google, discord, confirmacaoEmail, turnstile }`. O campo **`turnstile`** é
  a **sitekey dinâmica** do Turnstile (ex. observada: `0x4AAAAAAEccJgXg19_AZoDr`). Não hardcodar; ler daqui.
  Override: `TURNSTILE_SITEKEY`.
- Outros auth (não usados pelo worker): `/auth/criar`, `/auth/conta`, `/auth/recuperar`, `/auth/redefinir`,
  `/auth/nick`, `/auth/excluir`, `/auth/twitch`, `/auth/kick`, `/auth/termos`. Fonte: EVIDENCE.md VAL-01.
- **Não há endpoint REST de refresh.** A renovação de sessão vem pelo WS (`sessao.renovada`, §4.2).

### 3.2 Solver do Turnstile
- O `turnstileToken` é resolvido por `TurnstileTaskProxyless` (2captcha) no **IP do solver**; o backend
  **não** faz bind de `remoteip` → o token do IP do solver é aceito. **Login automático via solver
  CONFIRMADO** (VAL-01, HTTP 200). `size:"flexible"`, sem `action`/`cData`.

### 3.3 Sessão e token
- Token Bearer **único** (não há par access/refresh no servidor). No navegador fica no localStorage.
- No worker, o modelo interno é um **par** `accessToken/refreshToken` com `refreshToken = token` (decisão
  D-S6 opção (a) da Phase 01.1: menor blast radius; a UI pede um token único e preenche os dois campos com
  o mesmo valor). Token único ponta a ponta está no backlog.
- O access é um **JWT com `exp`**; o worker agenda renovação proativa pelo `exp` (margem 60 s, piso 30 s).
  Como não há refresh REST, quando o access expira sem um `sessao.renovada` recente, o worker faz
  **re-login via solver**. Fonte: `auth/provider.ts` (`AuthManager`), `auth/refresh.ts`.
- **Uma sessão viva por conta**: logar a mesma conta em outro lugar derruba a anterior (sinal exato do
  pokeidle.io — close code ou evento — a confirmar no smoke, §9).

## 4. Protocolo WebSocket (fonte de verdade do game loop)

Fonte: EVIDENCE.md VAL-02/03/04 (frames reais capturados 2026-10-12) + bundle `app.js`.

### 4.1 Conexão e handshake
- **URL**: `wss://pokeidle.io` (raw, mesmo host). Sem shard, sem `?token`, sem `cmid`. Override do host:
  `GAME_WS_URL`; o default é a origem de `GAME_URL` em `wss://`.
- **Primeiro frame (enviado pelo worker)**: `{ t:"hello", nick, token, delta:1, dispositivo }`. O `token`
  (de `/auth/entrar`) e o `dispositivo` entram aqui. `nick` é derivado do token.
- **Ack do servidor**: `{ t:"welcome", estado:{...} }` (level, xp, gold, items). Marca a sessão em jogo.
- **Keepalive**: worker envia `{ t:"ping" }`; servidor responde `{ t:"pong" }`.
- **Fechamento limpo (drain)**: `ws.close(1000)`.

### 4.2 Mensagens recebidas (observadas)
- `welcome` — ack do handshake + `estado`.
- `campo.init` — `{ slug, mapa, box, heroi, mobs[] }`: entrou na hunt (resposta de `hunt.select`).
- `campo` — `{ seq, ts, heroi, mobs[], alvo, fora[] }`: estado espacial, alta frequência; o herói
  auto-batalha, o worker **não** precisa mover.
- `batalha` — `{ ev:[...] }`, onde cada `ev[i].k` é:
  - `ataque` — `{ por, slot, golpe, tipo, dano, ef, stab, hpAlvo, aoe }`.
  - **`morte`** — `{ quem:"selvagem", slot, nome, xp, xpTreinador, xpPokemon, lootBoost, ouro, drops:[{nome,qtd}] }`.
    **Kill = `k==="morte" && quem==="selvagem"`** (traz espécie, xp, ouro, drops).
  - `captura` — captura de um selvagem.
  - `spawn` — novo selvagem no campo.
  - `aviso` — `{ msg }` (ex.: slug inválido → `"<slug>" não é uma área caçável`).
  - `hunt` — `{ slug, nome, trocaLivreEm }`.
- `estado` — `{ estado:{ xp, gold, items:{...}, dexMud:{ <speciesId>:{ k:<kills>, c:<capturas> } }, pkMud:[{ id, speciesId, level, xp, ... }] } }`.
  `dexMud` dá os contadores autoritativos acumulados; o worker reconcilia os contadores locais acima do baseline.
- `sessao.renovada` — `{ token }`: o token renova pelo próprio WS. O worker troca o token em uso
  (`tokenHello`) e publica via `health.setTokens` (write-back do v1.0 propaga à central).
- `erro` — `{ msg | erro }`: antes do `welcome` = rejeição de handshake (token); em jogo = aviso.
- `pong` — resposta ao ping.

### 4.3 Mensagens enviadas (usadas pelo worker)
- `{ t:"hello", nick, token, delta:1, dispositivo }` — handshake.
- `{ t:"hunt.select", slug }` — entrar/retomar a hunt. HUNT_SLUG correto de exemplo: **`bellsprout`** (dois L).
- `{ t:"ping" }` — keepalive.
- (Phase 2, só mapeados, não usados nesta fase: `centro.curar`, `centro.andar`, `shop.buy`/`loja.comprar`,
  `shop.autoVendaLoot`, `team.move`/`team.active`, `pokemon.evoluir`/`refinar`, `auto.set`, `chat.send`.)

## 5. Loop idle (o que o bot faz nesta fase)

1. **Autenticar** (solver ou token colado) → abrir o WS → `hello` → `welcome`.
2. **Escolher hunt**: `{ t:"hunt.select", slug }` com o `HUNT_SLUG`. O herói batalha sozinho.
3. **Observar kills/capturas**: `batalha/morte` e `estado.dexMud`; publicar no `/health`.
4. **Manter a sessão**: ping/pong, reconexão com backoff, watchdog de stall (reenvia `hunt.select`).
5. **Drenar**: no SIGTERM, parar o loop, fechar o WS com 1000 (farm offline: ver VAL-05 no §9).

Compras, vendas, cura, rotina e troca de hunt são **Phase 2 (autoplay)**, fora desta fase.

## 6. Anti-bot

- **Cloudflare Turnstile no login** (sitekey dinâmica de `/auth/provedores`): obrigatório em todo login
  (VAL-01). O solver 2captcha é aceito (login automático viável).
- **Cloudflare na borda** + cookie `pokeidle_gw` (gateway/clearance) nas requisições do navegador.
- **Uma sessão por conta**; regras oficiais anti-automação (macros/auto-clickers proibidos; trade com
  botter → ban; multi-conta acima de 4 → deleção). Server-authoritative → padrões inumanos são detectáveis.
  [INFERENCE] Tratar como risco; manter jitter nas ações.

## 7. Implicações para o worker

1. `GAME_URL` default: `https://pokeidle.io`.
2. Auth: `POST /auth/entrar` com `{id, senha, turnstileToken, dispositivo}`; sitekey de `/auth/provedores`;
   solver 2captcha; fallback por token colado (único). Sem refresh REST → re-login via solver no `exp`.
3. WS raw `wss://pokeidle.io`; handshake `hello`→`welcome`; kills por `batalha/morte`; contadores por `dexMud`.
4. `dispositivo` = UUID por install (`DISPOSITIVO`, default `randomUUID()`); **não** é fingerprint anti-limite.
5. Robustez: reconexão com backoff+jitter (teto 24 s nas 5 primeiras falhas, depois 5 min), heartbeat
   ping/pong, `invalidar` ≤1×/5 min na rejeição de token (transitório → reconecta; definitivo → needs-login),
   watchdog-stall, drain com close 1000. Tratamento diferenciado de close/erro (sessão substituída,
   manutenção) a confirmar no smoke (§9).

## 8. Desconhecido (não observado)

- **Close codes / sinal de sessão substituída / sinal de manutenção reais do pokeidle.io** (o handshake é
  por frame; erros vêm por `erro`/`batalha.aviso`; não se sabe quais close codes o servidor usa). → §9, smoke.
- **Farm offline / Modo Soneca**: se o farm continua após `close(1000)` sem um comando de soneca. → VAL-05.
- **Renovação via `sessao.renovada`**: periodicidade e formato exato. → VAL-06.
- **Bodies de ações in-game** (cura `centro.curar`, compra/venda) e catálogos: Phase 2.
- **Create-character / verificação de e-mail**: fluxo não explorado.

## 9. Pontos de verificação (confirmado / pendente / gap)

### 9.1 Auth
- **Solver aceito no login → CONFIRMADO** (2026-10-12). `POST /auth/entrar` com `turnstileToken` do
  `TurnstileTaskProxyless` → HTTP 200 `{token, provedor:"local"}`. Sem bind de `remoteip`.
- **Captcha exigido em todo login → CONFIRMADO.** `turnstileToken` inválido → `400 login.turnstileFalhou`.
- **Sitekey dinâmica → CONFIRMADO.** Lida de `/auth/provedores.turnstile`; override `TURNSTILE_SITEKEY`.
- **Refresh REST → REMOVIDO-COM-EVIDÊNCIA.** Não existe no pokeidle.io; renovação pelo WS (`sessao.renovada`).
- **Rotação do token via `sessao.renovada` → PENDENTE (VAL-06, smoke):** formato/periodicidade.

### 9.2 Game loop / WS
- **Sem shard / sem `cmid` / sem `?token` (VAL-02/03) → CONFIRMADO/REMOVIDO-COM-EVIDÊNCIA.** Handshake por
  frame `hello` → `welcome`. Sharding djb2 (88) do protocolo antigo removido do worker.
- **`hunt.select` → `campo.init` (VAL-03) → CONFIRMADO.** Slug inválido → `batalha/aviso`. Slug correto `bellsprout`.
- **Kills por `batalha/morte`, contador por `dexMud` (VAL-04) → CONFIRMADO.** Smoke: `/health` subiu 0→28 em ~75 s,
  watchdog não disparou à toa.
- **Robustez preservada (confirmar com teste):** backoff+jitter+teto longo, heartbeat ping/pong,
  `invalidar` ≤1×/5 min, transitório vs definitivo na rejeição de token, watchdog-stall, drain close 1000.
- **Tratamento diferenciado de close codes / sessão substituída / manutenção → GAP (wave 6, gated por smoke).**
  Hoje o worker reconecta para qualquer close; a política conservadora (definitivo → needs-login/error sem
  reconectar; só transitório reconecta) é wired com os sinais que o smoke observar; o não observado fica gap.
- **Reciclagem `restart-freeze`/`restart-resumed` → REMOVIDO-COM-EVIDÊNCIA** (eventos do protocolo antigo);
  reavaliar só se o smoke revelar equivalente no pokeidle.io.
- **Backoff escalonado de manutenção (5/10/15 min) → GAP (wave 6):** só adicionado se o smoke mostrar um
  sinal de manutenção próprio; senão o backoff genérico cobre.
- **`sessao.renovada` → `tokenHello` + `health.setTokens` (write-back do v1.0) → implementado na wave 3**
  (coberto por teste); confirmação ao vivo em VAL-06.
- **Farm offline após drain / `sleep-mode` (VAL-05) → PENDENTE (smoke).** Se não continuar sem soneca, o
  drain passa a enviar o comando de soneca e esperar o ack antes do `close(1000)`.

---

## Apêndice — Histórico (deployment antigo `poke.idleworld.online`)

O worker e este documento foram originalmente construídos para `poke.idleworld.online`, um **deployment
diferente, com outro protocolo** (endpoint `POST /api/auth/login` com `{identifier, password, captchaToken}`,
sitekey hardcoded `0x4AAAAAADkKBnFEMDt0MGBM`, WebSocket com **sharding djb2** em `wss://.../ws{shard}?token=&v=2`,
eventos `field-init`/`field-kill`/`enter-hunt`/`balls-get`/`restart-state`, close codes `4001`-`4009`).
A Phase 1 (VAL-01, 2026-10-12) descobriu que o jogo real é `pokeidle.io` e a Phase 01.1 migrou tudo para o
protocolo acima. Este parágrafo fica só como registro histórico — **nada aqui descreve o jogo atual**.
Mapa completo da divergência: `.planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md`.
