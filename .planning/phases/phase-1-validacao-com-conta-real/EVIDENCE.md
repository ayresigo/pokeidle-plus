# EVIDENCE — Fase 1 (Validação com conta real)

Evidência sanitizada do smoke. **Nunca** contém tokens, senhas ou a chave do solver.
Conta descartável (D-03); IP local sem proxy (D-04).

## VAL-01 — Aceite do captchaToken do solver (§9.1) — CONFIRMADO

**Data:** 2026-10-12

### ⚠ Descoberta central: o jogo real é `pokeidle.io`, não `poke.idleworld.online`
O worker e o `packages/worker/GAME.md` foram construídos para `poke.idleworld.online`
(endpoint `/api/auth/login`, campos `identifier/password/captchaToken`, sitekey
`0x4AAAAAADkKBnFEMDt0MGBM`). Mas o jogo que o usuário joga é **`https://pokeidle.io`**, com
protocolo diferente. Isso foi revelado pelo cURL verbatim da requisição de login do navegador.
Por isso o worker nunca autenticou: falava com o servidor errado (onde a conta não existe/difere).

### Login automático CONFIRMADO no servidor real (prova ponta a ponta)
`POST https://pokeidle.io/auth/entrar` com `{id, senha, turnstileToken:<token 2captcha>, dispositivo}`
→ **HTTP 200**:
```
{"nick":"<REDACTED-NICK>","token":"<REDACTED>","provedor":"local","precisaNick":false,"termosVersao":"2026-10-12"}
```
O `turnstileToken` foi resolvido pelo `TurnstileTaskProxyless` (IP do solver) para a sitekey do
`pokeidle.io`. **O solver é aceito e o login automático funciona** (`provedor:"local"` = conta nativa).
(Token de sessão não é logado nem commitado; descartado.)

### Mapa do protocolo real do `pokeidle.io` (observado 2026-10-12)
| Item | poke.idleworld.online (worker atual) | **pokeidle.io (real)** |
|------|--------------------------------------|------------------------|
| Login | `POST /api/auth/login` | **`POST /auth/entrar`** |
| Campos login | `{identifier, password, captchaToken}` | **`{id, senha, turnstileToken, dispositivo}`** |
| Resposta login | `{accessToken, refreshToken}` | **`{nick, token, provedor, precisaNick, termosVersao}`** (Bearer único em localStorage) |
| Sitekey | `0x4AAAAAADkKBnFEMDt0MGBM` (hardcoded) | **`0x4AAAAAAEccJgXg19_AZoDr`** (dinâmica em `GET /auth/provedores.turnstile`) |
| Config/providers | — | **`GET /auth/provedores`** → `{google, discord, confirmacaoEmail, turnstile}` |
| Refresh/troca | `POST /api/auth/refresh` | provável **`/auth/trocar`** (a confirmar) |
| Outros auth | — | `/auth/criar`, `/auth/conta`, `/auth/recuperar`, `/auth/redefinir`, `/auth/nick`, `/auth/excluir`, `/auth/twitch`, `/auth/termos`, `/auth/kick` |
| WebSocket | `wss://.../ws{shard}?token=&v=2` (sharding djb2) | **`new WebSocket(wss://pokeidle.io)`** (raw, mesmo host, sem shard path aparente) |
| Device | — | **`dispositivo`** (UUID por dispositivo) exigido no login |
| Cookie | — | **`pokeidle_gw`** (gateway/clearance) presente nas requisições do navegador |
| Erros | `{message:"..."}` (PT) | `{erro:"login.turnstileFalhou"}` (chaves PT) |

### Vereditos VAL-01 (no servidor real pokeidle.io)
- **Solver aceito pelo jogo? → CONFIRMADO.** `TurnstileTaskProxyless` (IP do solver) resolve a sitekey
  do `pokeidle.io`, e `POST /auth/entrar` retorna 200. Sem bind de `remoteip`. **Login automático viável.**
