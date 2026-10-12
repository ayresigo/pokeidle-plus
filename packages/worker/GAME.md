# GAME.md — Pesquisa PokeIdle (referência para o módulo `game/`)

Data da pesquisa: 2026-10-11. Documento de referência para o game loop do worker (Task 19). Toda afirmação factual tem a fonte ao lado. O que não foi confirmado está na seção **Desconhecido**.

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
- Comunicação em jogo: **WebSocket (protocolo Socket.IO — mensagens com prefixo `42`)** + REST `/api/*` com Bearer token. Fonte: interceptor de WebSocket do userscript bettermap (strip do prefixo `42`) e coletor do PokeGrid (`index.html`, wrapper de `window.fetch` e `window.WebSocket`).

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
- **Uma sessão viva por conta**: logar a mesma conta em outro lugar derruba a anterior ("Conta em uso"); o servidor fecha o socket com **código 4001** (auth recusada) e o jogo não reconecta sozinho nesse caso. Fonte: PokeGrid `index.html` (comentários do watchdog de sessão, tratamento de WS 4001).
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

O próprio ecossistema (PokeGrid/bettermap) não scrapeia o canvas: intercepta fetch/WebSocket. Eventos de WS observados (Socket.IO, payload JSON com `type`):

- Recebidos: `field-init` (entrou na hunt; traz `slug`), `field-kill` (kill; traz `speciesName`), `catch-result` (captura; `success`, `speciesName`), `balls` (contagem de pokébolas: `counts`, `expires`, `catalog` com `infinite`), `inventory` (`items`), `pokes` (`list` do time), `analyzer` (resumo de sessão: `seconds`, `balance`), `restart-freeze` (`frozenAt`). Fontes: bettermap userscript; PokeGrid `index.html` (`READ_ALERTS`, comentários do coletor).
- Enviados: `{type:'enter-hunt', slug}`, `{type:'set-city'}`, `{type:'leave-hunt'}` (ao trocar de mapa/cidade), `{type:'analyzer-clear'}`, `restart-resume` (após clicar em Atualizar no modal de restart). Fonte: PokeGrid `index.html` (`ENTRA_JS`, `VOLTA_JS`, `RESET_SESS`, comentário do destrava).
- Slugs de cidade conhecidos (não são hunts): `cerulean`, `pewter`, `viridian`, `cassino`, `arena_pvp`, `goldenrod`, `shopping`, prefixo `gym_`. Fonte: PokeGrid `index.html` (`VOLTA_JS`, lista de cidades).

Endpoints REST observados (todos com Bearer):

- `GET /api/characters/me` → `{ character, needsEmailVerification }` — fonte: bundle de login + PokeGrid (`NAME_JS`)
- `GET /api/auth/me` — fonte: chunk `09657nskqmv4n.js` de `/play`
- `POST /api/game/balls/buy` — body `{ ballId, qty }`, resposta traz `gold`; sem Bearer → 401 — fonte: PokeGrid `index.html` (compra de pokébolas)
- `GET /api/game/depot` → `{ depot: [{ itemId, quantity }] }` — fonte: PokeGrid `DEP_JS`
- `GET /api/game/map-markers` — hunts/mapa — fonte: PokeGrid `HUNTS_JS`
- `GET /api/game/used-balls` → tentativas de captura por espécie — fonte: PokeGrid coletor
- `POST /api/game/shop/sell` e `POST /api/game/flint/sell` — venda de itens — fonte: PokeGrid (sell guard)
- Estáticos: `/game/items.json` (catálogo de itens, `npcPrice`), `/game/creatures.json` (stats, golpes, loot) — fonte: PokeGrid `HUNTS_JS`/`READ_CATALOG`

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
- **Uma sessão por conta**: segundo login derruba o primeiro (WS close 4001, "Conta em uso"). Fonte: PokeGrid `index.html`.
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

- **URL exata do WebSocket** do jogo (host/path, ex.: `/socket.io`): o engine do jogo só carrega após auth e não está nos chunks públicos que baixei. O prefixo `42` (Socket.IO) é confirmado, o endpoint não. Descobrir em runtime na primeira sessão.
- **Se o Turnstile está sempre ligado**: o bundle tem feature flag `TURNSTILE_ENABLED`; o HTML atual renderiza `.turnstile-widget`, mas não confirmei se exige token em 100% dos logins (pode variar por IP/score Cloudflare).
- **Endpoint/body exatos de ações in-game** (heal manual, troca de líder, evolução, mercado buy/sell completos): só `balls/buy`, `shop/sell`, `flint/sell`, `depot`, `map-markers`, `used-balls` foram vistos em código de terceiros; o resto precisa ser sniffado em sessão real.
- **Formato completo dos eventos WS** além dos campos usados pelo bettermap/PokeGrid (ex.: todos os campos de `field-init`).
- **Rate limits numéricos** (login, REST, WS): sem fonte pública.
- **Detecção de headless/Playwright específica**: nenhuma fonte confirma checagens além de Cloudflare + UA; tratar como risco.
- **Tela de criação de personagem** (`/create-character`) e verificação de e-mail: fluxo não explorado (requer conta real).
- Lista completa de slugs de hunts: virá de `/api/game/map-markers` em runtime.

## 9. Pontos de verificação manual (auth do worker)

O que a Task 19 implementou sem conta real e precisa ser confirmado em smoke manual:

- **Sitekey do Turnstile**: `0x4AAAAAADkKBnFEMDt0MGBM`, literal no chunk `/_next/static/chunks/3aqjofv7-1o3x.js` (não há `data-sitekey` no HTML de `/login`; o widget é renderizado via `turnstile.render({sitekey})`). Extraída em 2026-10-11 por GET direto, sem challenge da Cloudflare. Se o chunk mudar e a extração falhar, usar `TURNSTILE_SITEKEY`.
- **Solver aceito pelo jogo?** O token vem de `TurnstileTaskProxyless` (IP do solver, não o do proxy da conta). Confirmar que `POST /api/auth/login` aceita esse `captchaToken` (o backend pode validar `remoteip` no siteverify).
- **Turnstile sempre ligado?** `TURNSTILE_ENABLED` no bundle é `!!sitekey`, ou seja, ligado enquanto a sitekey estiver embutida. Confirmar se o backend exige `captchaToken` em todo login.
- **Refresh rotaciona o refreshToken?** O cliente salva a resposta inteira de `/api/auth/refresh` como `pokeweb:tokens` e só refaz refresh se houver `refreshToken` salvo, o que indica que a resposta traz os dois tokens [INFERENCE]. O worker trata os dois casos (mantém o atual quando não vem novo); confirmar com conta real.
- **Validade do access token**: o agendamento usa o `exp` do JWT com 60 s de margem (piso de 30 s entre refreshes); confirmar que o access é JWT com `exp`. Se não for, não há renovação proativa: o game client chama `AuthManager.invalidar()` quando o jogo recusar o token.
- **Contas com 2FA** não são suportadas pelo login automático (`twoFactor` na resposta → needs-login).
