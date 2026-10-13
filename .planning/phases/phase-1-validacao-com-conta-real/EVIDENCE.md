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
{"nick":"trembebe","token":"<REDACTED>","provedor":"local","precisaNick":false,"termosVersao":"2026-10-12"}
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