- **Backend exige captcha em todo login? → CONFIRMADO (sim).** `turnstileToken` inválido → `400 {"erro":"login.turnstileFalhou"}`.
- **Turnstile usa action/cData? → NÃO** (render só com sitekey). Sitekey vem de `/auth/provedores` (dinâmica).

### Implicação (divergência central da Fase 1 → VAL-07)
O worker aponta para o **servidor errado**. Adaptá-lo ao `pokeidle.io` é a correção central e **grande**:
novo domínio, endpoints (`/auth/entrar`, `/auth/provedores`, refresh), campos (`id/senha/turnstileToken/dispositivo`),
modelo de token (Bearer único), sitekey dinâmica, geração/persistência do `dispositivo` (UUID por install —
decisão vs D-10 a confirmar: é id de dispositivo do cliente, não fingerprint anti-limite), e o **WS/game loop**
(raw WebSocket em `wss://pokeidle.io`, eventos a mapear). Isso extrapola os patches gated previstos no 4-PLAN e
exige replanejar a Fase 1 (e impacta a Fase 2). Ver escalonamento ao usuário/coordenador.

**Guardas aplicadas:** nenhuma compra/venda; sondas de login não abriram sessão WS; segredos só no `.env`
local (ignorado pelo git); token de sessão obtido na prova foi descartado; nenhum segredo neste arquivo.

---

## Apêndice — Protocolo WebSocket real do pokeidle.io (mapa inicial p/ a próxima etapa e Fase 2)

Lido do bundle `https://pokeidle.io/app.js?v=1.275.1` (2026-10-12), read-only.

- **Conexão:** `new WebSocket(wss://pokeidle.io)` (raw, mesmo host, SEM shard e SEM token na URL).
- **Handshake de auth (primeiro frame):** `{ t: 'hello', nick, token, delta: 1, dispositivo }`. O token (de `/auth/entrar`) e o `dispositivo` entram aqui. Ack do servidor: `welcome`.
- **Formato das mensagens:** JSON com campo `t` (tipo). Ex. keep-alive: `{ t: 'ping' }`.
- **Renovação de sessão:** evento recebido `sessao.renovada` (o token renova pelo próprio WS; não há endpoint REST de refresh).
- **Enviados (amostra, namespaced):** `hunt.select` (entrar na hunt), `centro.curar` (cura — Fase 2 D-14), `centro.andar`, `shop.buy`/`loja.comprar` (comprar), `shop.autoVendaLoot` (auto-venda de loot — Fase 2 D-03), `team.move`/`team.active`, `pokemon.evoluir`/`refinar`, `starter.pick`, `auto.set`, `chat.send`, etc.
- **Recebidos (amostra):** `welcome`, `hunt`, `spawn`, `capturas`, `curado`, `coins`, `nivel`, `evento`, `erro`, `shiny.captura`, `xpPerdido`, `revive`, `sessao.renovada`.

**Implicação:** o `game/client.ts`/`game/loop.ts` atuais (protocolo `field-init/field-kill/enter-hunt/balls-get`, sharding djb2, `?token=` na URL, close codes 400x) são do servidor errado e precisam ser reescritos para este protocolo. É a etapa seguinte (WS/game loop), após a re-apontação da auth.

---

## VAL-02/03/04 — Game loop real do pokeidle.io (probe WS ao vivo, 2026-10-12)

Sessão real na conta descartável (navegador deslogado; sem 4005). Frames reais capturados.

