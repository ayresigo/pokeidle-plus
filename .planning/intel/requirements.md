# Requirements (intel sintetizada)

Gerado por gsd-doc-synthesizer em 2026-10-12 (modo new).

Nenhum PRD foi ingerido. Os requisitos abaixo vêm da seção "Requisitos consolidados" e das seções de componentes/fluxos do SPEC de design (precedência 0); um vem do README (DOC, precedência 3). Os critérios de aceite são extraídos dos próprios docs, sem invenção. Requisitos com WARNING aberto em `.planning/INGEST-CONFLICTS.md` estão marcados.

### REQ-automacao-total
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Requisitos consolidados; Componentes/Worker)
- descrição: o bot joga sem intervenção manual. Vigente: worker Node puro WS/REST, sem browser (ver decisions.md D-01; o texto original "bot Playwright" foi superado).
- aceite:
  - worker entra na hunt (`enter-hunt`), recebe `field-init`/`field-kill` e mantém o loop (packages/worker/GAME.md, seções 5 e 9.2)
  - em SIGTERM, para de agendar, espera a ação em voo (até 20 s), fecha o WS e sai com 0 (docs/plans/2026-10-11-multiacc-pokeidle-plan.md, Task 20; GAME.md 9.2)
  - erros de ação não derrubam o loop; 5 consecutivos propagam para o supervisor (plano, Task 20)
- escopo: packages/worker

### REQ-escala-orquestracao-dinamica
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Requisitos consolidados; Orquestração)
- descrição: escala sem teto artificial, com orquestração via Docker API em vez de compose estático.
- aceite:
  - workers criados dinamicamente como `mpw-worker-<accountId>` com labels de rastreio (design, Orquestração)
  - restart com backoff exponencial 1m → 15m gerenciado pelo control-plane; flag na UI após 3 falhas (design, Orquestração e Erros por design)
  - o compose declara apenas `web` e `control-plane` (design, Orquestração)
- escopo: apps/control-plane

### REQ-proxy-por-conta  [WARNING aberto: limite de multi-conta]
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Requisitos consolidados; Componentes/UI)
- descrição: proxy opcional por conta. O design justifica com "PokeIdle limita 4 contas/IP", mas packages/worker/GAME.md (seções 1, 4.4 e 6) indica limite oficial de 4 contas por jogador, mais limites de servidor por IP (4006) e por máquina (4007). Ver INGEST-CONFLICTS.md.
- aceite:
  - form de conta aceita proxy, com botão "testar proxy" que mostra o IP de saída (design, UI; README.md, Cadastrar contas)
  - o proxy vale para REST e WS do worker (docs/plans/2026-10-11-multiacc-pokeidle-plan.md, Task 19: `PROXY_URL` via undici ProxyAgent e agent no WS)
- escopo: apps/web, apps/control-plane, packages/worker

### REQ-distribuicao-multiusuario
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Requisitos consolidados; Componentes/Central API)
- descrição: distribuível para amigos. Cada um roda o compose local, autentica no central e vê só as próprias contas.
- aceite:
  - CRUD multi-tenant de contas no central; acesso a conta de outro usuário → 404 (design, Central API; plano, Task 6)
  - auth JWT com access de 15 min e refresh de 30 d; grace offline de 7 dias; expirado → UI read-only; workers em execução nunca são derrubados por auth (design, Fluxos/Auth)
  - painel local só em 127.0.0.1 (README.md, Instalar e subir) [ver WARNING sobre o compose]
- escopo: apps/central-api, apps/control-plane, apps/web

### REQ-updates-centralizados  [WARNING aberto: escopo do rollback]
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Requisitos consolidados; Fluxos/Update)
- descrição: o admin publica imagem nova e os clientes recebem, com atualização automática, disparo manual e rollback.
- aceite:
  - control-plane consulta `GET /version` no boot e a cada 6 h (design, Update)
  - auto-update: pull, recreate rolling dos workers com drain e updater efêmero que recria control-plane + UI (design, Update)
  - modo manual: badge na UI com changelog (design, Componentes/UI e Update)
  - rollback: design diz "digest exato registrado para rollback em um clique"; README.md (Fixar ou voltar de versão) entrega um clique só para os workers, e o painel volta via `MPW_TAG`. Ver INGEST-CONFLICTS.md.
  - falha de GHCR mantém a imagem atual, com retry com backoff e badge de erro (design, Erros por design)
- escopo: apps/control-plane, packages/updater, apps/web

### REQ-dados-centralizados
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Requisitos consolidados; Modelo de dados central)
- descrição: zero banco de dados local; tudo no Postgres central atrás da API.
- aceite:
  - senhas PokeIdle, tokens e solver key criptografados em repouso com AES-256-GCM (design, Central API e Modelo de dados)
  - credenciais descriptografadas só em `GET /accounts/:id/credentials`, usado pelo control-plane no start, mantidas só em memória e nunca em disco/log (plano, Tasks 6 e 13)
  - volume local guarda só estado da instalação (ver decisions.md D-05)
- escopo: apps/central-api, apps/control-plane

### REQ-login-jogo-tokenprovider
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Componentes/Login)
- descrição: login no jogo atrás da interface `TokenProvider`, com solver Turnstile como estratégia primária e token colado como fallback.
- aceite:
  - refresh automático via `/api/auth/refresh`, com tokens renovados persistidos no central pelo control-plane (design, Login)
  - sessão derrubada ou refresh expirado → worker em `needs-login` e UI pede nova ação (design, Login; códigos vigentes em decisions.md D-03)
  - conta em needs-login mostra campo "JSON de pokeweb:tokens" (README.md, Cadastrar contas)
- escopo: packages/worker, apps/control-plane, apps/web

### REQ-ui-local
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Componentes/UI)
- descrição: UI Next.js App Router + Tailwind com telas de login, dashboard de contas, form de conta e updates.
- aceite:
  - dashboard mostra status, última ação, uptime, start/stop/restart e logs via SSE (design, UI)
  - form de conta com credenciais + proxy com teste (design, UI)
  - updates com badge, changelog, atualizar/rollback e toggle automático (design, UI)
- escopo: apps/web

### REQ-gestao-usuarios
- source: README.md (Cadastrar amigos) — DOC, precedência 3; adição posterior ao design (ver decisions.md D-08)
- descrição: o admin gerencia os usuários da central pelo painel.
- aceite:
  - criar usuário (3 a 64 caracteres: letras sem acento, números, `.`, `-`, `_`) com senha forte gerada e exibida só até salvar
  - desativar/ativar; redefinir senha revoga sessões (efetivo em até 15 min); tornar admin/usuário vale na próxima renovação
  - ninguém desativa/rebaixa a si mesmo; a central recusa operação que deixe o sistema sem admin ativo
  - página desabilitada em modo offline
- escopo: apps/central-api, apps/control-plane, apps/web
