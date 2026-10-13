# GAME.md — Pesquisa PokeIdle (referência para o módulo `game/`)

Data da pesquisa: 2026-10-11. Documento de referência para o game loop do worker (Task 19). Toda afirmação factual tem a fonte ao lado. O que não foi confirmado está na seção **Desconhecido**.

> ⚠ **ATENÇÃO (2026-10-12, Fase 1 — validação real):** o jogo que o usuário joga é **`https://pokeidle.io`**, NÃO `poke.idleworld.online`. Todo este documento (e o código atual do worker) descreve `poke.idleworld.online`, que é **outro deployment/protocolo** e por isso o worker nunca autenticou contra a conta real. O servidor real usa `POST /auth/entrar` com `{id, senha, turnstileToken, dispositivo}`, sitekey dinâmica em `GET /auth/provedores`, token Bearer único e WebSocket raw em `wss://pokeidle.io`. O **login automático via solver 2captcha foi CONFIRMADO** no `pokeidle.io` (HTTP 200). Mapa completo e divergências em `.planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md` (VAL-01). Adaptar o worker ao `pokeidle.io` é a correção central da Fase 1 (ver §9.1).

## 1. Qual jogo é o alvo

Existem vários jogos com nome parecido. O alvo deste projeto é **Poke Idle World** ("The idle Pokémon MMORPG"):