- **Conexão/handshake (VAL-02/03):** `wss://pokeidle.io` (raw, SEM shard, SEM `?token`). Primeiro frame `{t:'hello', nick, token, delta:1, dispositivo}` → `welcome` com `estado` (level, xp, gold, items). **Sem `cmid`; sem sharding djb2.** Token aceito no handshake (já provado). Não há close 4007 neste fluxo.
- **Entrar na hunt (VAL-03):** `{t:'hunt.select', slug:'bellsprout'}` → `{t:'campo.init', slug, mapa, box, heroi, mobs[]}` + `{t:'batalha', ev:[{k:'hunt', slug, nome, trocaLivreEm}]}`. Slug inválido → `{t:'batalha', ev:[{k:'aviso', msg:'"<slug>" não é uma área caçável'}]}`. **O HUNT_SLUG correto é `bellsprout` (dois L), não `belsprout`.**
- **KILL real (VAL-04):** `{t:'batalha', ev:[{k:'ataque', por:'jogador', slot, golpe, tipo, dano, ef, stab, hpAlvo, aoe}, {k:'morte', quem:'selvagem', slot, nome, xp, xpTreinador, xpPokemon, lootBoost, ouro, drops:[{nome,qtd}]}]}`. **Kill = evento `batalha` com `ev[].k === 'morte'` e `quem === 'selvagem'`** (traz nome da espécie, xp, ouro, drops). `k:'spawn'` = novo selvagem no campo.
- **Contadores (VAL-04):** `{t:'estado', estado:{xp, gold, items:{...}, dexMud:{<speciesId>:{k:<kills>, c:<capturas>}}, pkMud:[{id, speciesId, level, xp, ...}]}}`. `dexMud[species] = {k:kills, c:capturas}` acumulado na pokédex; captura seria `k:'captura'`/`c` subindo (a conta de teste só mata com 1 golpe, `c:0`). O pokémon líder subiu de nível (10→11) via `pkMud`.
- **Campo:** `{t:'campo', seq, ts, heroi, mobs[], alvo, fora[]}` — estado espacial do campo (posições), ~alta frequência. O herói auto-batalha; o worker não precisa mover.
- **Keepalive:** `{t:'ping'}` → `{t:'pong'}`. **Cura:** enviar `{t:'centro.curar'}` (NPC Joy no `centro`). **Fechamento limpo:** `ws.close(1000)`.

**Veredito:** VAL-02 (sem cmid, sem 4007 — handshake por token no frame `hello`), VAL-03 (entra na hunt via `hunt.select`, recebe `campo.init`), VAL-04 (kills reais via `batalha/morte`, contador em `dexMud`) **CONFIRMADOS no servidor real**. O `game/client.ts`/`game/loop.ts` atuais (protocolo antigo) serão reescritos para este vocabulário.

---

## Observação para as correções da 01.1 (sessão read-only ao vivo + bundle, 2026-10-13)

Conta descartável, uma sessão curta só leitura (login via solver → `welcome` → `hunt.select bellsprout`),
mais leitura read-only do bundle `https://pokeidle.io/app.js`. Nada pago. Sem segredos abaixo.

### Formato do token (I2)
- Token de `/auth/entrar` é **opaco: 2 partes**, ~152 chars, **não é JWT** e **não tem `exp`**
  (`lerExpiracao`→`null`; payload não-decodificável como base64url JSON). Logo **não há refresh proativo
  por `exp`**; a renovação é só pelo WS (`sessao.renovada`) ou re-login.
- O **`nick` vem de `corpo.nick`** do `/auth/entrar` (não do token). O cliente oficial monta o hello com
  `{t:'hello', nick: sessao.nick, token: sessao.token, delta:1, dispositivo: idDispositivo()}` (bundle).
- `idDispositivo()` do cliente é um UUID **persistido no localStorage** (estável por install), não por processo.
- Chave do token no navegador: a sessão é guardada por `guardarSessao/sessaoSalva` (localStorage); o token
  cru vem do `token` de `/auth/entrar`. A UI deve pedir esse **token Bearer único**.

### Fonte da hunt (C1) — CONFIRMADO
- `welcome.estado.huntSlug` = **última hunt do jogador** (observado: `"bellsprout"`).
- O servidor **auto-retoma a última hunt** na conexão: após o `welcome` (com `noCentro:true`), chegaram
  sozinhos `campo.init slug:"centro"` (cura, `batalha ev [centro, joy]`) e depois `campo.init slug:"bellsprout"`
  (`batalha ev [curado, hunt]`) + enxame de `spawn`, **sem nenhum `hunt.select`**. Enviar `hunt.select` depois
  é idempotente (re-entra limpo e os kills seguem).
