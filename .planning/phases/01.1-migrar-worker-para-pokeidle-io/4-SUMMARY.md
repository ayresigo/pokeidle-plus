# 4-SUMMARY — MIG-05 (migração de domínio/protocolo fora do worker)

**Wave 4, 2026-10-13** (delegado + integração). Suítes de pacote verdes; grep do repo limpo.

## Arquivos alterados
- `apps/control-plane/src/app.ts` — default de `gameUrl`: `poke.idleworld.online` → `https://pokeidle.io`.
  Nenhum teste fixava o default antigo.
- `apps/web/lib/conta.ts` + `conta.test.ts` — `extrairTokens` (D-S6 opção a): aceita o **token único** colado
  (preenche `accessToken` e `refreshToken` com o mesmo valor) ou, por compat, o JSON antigo. Mensagens de erro
  adaptadas.
- `apps/web/components/AccountForm.tsx` — instrução aponta para `pokeidle.io` (copiar o token Bearer do
  Local Storage); label "Token do pokeidle.io".
- `e2e/fake-game/token.ts` — JWT fake único com `exp` em 2100 (removido o refresh fake).
- `e2e/fake-game/server.ts` — protocolo pokeidle.io: `GET /auth/provedores`→`{turnstile}`;
  `POST /auth/entrar`→`{nick,token,provedor:'local',precisaNick:false,termosVersao}`; WS raw `/`:
  `{t:'hello',token}`→`{t:'welcome',estado}`; `{t:'hunt.select',slug}`→`{t:'campo.init',...}`; emite
  `{t:'batalha',ev:[{k:'morte',quem:'selvagem',...}]}`; `{t:'ping'}`→`{t:'pong'}`.
  **Kick** (`POST /__e2e/kick`): **revoga** a sessão (`revogado=true`) e fecha os sockets; no reconnect o
  `hello` é recusado (`erro`) → o worker, sem solver no E2E, cai em `needs-login` (caminho migrado existente,
  sem inventar close code). Isto alinha o teste de kick ao comportamento real sem antecipar a wave 6.
- `e2e/smoke.spec.ts` — usa o label "Token do pokeidle.io" e o token fake único; teste de kick renomeado
  ("sessão revogada") assertando `needs-login` + CTA "colar tokens".
- `README.md` — extração de token e descrição do fake-game atualizadas para pokeidle.io.
- `apps/central-api/src/root/routes.ts` — lead da raiz com link para `pokeidle.io`.

## Verificação
- `pnpm --filter web test` → **94/94**; `pnpm --filter control-plane test` → **193/193**;
  `apps/central-api/src/root/root.test.ts` → **3/3** (suíte completa da central exige Postgres `*_dev`/`*_test`;
  erros restantes são de conexão ao DB, pré-existentes e alheios a esta fase — rodar no CI/com a DB subida).
- `e2e typecheck` (`tsc --noEmit`) → exit 0.
- `grep -rn "poke.idleworld.online|idleworld|pokeweb:tokens|field-init|enter-hunt|field-kill" apps e2e README.md packages/worker/src`
  → vazio (só o apêndice histórico do GAME.md menciona o antigo). **MIG-05/SC4 cumprido.**

## E2E
`pnpm e2e` (Docker Desktop) rodado na integração (ver log da fase). O caminho de "sessão substituída
definitiva" real do pokeidle.io (close code/evento) ainda será confirmado e afinado na **wave 6** (gated por
smoke); o fake-game usa revogação de token para exercitar o `needs-login` de forma fiel.
