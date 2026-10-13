# 2-SUMMARY — MIG-02 (revisão da auth do worker)

**Wave 2, 2026-10-13.** Resultado: **confirmado sem correção de código** (auth já migrada e coberta).

## Task 0 — Modelo de token (D-S6)
Opção **(a)** aprovada: mantido o par interno `accessToken/refreshToken` (`refreshToken = token`).
Nenhuma mudança em `config.ts` nem no schema da central. Token único ponta a ponta → backlog.
Documentado no GAME.md §3.3 (Wave 1).

## Task 1 — login + solver + sitekey dinâmica → confirmado
- `loginComCaptcha` (`provider.ts`): `POST /auth/entrar {id, senha, turnstileToken, dispositivo}`;
  `precisaNick:true` → `LoginError`; HTTP não-ok → `LoginError` com `erro` sanitizado; sucesso → token.
  Coberto em `provider.test.ts` (body exato, precisaNick, "login recusado traz o erro do jogo sem segredos").
- `buscarSitekey` (`solver.ts`): `GET /auth/provedores.turnstile`; override `TURNSTILE_SITEKEY`.
  Coberto ("busca a sitekey em /auth/provedores quando não há override" + caso com override).
- Segredos: `ocultarSegredos` cobre senha/solverKey/token; testes "nenhum segredo aparece no health nem
  nas mensagens de erro" e "redige segredos antes de truncar".

## Task 2 — renovação / AuthManager → confirmado
- `renovarTokens()` lança `RefreshNaoSuportadoError` (pokeidle.io não tem refresh REST); o `AuthManager`
  cai em **re-login via solver** quando o access expira. Coberto por "token salvo expirado sem refresh cai
  para o solver" e "invalidar re-loga pelo solver quando o token é rejeitado".
- `adiar` só em `RefreshIndisponivelError` (transitório); definitivo → needs-login. Decisão em GAME.md §9.1:
  refresh REST → **removido-com-evidência**.

## Task 3 — config de auth → confirmado (sem mudança)
- Caminhos de auth mutuamente exclusivos, `DISPOSITIVO` default `randomUUID()`, `TURNSTILE_SITEKEY` opcional:
  já presentes e cobertos em `config.test.ts`. D-S6 (a) ⇒ nada a alterar aqui. (Limpeza de sharding é a Wave 3.)

## Verificação
`pnpm vitest run src/auth src/config.test.ts` → **73 testes verdes** (4 arquivos).
Nenhum segredo em mensagens de erro (testes dedicados). Nenhuma linha de código alterada nesta wave.
