# EVIDENCE — Fase 1 (Validação com conta real)

Evidência sanitizada do smoke contra `poke.idleworld.online`. **Nunca** contém tokens,
senhas ou a chave do solver. Conta descartável (D-03); IP local sem proxy (D-04).

## VAL-01 — Aceite do captchaToken do solver (§9.1)

**Data:** 2026-10-12
**Caminho:** solver 2captcha (`SOLVER_KEY` + `POKEIDLE_USER`/`POKEIDLE_PASS`), `pnpm start` direto (D-05).
**Setup:** credenciais confirmadas pelo usuário como válidas (login manual no navegador funciona com o mesmo e-mail+senha).

**Observado (3 tentativas, 2026-10-12):** o worker resolveu o Turnstile no 2captcha
(`resolverTurnstile` retornou `ready` com token não-vazio — caso contrário lançaria
`SolverError`) e chamou `POST /api/auth/login` com `{identifier, password, captchaToken}`.
As 3 tentativas retornaram o mesmo resultado:

```
state: needs-login
lastError: ...; solver: login recusado (HTTP 401): Email ou senha incorretos.
```

**Interpretação:** com credenciais comprovadamente válidas no navegador, a única diferença
do caminho do worker é a origem do `captchaToken` (resolvido no IP do 2captcha, não no IP do
worker). O backend respondeu `HTTP 401` genérico ("Email ou senha incorretos"), consistente
com **rejeição do token do solver via validação de `remoteip` no siteverify** (hipótese de
GAME.md §9.1). O erro genérico de credencial mascara a causa, mas o navegador (mesmo
e-mail+senha, token do próprio IP) autentica — logo o diferencial é o captcha.

**Veredito VAL-01 (solver):** REFUTADO nesta conta/sessão — o `captchaToken` do
`TurnstileTaskProxyless` (IP do solver) **não é aceito** pelo login. Comportamento do worker
**correto e como projetado**: cai em `needs-login` com `lastError` claro, sem loop. Por D-02, o
**caminho de tokens colados passa a ser o principal** (ver Execução B).

**Turnstile sempre ligado / backend exige captcha em todo login (§9.1):** NÃO-OBSERVÁVEL por
este caminho — o worker sempre envia `captchaToken`; não dá para testar login sem captcha pelo
worker. Indício indireto: o login exige captcha válido (o do solver não passou).

**Guardas aplicadas:** nenhuma compra/venda; sem `cmid`; segredos só no `.env` local
(ignorado pelo git); nenhum token/senha/chave neste arquivo.