- **URL oficial: `https://poke.idleworld.online/`** — landing page com botões PLAY NOW (`/login`) e CREATE ACCOUNT (`/register`). Fonte: <https://poke.idleworld.online/>
- É o único "PokeIdle" com **contas, login e limite de multi-conta**: a regra oficial limita a 4 contas por jogador (regra vigente desde 15/07/2026), o que bate com o requisito do design ("PokeIdle limita 4 contas/IP"). Fonte: <https://poke.idleworld.online/rules> (seção 10, "Multi Accounts")
- Ecossistema de ferramentas de terceiros confirma o domínio: userscript `pokeidle_bettermap` tem `@match https://poke.idleworld.online/*` (fonte: <https://github.com/Phoslead/pokeidle_bettermap/blob/main/pokeidle_bettermap.user.js>); o launcher PokeGrid roda "4 contas de Poke Idle World" com `GAME = 'https://poke.idleworld.online'` (fonte: <https://github.com/soufoka/PokeGrid-source/blob/main/main.js>).

**Não confundir** (jogos diferentes, sem login de conta no mesmo sentido):
- `pokeidle.net` — PokeIdle clássico, open source, save em localStorage, sem conta online. Fonte: <https://pokeidle.net/README.md>
- `pokeidle.web.app`, `pokeidle.com`, `pokeidle.fun`, `pokaidle.com` — outros projetos/clones sem relação. Fontes: páginas homônimas.

## 2. Stack do cliente

- Front-end **Next.js (App Router, Turbopack)**; páginas de auth renderizadas no servidor, jogo (`/play`) é client-side. Fonte: HTML de <https://poke.idleworld.online/login> (chunks `/_next/static/chunks/*`, `self.__next_f`).
- O jogo em si é um **canvas WebGL fixo de 1600×832** com overlays de DOM para janelas (mapa, mercado, chat, avisos). Fonte: PokeGrid `index.html` ("o canvas do jogo e fixo nesse tamanho", proporção 1600/832) — <https://github.com/soufoka/PokeGrid-source/blob/main/index.html>
- **O farm é server-authoritative**: o jogo continua farmando mesmo com a página a 1 fps (ou em modo "soneca" offline), porque roda no servidor. Fonte: PokeGrid FAQ, seção de modos de tela ("o farm continua, porque roda no servidor") — <https://github.com/soufoka/PokeGrid-source/blob/main/FAQ.md>
- Comunicação em jogo: **WebSocket nativo com mensagens JSON `{type, ...}`** (não é Socket.IO) + REST `/api/*` com Bearer token. Detalhes na seção 4.4. Fonte: chunk <https://poke.idleworld.online/_next/static/chunks/0ar1xg2adjvm_.js> (`GameSocketProvider`, `new WebSocket(...)`, `JSON.parse(e.data)`), lido em 2026-10-11. O prefixo `42` citado pelo userscript bettermap (que faz strip dele no interceptor) não aparece no bundle atual: provavelmente é de uma versão antiga do jogo [INFERENCE]; o probe de 2026-10-11 em `wss://poke.idleworld.online/socket.io/?EIO=4&transport=websocket` falha no upgrade (close 1006), enquanto `/ws` abre.

## 3. Fluxo de login

Rotas públicas: `/login`, `/register`, `/forgot-password`, `/rules`. Fonte: HTML de <https://poke.idleworld.online/login> e <https://poke.idleworld.online/register>.

### 3.1 Formulário de login (`/login`)

HTML real da página (fonte: <https://poke.idleworld.online/login>, método raw):

- Form: `form.auth-card`
- Campo usuário: `input[autocomplete="username"]` (placeholder "Email or username" — aceita e-mail **ou** username)
- Campo senha: `input[autocomplete="current-password"]` (type password, placeholder "Password")
- Botão de submit: `button.auth-imgbtn.primary` com `aria-label="Log in"` — **sem `type="submit"` explícito** e começa `disabled` até o captcha ser resolvido
- Widget de captcha: `div.turnstile-widget` (Cloudflare Turnstile); token cai em `input[name="cf-turnstile-response"]`
- Login alternativo: **Google OAuth** (`div.google-btn`, Google Identity Services, client `*.apps.googleusercontent.com`)
- Link para `/register` ("Create account") e `/forgot-password`

### 3.2 Chamadas de auth (do bundle JS da página de login)

Fonte: chunk <https://poke.idleworld.online/_next/static/chunks/3aqjofv7-1o3x.js> (lido em 2026-10-11):

- `POST /api/auth/login` — body `{ identifier, password, captchaToken }`
- Se a conta tiver 2FA, a resposta traz `twoFactor` + `twoFactorToken`; então `POST /api/auth/2fa/login` com `{ twoFactorToken, code }` (campo na UI: `input[autocomplete="one-time-code"]`)
- Google: `POST /api/auth/google` com o credential do GIS
- Refresh: `POST /api/auth/refresh` com `{ refreshToken }` → retorna novo `accessToken`
- Há também `/api/auth/motus` e um componente `MotusCaptcha` (segundo captcha, aparentemente para criação de conta via Google) e feature flag `TURNSTILE_ENABLED` no bundle (o captcha do login é condicional a ela)

### 3.3 Sessão

- Tokens ficam em **`sessionStorage["pokeweb:tokens"]`** como JSON `{ accessToken, refreshToken }` (há migração legada de `localStorage` para `sessionStorage`). Fonte: mesmo chunk de login (funções `saveTokens`/`getTokens`/`clearTokens`).
- Chamadas autenticadas usam header **`Authorization: Bearer <accessToken>`**; em 401 o cliente tenta refresh uma vez. Fonte: mesmo chunk (`apiGet`/`apiPostAuth`).
- Pós-login, o cliente chama `GET /api/characters/me` e roteia: com personagem → **`/play`**; sem verificação de e-mail → `/verify-email`; sem personagem → `/create-character`. Fonte: mesmo chunk (`routeAfterAuth`).
- **Uma sessão viva por conta**: logar a mesma conta em outro lugar derruba a anterior ("Conta em uso"). Fonte: PokeGrid `index.html` (comentários do watchdog de sessão). O PokeGrid associa isso ao WS **4001**, mas o bundle atual do jogo separa os casos: **4001 = token recusado** (`unauthorized`; o cliente faz refresh e reconecta, e na 2ª seguida espera 10 min) e **4005 = sessão substituída** (`replaced`; o cliente não reconecta). Fonte: `onclose` do `GameSocketProvider` no chunk `0ar1xg2adjvm_.js` (seção 4.4) e probe real (token inválido → close 4001 `"unauthorized"`).
- Sessão expira no meio do farm com a tela parada (o token do `/me` vence e quem renova é o socket); quedas comuns de ~60 s (restart do servidor) o jogo reconecta sozinho. Fonte: PokeGrid `index.html` (comentário "sessao morta").
- **Modo Soneca / farm offline**: existe uma landing com "Zzz" em `/`; relogar em menos de ~5 min cancela o farm offline. Fonte: PokeGrid `index.html` (guarda `loginAll`: "logar ali encerra o farm offline") e FAQ.

## 4. Seletores DOM concretos

### 4.1 Auth (confirmados no HTML/bundle atuais)

| Elemento | Seletor | Fonte |
|---|---|---|
| Form de login | `form.auth-card` | HTML de `/login` |
| Input usuário | `input[autocomplete="username"]` | HTML de `/login`; PokeGrid `loginPanel` |
| Input senha | `input[autocomplete="current-password"]` | idem |
| Botão "Log in" | `button.auth-imgbtn.primary` (ou `button[type="submit"]` como fallback) | HTML de `/login`; PokeGrid `findBtn` |
| Widget Turnstile | `.turnstile-widget` | HTML de `/login` |
| Token Turnstile resolvido | `input[name="cf-turnstile-response"]` (value preenchido) | PokeGrid `loginPanel` |
| Botão Google | `.google-btn` | HTML de `/login` |
| Campo 2FA | `input[autocomplete="one-time-code"]` | PokeGrid `index.html` (detecção de tela 2FA) |
| Mensagem de erro do form | `.form-msg` (classe `err` quando erro) | HTML de `/login` + bundle |

### 4.2 Em jogo (`/play`)

O jogo é canvas WebGL; o DOM interativo são overlays. Confirmados por ferramentas de terceiros que rodam em produção:

| Elemento | Seletor | Fonte |
|---|---|---|
| Janela do mapa | `.map-window` | bettermap userscript |
| Tooltip do mapa | `.map-window > .map-tip` | bettermap userscript |
| Abas de zonas do mapa (Kanto, Johto…) | tabs ao lado do badge "Better Map" | README do bettermap |
| Linhas do mercado | `.mkt2-trow` (header: `.mkt2-trow--head`) | PokeGrid `index.html` (filtro de mercado) |
| Avisos de combate/loot (stack) | `.sn-stack` | PokeGrid `index.html` (cleanScript) |
| Modal "Servidor reiniciado" + botão Atualizar | `.rsf-overlay .rsf-cta:not([disabled])` | PokeGrid `index.html` (`RSF_JS`) |
| Campo de chat | `input/textarea` com placeholder ~"Falar em"/"Talk"/"Message" | PokeGrid `index.html` |

**Indicador de "logado"**: não é um seletor DOM — o sinal confiável é a URL em `/play` + `GET /api/characters/me` retornando `character` + WebSocket do jogo aberto (`readyState === 1`). Fonte: bundle de login (`routeAfterAuth`) e PokeGrid (`READ_ALERTS`, `sessSnap.sk`).

### 4.3 Estado do jogo via rede (mais confiável que DOM)

O próprio ecossistema (PokeGrid/bettermap) não scrapeia o canvas: intercepta fetch/WebSocket. Eventos de WS observados (payload JSON com `type`; protocolo na seção 4.4):

- Recebidos: `field-init` (entrou na hunt; traz `slug`), `field-kill` (kill; traz `speciesName`), `catch-result` (captura; `success`, `speciesName`), `balls` (contagem de pokébolas: `counts`, `expires`, `catalog` com `infinite`), `inventory` (`items`), `pokes` (`list` do time), `analyzer` (resumo de sessão: `seconds`, `balance`), `restart-freeze` (`frozenAt`). Fontes: bettermap userscript; PokeGrid `index.html` (`READ_ALERTS`, comentários do coletor).
- Enviados: `{type:'enter-hunt', slug}`, `{type:'set-city'}`, `{type:'leave-hunt'}` (ao trocar de mapa/cidade), `{type:'analyzer-clear'}`, `restart-resume` (após clicar em Atualizar no modal de restart). Fonte: PokeGrid `index.html` (`ENTRA_JS`, `VOLTA_JS`, `RESET_SESS`, comentário do destrava).
- Slugs de cidade conhecidos (não são hunts): `cerulean`, `pewter`, `viridian`, `cassino`, `arena_pvp`, `goldenrod`, `shopping`, prefixo `gym_`. Fonte: PokeGrid `index.html` (`VOLTA_JS`, lista de cidades).

Endpoints REST observados (todos com Bearer):

- `GET /api/characters/me` → `{ character, needsEmailVerification }` — fonte: bundle de login + PokeGrid (`NAME_JS`)
- `GET /api/auth/me` — fonte: chunk `09657nskqmv4n.js` de `/play`
- `POST /api/game/balls/buy` — body `{ ballId, qty }`, resposta `{ counts, gold, bought }`; sem Bearer → 401 — fontes: PokeGrid `index.html` (compra de pokébolas) e chunk `0ui1n94-slw5_.js` (`apiPostAuth("/api/game/balls/buy",{ballId,qty})`)
- `GET /api/game/depot` → `{ depot: [{ itemId, quantity }] }` — fonte: PokeGrid `DEP_JS`
- `GET /api/game/map-markers` — **público** (o bundle chama com `fetch` puro, sem Bearer) → `{ map: { w, h }, hunts: [{ slug, name, looktype, level, pixel, area, range }] }`; 454 entradas em 2026-10-11, incluindo cidades com `level: 0` (`cerulean`, `pewter`, `viridian`) — fontes: PokeGrid `HUNTS_JS`, chunk `0ui1n94-slw5_.js` (`fetch("/api/game/map-markers")`, uso de `s.hunts`) e GET real em 2026-10-11
- `GET /api/game/used-balls` → tentativas de captura por espécie — fonte: PokeGrid coletor
- `POST /api/game/shop/sell` — body `{ items: [{ itemId, qty }] }`, resposta `{ gold, goldGained, soldCount }`; `POST /api/game/flint/sell` — body `{ itemId, qty }`, resposta `{ sold, item, goldGained }` — fontes: PokeGrid (sell guard) e chunk `0ui1n94-slw5_.js` (`apiPostAuth`)
- Estáticos: `/game/items.json` (catálogo de itens, `npcPrice`), `/game/creatures.json` (stats, golpes, loot) — fonte: PokeGrid `HUNTS_JS`/`READ_CATALOG`

### 4.4 WebSocket do jogo (bundle de `/play`)

Fonte de tudo abaixo, salvo indicação: `/play` carrega o `GameWorld` sob demanda (módulo 885197 em `/_next/static/chunks/09657nskqmv4n.js`), que puxa os chunks `16q4ov8qf6xz0.js`, `0fllz2m_ktm3s.js`, `0ar1xg2adjvm_.js`, `26sc7h-33qbis.js`, `0ui1n94-slw5_.js` e `3gc33kj6hnplx.js`. O socket fica em `GameSocketProvider` (`0ar1xg2adjvm_.js`); handlers de jogo em `0ui1n94-slw5_.js`. Todos baixados sem login em 2026-10-11.

- **URL**: base literal `wss://poke.idleworld.online/ws` com **sharding por conta**: `N = Number("88")`; `shard = abs(djb2(sub)) % N`, onde `sub` vem do payload do access JWT (`JSON.parse(atob(token.split(".")[1])).sub`) e `djb2` é `h=5381; h=(h<<5)+h+charCode|0`. Shard 0 → `/ws`; shard `k>0` → `/ws{k}` (se a base não tiver path, soma `k` na porta). Falha ao ler o JWT → base sem shard.
- **Auth**: o access vai na query: `?token=<accessToken>&v=2`, mais `&cmid=<id>` quando o cliente consegue gerar um id de máquina (`getCmid`, hash de fingerprint de canvas/hardware). Sem header `Authorization`.
- **Probe real (2026-10-11, token inválido, sem cmid)**: `wss://poke.idleworld.online/ws?token=x&v=2` e `/ws17?...` abrem (upgrade 101 passa pela Cloudflare com o UA padrão do undici) e o servidor fecha com **4001 `"unauthorized"`**; `/socket.io/?EIO=4&transport=websocket` falha no upgrade (1006).
- **Mensagens**: texto JSON com `type`; o cliente ignora o que não parseia. Envio = `JSON.stringify(obj)`; com o socket fechado o cliente oficial enfileira e manda no `onopen`.
- **Heartbeat**: a cada 10 s; se nada chegou em 45 s, envia `{"type":"ping"}`; se nada chegar 15 s depois do ping, fecha e reconecta.
- **Reconexão comum**: `t = min(24000, 1500·2^min(n-1,4))` ms, espera `t + random·t`.
- **Códigos de close**: `4001` token recusado → `refreshAccess()` e reconecta; na 2ª seguida espera 10 min. `4002` → reload da página (no máximo 1 por minuto). `4003` → manutenção (`/?maintenance=1`). `4005` → `replaced` (sessão substituída), não reconecta. `4006` → `ipLimited`, não reconecta. `4007` → `machineLimited`, não reconecta. `4008` → `/namelock`. `4009` → `/trocar-senha`. Nomes `replaced/ipLimited/machineLimited` vêm do objeto de contexto `{online, replaced, ipLimited, machineLimited, ...}`.
- **Recebidos** (além dos da seção 4.3): `field-init` (`slug`, `huntKey`, …), `field-none` (saiu do campo), `field-lost` (o cliente reenvia `enter-hunt` após 1 s), `field-teleport-city` (time derrotado → cidade), `hunt-cooldown`/`fishing-cooldown` (`ms`; o cliente reenvia `enter-hunt` após `ms + 100`), `hunt-resume` (`slug`, `name`: hunt em andamento no servidor; se for a hunt atual, o cliente manda `enter-hunt` com `resume: true`), `restart-freeze` (`frozenAt`, `restartedAt`, `boosts: [{key, pct, remainingMs}]`; o modal só aparece se houver boost com `remainingMs > 0`), `restart-resumed` (o cliente recarrega a página), `sleep-ok` (`ghost`), `pokes-chunk`/`poke-delta`/`poke-xp`, `trade-settled`, `autohelper`.
- **Enviados** (os usados pelo worker): `{type:"enter-hunt", slug, resume}` (`resume` = já houve `field-init` dessa hunt na montagem atual ou veio de `hunt-resume`), `{type:"leave-hunt"}`, `{type:"set-city", slug}`, `{type:"restart-state"}` (pedido do estado de restart ao montar), `{type:"restart-resume"}`, `{type:"balls-get"}`, `{type:"ping"}`. Outros vistos: `inv-get`, `pokes-get`, `analyzer-get`, `analyzer-clear`, `autohelper-get`, `field-get`, `view`, `sleep-mode`, `joy-heal`, `use-heal`, `catch`, `move`, `pvp-*`, `trade-*`, `guild-*`.
- O cliente oficial reenvia `enter-hunt` a cada 2,5 s de checagem quando passa 10 s sem `field-init`/atividade da hunt.

## 5. Loop idle (o que o jogador/bot faz)

Fontes: landing oficial (seção "Idle Combat & Progress": o líder caça sozinho com seus golpes, mesmo offline, e você volta pra coletar XP/gold/capturas) + PokeGrid (MANUAL/FAQ/código).

1. **Escolher hunt** (mapa → zona/rota; no protocolo: `enter-hunt` com o `slug`). O líder do time batalha sozinho.
2. **Capturar**: pokébolas são consumidas automaticamente ao encontrar Pokémon (chance por HP/nível/bola; balls têm validade e algumas são infinitas). Sem bola → a conta continua matando mas não captura (alerta "está sem pokébolas" do PokeGrid, mínimo de referência 100).
3. **Curar**: potions consumidas automaticamente (mínimo de referência 15). Item "revive" foi aposentado pelo jogo em 02/10/2026. Fonte: PokeGrid `index.html` (constantes `BALL_MIN`/`POTION_MIN` e comentário do revive).
4. **Reabastecer**: comprar pokébolas (`POST /api/game/balls/buy`) e potions com gold.
5. **Vender loot/capturas**: loja NPC (`shop/sell`) e mercado de jogadores (`.mkt2-trow`).
6. **Lidar com interrupções**: time derrotado → vai pro Centro Pokémon (cidade); servidor reiniciado → modal `.rsf-overlay` trava a sessão até clicar Atualizar; hunt parada (10 min sem kill com socket vivo) → reenviar `enter-hunt` ou recarregar. Fonte: PokeGrid `index.html` (destrava, `RSF_JS`, watchdog).
7. **Progresso offline**: ao deslogar/fechar, o jogo oferece o Modo Soneca (farm offline); relogar rápido o cancela.

Frequências observadas no PokeGrid: coleta de inventário a cada 30 s, watchdog de sessão a cada ~6 s (foto de 15 s), stall = 10 min sem kills.

## 6. Anti-bot

- **Cloudflare Turnstile no login** (e possivelmente no register): o botão de login fica `disabled` até `cf-turnstile-response` ter valor. PokeGrid, um launcher maduro, **nunca resolve o captcha** — sempre o humano. Fonte: PokeGrid FAQ ("O app nunca resolve captcha. É sempre você… Proposital, não vai mudar") e `loginPanel`. Isto é o principal bloqueio para login 100% automatizado; o bundle tem flag `TURNSTILE_ENABLED`, ou seja, pode estar desligado em alguns contextos — confirmar em runtime.
- **Cloudflare na borda**: beacon + challenge-platform (`/cdn-cgi/challenge-platform/scripts/jsd/main.js`) injetados em toda página. Fonte: HTML de `/login`.
- **Verificação de User-Agent/fingerprint**: o PokeGrid remove o token `Electron/` da UA e congela a versão do Chrome "pra passar na Cloudflare". Headless óbvio (UA de HeadlessChrome, `navigator.webdriver`) provavelmente falha ou eleva o score de bot. Fonte: PokeGrid `main.js` (bloco `app.userAgentFallback`).
- **Uma sessão por conta**: segundo login derruba o primeiro ("Conta em uso"; no bundle atual, WS close 4005 `replaced`). Fonte: PokeGrid `index.html` e seção 4.4.
- **Regras oficiais anti-automação**: "Macros, auto-clickers e tools que simulam sua presença ou executam ações repetidas automaticamente não são permitidos" (seção 03); trade com contas botter → ban permanente (seção 09, desde 20/08/2026); multi-conta acima de 4 sem autorização → deleção (seção 10). Fonte: <https://poke.idleworld.online/rules>.
- **Detecção comportamental server-side**: não documentada publicamente, mas o servidor é autoritativo (kills/capturas passam por ele), então padrões inumanos são detectáveis. [INFERENCE]
- Rate limit específico de login/ações: não encontrado documentação pública. Ver **Desconhecido**.

## 7. Implicações para o worker (Task 19)

1. `GAME_URL` default: `https://poke.idleworld.online` (login em `/login`).
2. Login via form: preencher `input[autocomplete="username"]`/`current-password` com setter nativo + eventos `input`/`change` (React controlado — o PokeGrid faz exatamente assim), aguardar `cf-turnstile-response` e botão habilitado, clicar. **O Turnstile é o ponto de falha esperado**; planejar estado `error`/`needs-captcha` no `/health`.
3. Pós-login, validar rota: `/play` (ok), `/create-character` ou `/verify-email` (conta incompleta → erro).
4. No jogo, preferir **rede a DOM**: interceptar WebSocket/fetch (como bettermap/PokeGrid) para estado (balls, inventory, kills) e usar REST autenticado para compras. O Bearer pode ser capturado dos headers das requests da página ou lido de `sessionStorage["pokeweb:tokens"]`.
5. Ações do loop: `enter-hunt` via WS, monitorar `field-kill`/`catch-result`/`balls`/`inventory`, comprar balls/potions quando baixo, clicar `.rsf-overlay .rsf-cta` quando aparecer, relogar em WS close 4001/sessão morta.
6. Respeitar UA/fingerprint coerente (Chromium real via Playwright, sem sinais de headless) e 1 sessão por conta.

## 8. Desconhecido (não confirmado nesta pesquisa)

- **WebSocket em sessão autenticada**: URL, sharding, query e códigos de close estão na seção 4.4 (bundle + probe com token inválido). Falta observar uma sessão autenticada ponta a ponta (ver seção 9).
- **Se o Turnstile está sempre ligado**: o bundle tem feature flag `TURNSTILE_ENABLED`; o HTML atual renderiza `.turnstile-widget`, mas não confirmei se exige token em 100% dos logins (pode variar por IP/score Cloudflare).
- **Endpoint/body exatos de ações in-game** (heal manual, troca de líder, evolução, mercado de jogadores): os bodies de `balls/buy`, `shop/sell` e `flint/sell` estão confirmados no bundle (seção 4.3); comandos de WS como `use-heal`, `joy-heal`, `switch` e `catch` existem (seção 4.4), mas os payloads não foram analisados.
- **Formato completo dos eventos WS** além dos campos usados pelo bundle/bettermap/PokeGrid (ex.: todos os campos de `field-init`).
- **Rate limits numéricos** (login, REST, WS): sem fonte pública.
- **Detecção de headless/Playwright específica**: nenhuma fonte confirma checagens além de Cloudflare + UA; tratar como risco.
- **Tela de criação de personagem** (`/create-character`) e verificação de e-mail: fluxo não explorado (requer conta real).

## 9. Pontos de verificação manual (worker)

### 9.1 Auth (Task 19)

O que a Task 19 implementou sem conta real e precisa ser confirmado em smoke manual:

- **Sitekey do Turnstile**: `0x4AAAAAADkKBnFEMDt0MGBM`, literal no chunk `/_next/static/chunks/3aqjofv7-1o3x.js` (não há `data-sitekey` no HTML de `/login`; o widget é renderizado via `turnstile.render({sitekey})`). Extraída em 2026-10-11 por GET direto, sem challenge da Cloudflare. Se o chunk mudar e a extração falhar, usar `TURNSTILE_SITEKEY`.
- **Solver aceito pelo jogo?** O token vem de `TurnstileTaskProxyless` (IP do solver, não o do proxy da conta). Confirmar que `POST /api/auth/login` aceita esse `captchaToken` (o backend pode validar `remoteip` no siteverify).
- **Turnstile sempre ligado?** `TURNSTILE_ENABLED` no bundle é `!!sitekey`, ou seja, ligado enquanto a sitekey estiver embutida. Confirmar se o backend exige `captchaToken` em todo login.
- **Refresh rotaciona o refreshToken?** O cliente salva a resposta inteira de `/api/auth/refresh` como `pokeweb:tokens` e só refaz refresh se houver `refreshToken` salvo, o que indica que a resposta traz os dois tokens [INFERENCE]. O worker trata os dois casos (mantém o atual quando não vem novo); confirmar com conta real.
- **Validade do access token**: o agendamento usa o `exp` do JWT com 60 s de margem (piso de 30 s entre refreshes); confirmar que o access é JWT com `exp`. Se não for, não há renovação proativa: o game client chama `AuthManager.invalidar()` quando o jogo recusar o token.
- **Contas com 2FA** não são suportadas pelo login automático (`twoFactor` na resposta → needs-login).

**Resultado do smoke (2026-10-12) — ATENÇÃO: feito contra o servidor REAL `pokeidle.io` (ver banner no topo):**
- **Solver aceito pelo jogo? → CONFIRMADO (no `pokeidle.io`).** `POST https://pokeidle.io/auth/entrar` com `{id, senha, turnstileToken:<token do `TurnstileTaskProxyless`>, dispositivo}` → **HTTP 200** `{nick, token, provedor:"local", precisaNick, termosVersao}`. O token do solver (IP do 2captcha) é aceito; sem bind de `remoteip`. **Login automático via solver é viável.**
- **Backend exige captcha em todo login? → CONFIRMADO (sim).** `turnstileToken` inválido → `400 {"erro":"login.turnstileFalhou"}`.
- **Turnstile usa action/cData? → NÃO.** `turnstile.render(el, {sitekey, size:"flexible"})`; sitekey **dinâmica** `0x4AAAAAAEccJgXg19_AZoDr` via `GET /auth/provedores.turnstile` (não hardcoded). Logo o `TurnstileTaskProxyless` basta, mas a sitekey deve ser lida de `/auth/provedores`.
- **Divergência central (→ VAL-07):** o worker aponta para `poke.idleworld.online` (`/api/auth/login`, campos `identifier/password/captchaToken`, sitekey `0x4AAAAAAD...`), servidor DIFERENTE do real. Por isso o 401 "Email ou senha incorretos" nas sondas iniciais (conta não existe/difere lá). Adaptar o worker ao `pokeidle.io` (endpoints, campos PT, token Bearer único, `dispositivo`, sitekey dinâmica, WS raw `wss://pokeidle.io`) é a correção central da Fase 1. Mapa completo: EVIDENCE.md (VAL-01).

### 9.2 Game loop (Task 20)

Implementado a partir do bundle de `/play` (seção 4.4), sem conta real:

- **Sessão autenticada no shard**: confirmar com conta real que o worker recebe `field-init`/`field-kill` e que o shard calculado (88 shards, djb2 do `sub` do JWT) é o mesmo que o navegador usa (DevTools → Network → WS). Overrides: `GAME_WS_URL` (origem do WS), `GAME_WS_PATH` (path base, padrão `/ws`) e `GAME_WS_SHARDS` (padrão 88, valor embutido no bundle).
- **Sem `cmid`**: o worker não envia `cmid` (é um fingerprint de máquina do navegador; inventar um seria burlar o limite por máquina). Confirmar que o servidor aceita sessão sem `cmid` e se isso leva a 4007 (`machineLimited`).
- **Headers do WS**: o worker manda `Origin: <GAME_URL>` e o User-Agent padrão do undici. O probe com token inválido passou pela Cloudflare (upgrade 101 + close 4001); confirmar com token válido.
- **Mensagens ao abrir**: o worker envia `restart-state` e `balls-get`, como o cliente oficial faz ao montar. Confirmar que o servidor responde (`restart-freeze`, `balls`).
- **Retomada de hunt**: confirmar que, ao reconectar com hunt em andamento, chega `hunt-resume` e que `enter-hunt` com `resume: true` não reinicia o progresso.
- **Hunt sem `HUNT_SLUG`**: o worker escolhe no map-markers (lido sem `Authorization`, como o cliente oficial) a hunt de menor `level > 0` fora das cidades/ginásios. Pode ser fraca demais para personagens fortes; preferir `HUNT_SLUG`. Depois de 3 `enter-hunt` seguidos sem `field-init`, o lastError vira `HUNT_SLUG inválido ou hunt ignorada: <slug>`.
- **Drain sem `sleep-mode`**: no SIGTERM o worker para o loop, espera a ação em voo (até 20 s) e fecha o socket com 1000. O bundle tem um Modo Soneca explícito (`{type:"sleep-mode"}` → `sleep-ok` com `ghost`), então talvez fechar o socket sem ele não mantenha o farm offline. Confirmar com conta real se o progresso continua após `docker stop`; se não continuar, enviar `sleep-mode` no drain.
- **Compra de balls e venda de loot**: os bodies estão confirmados no bundle (seção 4.3), mas ficaram fora desta task. Falta definir a política: qual ball comprar, quantidade, estoque mínimo e quais itens podem ser vendidos sem perder itens valiosos.
- **Códigos de close**: o worker trata 4001 como auth recusada: invalida no máximo 1 vez a cada 5 min e reconecta; se vier 4001 de novo, vai para needs-login. Se a renovação falhar por motivo transitório (refresh indisponível), ele reconecta com backoff e libera um novo invalidar; só a falha definitiva (refresh recusado e sem solver) leva a needs-login. Isso foi comprovado ponta a ponta contra o servidor real com token falso (docker, 2026-10-11): close 4001 → refresh recusado → needs-login, sem reconexão. Com 4005 → needs-login, 4006/4007 → error e 4008/4009 → needs-login, sempre sem reconectar e com prioridade sobre uma reciclagem em andamento. Confirmar 4005-4009 em produção.
- **Política de reconexão (decisão do worker, mais conservadora que o bundle)**: quedas comuns e 4002 usam o backoff do bundle (`1,5 s·2^(n−1)` com teto de 24 s, mais jitter) nas 5 primeiras falhas seguidas. Depois disso, o teto sobe para 5 min. O contador só zera quando chega uma mensagem do servidor (abrir e cair logo não conta). Com 4003 (manutenção) o atraso é próprio: 5, 10 e depois 15 min, com jitter de até −20%.
- **Reciclagem da conexão** (após `restart-resumed`, ou quando `restart-resumed` não chega em 8 s): no máximo 1 reconexão a cada 60 s. Depois de 3 reciclagens sem `field-init`/`field-kill`, o worker para de reciclar e avisa no lastError até chegar um `restart-freeze` com `frozenAt` novo.
- **Watchdog de stall**: faz leave+enter após 10 min sem kill. Depois de 3 recuperações seguidas sem kill, o lastError vira `hunt <slug> sem kills há <N>min` e as tentativas passam a ser de hora em hora. Um kill zera a contagem.
