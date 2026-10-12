## Conflict Detection Report

Ingest: /gsd-ingest-docs, modo new, 2026-10-12
Precedência efetiva (manifest .planning/ingest-manifest.yaml, menor = vence): docs/plans/2026-10-11-multiacc-pokeidle-design.md (SPEC, 0) > packages/worker/GAME.md (SPEC, 1) > docs/plans/2026-10-11-multiacc-pokeidle-plan.md (DOC, 2) > README.md (DOC, 3)
Override explícito do orquestrador: nos pontos já implementados após o design (worker Node puro, WebSocket nativo com 4001/4005, dados 100% na central, central no k8s tcgreaper, registry ghcr.io/ayresigo, login via TokenProvider, gestão de usuários via /admin/users) a versão mais recente vence, registrada como INFO.
Checagens executadas: LOCKED vs LOCKED (nenhum ADR ingerido), docs UNKNOWN/low (nenhum), ciclos de cross_refs (grafo acíclico, profundidade máxima 2), variantes de PRD (nenhum PRD ingerido), contradições entre precedências.

### BLOCKERS (0)

### WARNINGS (5)

[WARNING] Limite de multi-conta: "4 contas por IP" vs "4 contas por jogador"
  Found: docs/plans/2026-10-11-multiacc-pokeidle-design.md (SPEC, precedência 0) justifica o proxy por conta com "PokeIdle limita 4 contas/IP". packages/worker/GAME.md (SPEC, precedência 1), seções 1 e 6, cita a regra oficial (https://poke.idleworld.online/rules, seção 10) como limite de 4 contas por jogador, com deleção acima disso sem autorização; a seção 4.4 mostra que o servidor fecha o WS com 4006 (ipLimited) e 4007 (machineLimited), ou seja, há limite por IP e por máquina além da regra por jogador.
  Impact: a precedência daria vitória ao design, mas o GAME.md é a pesquisa posterior com fonte primária. Se o roadmap tratar proxy como forma de passar de 4 contas, o requisito colide com a regra oficial (risco de deleção de contas) e com o limite por máquina (4007), que proxy não resolve porque o worker não envia cmid (GAME.md seção 9.2).
  → Confirmar a semântica vigente: proxy por conta continua opcional para o limite por IP (4006), mas o produto não promete mais de 4 contas por jogador. Registrar a regra no REQ-proxy-por-conta antes de rotear.

[WARNING] Estratégia de E2E: worker mock vs jogo falso com worker real
  Found: docs/plans/2026-10-11-multiacc-pokeidle-design.md (SPEC, 0), seção Testes, define "E2E smoke: compose sobe, login com usuário de teste, conta fake, worker com imagem mpw-worker-mock" sob Vitest. docs/plans/2026-10-11-multiacc-pokeidle-plan.md (DOC, 2), Task 29, usa docker/Dockerfile.worker-mock, docker-compose.e2e.yml na raiz e Playwright. README.md (DOC, 3), seção Rodar o E2E, descreve imagens reais ghcr.io/ayresigo/mpw-{web,control-plane,worker,central-api,fake-game}:e2e, e2e/docker-compose.e2e.yml, projeto mpw-e2e, jogo falso e2e/fake-game com POST /__e2e/kick (WS 4005) e Playwright. O repositório tem e2e/docker-compose.e2e.yml, e2e/smoke.spec.ts e e2e/fake-game/, o que bate com o README.
  Impact: esse ponto não está na lista de override do orquestrador. A precedência estrita manteria o design (mpw-worker-mock), que diverge do que está implementado; resolver em silêncio por recência violaria a regra de precedência.
  → Aprovar a estratégia do README (worker real contra e2e/fake-game, Playwright, e2e/docker-compose.e2e.yml) como vigente e marcar a seção Testes do design e a Task 29 do plano como superadas.

[WARNING] Pipeline de release: 4 imagens/:stable/token vs 5 imagens/stable+beta/usuário ci-release
  Found: docs/plans/2026-10-11-multiacc-pokeidle-plan.md (DOC, 2), Task 28: buildx de 4 imagens (web, control-plane, worker, updater), retag :stable e POST /admin/releases com o secret CENTRAL_ADMIN_TOKEN. README.md (DOC, 3), seção Para o admin: publicar uma versão: 5 imagens (inclui mpw-central-api) para linux/amd64 e linux/arm64, canais stable e beta (tag com pré-release vai para :beta), login com o admin dedicado ci-release pelos secrets CENTRAL_ADMIN_USERNAME e CENTRAL_ADMIN_PASSWORD e variable CENTRAL_API_URL. .github/workflows/release.yml usa CENTRAL_ADMIN_USERNAME/CENTRAL_ADMIN_PASSWORD e calcula canal beta/stable, o que bate com o README.
  Impact: o plano tem precedência maior que o README; a precedência estrita reintroduziria um secret que não existe (CENTRAL_ADMIN_TOKEN) e deixaria o central-api e o canal beta fora do release.
  → Aprovar o fluxo do README como vigente e tratar a Task 28 do plano como superada.

[WARNING] Compose distribuído: porta exposta e CURRENT_VERSION vs 127.0.0.1, ALLOWED_HOSTS e MPW_TAG
  Found: docs/plans/2026-10-11-multiacc-pokeidle-plan.md (DOC, 2), Task 26: web com ports "3000:3000" (todas as interfaces), CURRENT_VERSION=${CURRENT_VERSION:-stable}, imagens ghcr.io/<owner>/...:stable e CENTRAL_API_URL como única variável obrigatória "apontando para sua VPS". README.md (DOC, 3), seções Instalar e subir e Fixar ou voltar de versão: painel só em 127.0.0.1, aceito apenas como localhost/127.0.0.1/[::1] mais ALLOWED_HOSTS, versão fixada por MPW_TAG. docker-compose.yml e .env.example implementam a versão do README (127.0.0.1:3000:3000, MPW_TAG, IMAGE_REGISTRY, ALLOWED_HOSTS, sem CURRENT_VERSION).
  Impact: a precedência estrita (plano > README) exporia o painel local na rede, e o painel controla o Docker socket. Isso é regressão de segurança.
  → Aprovar o contrato do README e do compose atual (bind em 127.0.0.1, ALLOWED_HOSTS, MPW_TAG, IMAGE_REGISTRY) como vigente; Task 26 do plano superada.

[WARNING] Escopo do rollback em um clique
  Found: docs/plans/2026-10-11-multiacc-pokeidle-design.md (SPEC, 0), seção Update: "Compose referencia :stable; digest exato registrado para rollback em um clique", sem restringir o escopo. docs/plans/2026-10-11-multiacc-pokeidle-plan.md (DOC, 2), Task 27: o updater, se falhar, recria web e control-plane com :stable. README.md (DOC, 3), seção Fixar ou voltar de versão: "Configurações → voltar para vX devolve os workers para a versão anterior"; para voltar o painel inteiro é preciso desligar a atualização automática, ajustar MPW_TAG no .env e rodar docker compose pull && docker compose up -d. apps/control-plane/src/update/manager.ts grava rollback.json com o digest anterior do worker (digestAnterior) e expõe POST /update/rollback.
  Impact: o design promete rollback do sistema em um clique; o README e o código entregam um clique só para os workers, e o painel (web + control-plane) volta manualmente. O roadmap pode tratar o requisito como já cumprido sem estar.
  → Decidir se rollback em um clique do painel inteiro continua sendo requisito (gap a planejar) ou se o escopo vigente é workers em um clique e painel via MPW_TAG (atualizar o requisito).

### INFO (9)

[INFO] Auto-resolvido: worker é Node puro WS/REST, sem Chromium/Playwright
  Found: docs/plans/2026-10-11-multiacc-pokeidle-design.md (SPEC, 0), seções Objetivo e Requisitos consolidados ("bot Playwright") e Testes ("game loop vs DOM mockado"); docs/plans/2026-10-11-multiacc-pokeidle-plan.md (DOC, 2), Goal/Architecture/Tech Stack ("bots Playwright", "packages/worker (bot Playwright)"); packages/worker/GAME.md (SPEC, 1), seção 7, itens 2 e 6 (login por formulário DOM, "Chromium real via Playwright").
  Note: vence a decisão posterior e implementada: design, seção Componentes/Worker ("node:22-slim, sem browser: cliente WS/REST puro (ws + fetch)"), plano, Fase 3 ("Decisão pós-pesquisa ... worker é Node puro WS/REST, sem Chromium") e Task 20 ("Sem Playwright, sem Chromium"), GAME.md seção 9. packages/worker/package.json depende só de ws e undici. Na intel sintetizada, as menções a Playwright no worker e a "DOM mockado" ficam marcadas como obsoletas; Playwright continua apenas no E2E (README.md, Rodar o E2E).

[INFO] Auto-resolvido: o jogo usa WebSocket nativo com JSON {type}, não Socket.IO
  Found: docs/plans/2026-10-11-multiacc-pokeidle-design.md (SPEC, 0), seção Worker ("O jogo é server-authoritative (Socket.IO + REST /api/game/*)"); docs/plans/2026-10-11-multiacc-pokeidle-plan.md (DOC, 2), Fase 3 ("eventos Socket.IO"), Task 19 ("ws com agent para o Socket.IO") e Task 20 ("conecta Socket.IO com Bearer").
  Note: vence packages/worker/GAME.md (SPEC, 1), seções 2 e 4.4: WebSocket nativo em wss://poke.idleworld.online/ws com sharding (88 shards, djb2 do sub do JWT), token na query (?token=<access>&v=2, sem header Authorization) e /socket.io/ falhando no upgrade (1006). Override do orquestrador; implementado em packages/worker/src/game/client.ts.

[INFO] Auto-resolvido: close 4001 = token recusado, 4005 = sessão substituída
  Found: docs/plans/2026-10-11-multiacc-pokeidle-plan.md (DOC, 2), Task 20 ("WS close code 4001 (sessão duplicada) → state needs-login"); docs/plans/2026-10-11-multiacc-pokeidle-design.md (SPEC, 0), seção Login ("Sessão derrubada (WS close 4001)"); packages/worker/GAME.md seção 7 item 5 ("relogar em WS close 4001/sessão morta").
  Note: vence packages/worker/GAME.md seções 3.3, 4.4 e 9.2: 4001 = token recusado (invalida/refresh no máximo 1 vez a cada 5 min e reconecta; 4001 de novo ou refresh definitivamente recusado → needs-login), 4005 = replaced → needs-login sem reconectar, 4006/4007 → error, 4008/4009 → needs-login. Override do orquestrador; implementado em packages/worker/src/game/client.ts (FECHAMENTOS_TERMINAIS, WS_AUTH_RECUSADA).

[INFO] Auto-resolvido: central roda no k8s tcgreaper em https://pokeidle.ayresigo.dev, não numa VPS
  Found: docs/plans/2026-10-11-multiacc-pokeidle-design.md (SPEC, 0): "infra central (VPS do administrador)", subgraph "VPS do admin", Erros ("VPS fora") e Riscos ("VPS é dependência dura"); docs/plans/2026-10-11-multiacc-pokeidle-plan.md (DOC, 2): "apps/central-api (Fastify+Prisma, VPS)" e Task 26 (.env.example "aponta para sua VPS").
  Note: vence README.md (DOC, 3), seção Para o admin: central no Kubernetes (tcgreaper): namespace pokeidle, k8s/base (Kustomize, Traefik, cert-manager letsencrypt-prod, NetworkPolicy, CronJob de pg_dump com 14 dias de retenção), banco pokeidle no Postgres compartilhado postgres.tcgtracker.svc.cluster.local. .env.example traz CENTRAL_API_URL=https://pokeidle.ayresigo.dev. Override do orquestrador. A VPS via docker-compose.central.yml continua documentada como alternativa (README.md, Para o admin: central numa VPS (alternativa)). Onde o design diz "VPS", leia "central".

[INFO] Auto-resolvido: registry ghcr.io/ayresigo
  Found: docs/plans/2026-10-11-multiacc-pokeidle-plan.md (DOC, 2), Tasks 15, 26 e 28 usam o placeholder ghcr.io/<owner>/mpw-*.
  Note: vence README.md (DOC, 3) e o código: ghcr.io/ayresigo/mpw-* (README, Publicar uma versão; docker-compose.yml IMAGE_REGISTRY padrão ghcr.io/ayresigo; repositório GitHub ayresigo/pokeidle-plus). Override do orquestrador.

[INFO] Auto-resolvido: dados 100% na central; o volume local guarda só estado da instalação
  Found: README.md (DOC, 3), seção Parar: "Seus dados ficam no volume mpw_mpw-data ... a menos que queira perder a sessão salva".
  Note: não contradiz docs/plans/2026-10-11-multiacc-pokeidle-design.md ("Zero banco de dados local: tudo no Postgres central atrás da API"; refresh em "arquivo de volume local"). Pelo plano (docs/plans/2026-10-11-multiacc-pokeidle-plan.md, Tasks 9 e 15), o volume mpw-data guarda apenas session.json, settings.json e rollback.json; contas, usuários e releases ficam na central. Override do orquestrador confirma o princípio.

[INFO] Auto-resolvido: login no jogo via TokenProvider (token colado + solver Turnstile)
  Found: packages/worker/GAME.md (SPEC, 1), seção 7 item 2: login preenchendo o formulário de /login via DOM e aguardando cf-turnstile-response; docs/plans/2026-10-11-multiacc-pokeidle-plan.md (DOC, 2), Goal ("bots Playwright").
  Note: vence a interface TokenProvider: docs/plans/2026-10-11-multiacc-pokeidle-design.md, seção Login (solver Turnstile 2captcha-compatível como estratégia primária, token colado de sessionStorage['pokeweb:tokens'] como fallback, refresh via /api/auth/refresh, needs-login); plano, Task 19 (StoredTokenProvider, SolverTokenProvider, ordem stored → solver → needs-login); GAME.md seção 9.1 (sitekey 0x4AAAAAADkKBnFEMDt0MGBM, TurnstileTaskProxyless, 2FA → needs-login). README.md, Cadastrar contas, documenta o fluxo de colar tokens. Override do orquestrador. A ordem de execução (tokens salvos primeiro, solver depois) não contradiz o "solver primário" do design: o solver é a estratégia primária de obter tokens novos.

[INFO] Auto-resolvido: gestão de usuários via /admin/users (adição posterior ao design)
  Found: docs/plans/2026-10-11-multiacc-pokeidle-design.md (SPEC, 0) define users (role admin/user, active), mas nenhuma operação de gestão; docs/plans/2026-10-11-multiacc-pokeidle-plan.md (DOC, 2) cobre só o seed do admin (Task 8).
  Note: o README.md (DOC, 3), seção Cadastrar amigos, acrescenta a página Usuários (criar com senha gerada, desativar/ativar, redefinir senha, tornar admin/usuário, revogação efetiva em até 15 min, bloqueio de autodesativação/autorrebaixamento e de ficar sem admin ativo, desabilitada offline). Implementado em apps/central-api/src/users/routes.ts (GET/POST/PATCH /admin/users), no proxy do control-plane (apps/control-plane/src/users/routes.ts, sem DELETE) e em apps/web/components/UsersPanel.tsx. É adição, não contradição; override do orquestrador.

[INFO] Divergência doc vs código: versão do Next.js
  Found: docs/plans/2026-10-11-multiacc-pokeidle-plan.md (DOC, 2), Tech Stack: "Next.js 15 (App Router) + Tailwind".
  Note: apps/web/package.json declara next 16.4.0 e react 19.3.0. Nenhum outro doc ingerido fixa versão (o design diz só "Next.js App Router + Tailwind"). A intel sintetizada registra Next.js 16 (App Router) como stack vigente.