- `welcome.hunts` = catálogo de hunts; `welcome.estado` traz o quadro completo (level, xp, gold, items, balls,
  pokedex, pokemons, dexMud, centro/noCentro, bicicleta, guild, passe, boss…) — útil p/ o dashboard da Phase 2.
- Kills: `batalha ev [ataque, morte]`; `estado.dexMud[species]={k,c}` e `estado.{xp,gold,items}` sobem.

### Close codes / sessão substituída (I5) — do bundle (`ws.onclose`)
- **4001 = sessão tomada** ("outro aparelho/aba/reconexão mais nova tomou esta conta"); o cliente oficial
  **NÃO reconecta** (mostra "sessão tomada"). → sinal real de sessão substituída.
- **4003 = IP banido** pelo painel; **não reconecta** (`auth.ipBanido`).
- **4000 = ban/aviso de conta**; o `erro` (com `chave`) chega **antes** do fechamento; **não reconecta** (`travaDeConta`).
- Outros (1012 restart, rede) → reconectar com backoff.

### Frame `erro` (minor) — do bundle
- O `erro` do WS carrega **`chave`** (não `msg`): `{t:'erro', chave:'<chave>'}`. Chaves de auth/conta terminais:
  `auth.sessaoInvalida`, `auth.precisaLogin`, `auth.contaBanida`, `auth.contaExcluida`, `auth.ipBanido`,
  `login.credenciaisInvalidas`, `login.contaBanida`, `login.ipBanido`, `login.turnstileFalhou`, `login.falhou`.

### `sessao.renovada` (I1) — do bundle
- `{t:'sessao.renovada', token}` → o cliente guarda o novo token (`s.token = m.token; guardarSessao`). É o que
  impede a sessão longa de cair no login na próxima queda. O worker deve **adotar** esse token (auth + health).

---

## Smoke real do worker corrigido (conta descartável, 2026-10-13)

Rodado o worker REAL (módulos `criarAuthManager`/`criarGameClient`/`runGameLoop`/`drenar`) contra
`https://pokeidle.io`, conta descartável `smoke-descartavel`. Só leitura de progresso; **nada pago**
(sem compra/venda/cura). Segredos não impressos (tokens omitidos; só `state`/`kills`/`lastError`).

### Smoke ponta-a-ponta (MIG-06 / SC5) — CONFIRMADO
- **Auth via solver → ok.** `state` foi a `in-game` (login `/auth/entrar` + `turnstileToken` do 2captcha).
- **Hunt (C1) → CONFIRMADO.** `huntAlvo=bellsprout`, `hunt=bellsprout`; `lastAction` alternou entre
  `garantir-hunt: em hunt bellsprout` e `watchdog-stall: hunt bellsprout ativa` (watchdog **não** disparou à toa).
- **Kills reais → CONFIRMADO.** Contador subiu **0 → 23 em ~66 s** (`morte Bellsprout`), `lastError=null` o tempo todo.
- **Drain → CONFIRMADO.** `drenar(...)` → `acaoConcluida=true`, fechamento limpo (close 1000), sem erro, processo encerra.
- **nick (N3):** hello enviado com `corpo.nick` do login; conexão aceita.

### VAL-05 (farm offline) — REFUTADO sem soneca
- Duas leituras read-only do mesmo token com 60 s **offline** (sessão fechada) entre elas:
  `xp=13138` na sessão 1 e `xp=13138` na sessão 2 → **delta 0**. Online o personagem faz ~0,35 kill/s.
- **Conclusão:** com `close(1000)` o farm **não** continua offline. O worker farma enquanto **conectado**
  (modo normal, com reconexão). Farm offline exigiria um comando de soneca do `pokeidle.io` — **não mapeado**
  no bundle; fica como decisão/mapa da **Phase 2** (D-13). Para a migração, o drain limpo (close 1000) está correto.

### Pendentes (não exercitados neste smoke)
- VAL-06 `sessao.renovada` ao vivo (precisa de sessão de dias) e close codes 4001/4003/4000 ao vivo
  (já mapeados pelo bundle `ws.onclose`); forçar 4001 exigiria abrir a conta em outro lugar.
