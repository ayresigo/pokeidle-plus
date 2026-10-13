# Requirements: PokeIdle Plus

**Defined:** 2026-10-12
**Core Value:** As contas do jogador farmam sozinhas no Poke Idle World, 24 horas por dia, sem intervenção manual, sem ban e sem cair em `needs-login`.
**Milestone atual:** v1.1 — Farm autônomo
**Métrica de sucesso do milestone:** contas farmando sozinhas por 24 h, sem intervenção, sem ban e sem cair em `needs-login`.

## Entregue no v1.0 — Fundação (validado)

Release `v0.0.1-beta.1`, 2026-10-12. IDs da intel (`.planning/intel/requirements.md`), com os WARNINGS resolvidos pelas decisões D-11..D-15 de PROJECT.md.

- [x] **REQ-automacao-total**: worker Node puro joga via WS/REST, drain em SIGTERM, 5 erros seguidos sobem para o supervisor (validado só contra o jogo falso; o jogo real fica para VAL-*)
- [x] **REQ-escala-orquestracao-dinamica**: workers dinâmicos `mpw-worker-<accountId>`, backoff 1m → 15m, `degraded` após 3 falhas, compose só com `web` e `control-plane`
- [x] **REQ-proxy-por-conta**: proxy opcional por conta (REST e WS) com "testar proxy"; vale para o limite por IP (4006), sem passar de 4 contas por jogador (D-11)
- [x] **REQ-distribuicao-multiusuario**: central multi-tenant, JWT 15 min / refresh 30 d, grace offline de 7 dias, painel só em `127.0.0.1` + `ALLOWED_HOSTS` (D-14)
- [x] **REQ-updates-centralizados**: check no boot e a cada 6 h, auto/manual, rolling com drain, updater efêmero, rollback em um clique dos workers, painel via `MPW_TAG` (D-15)
- [x] **REQ-dados-centralizados**: AES-256-GCM em repouso, credenciais só em memória, volume local só com estado da instalação
- [x] **REQ-login-jogo-tokenprovider**: stored → solver → `needs-login`, refresh com write-back na central, colar `pokeweb:tokens` na UI
- [x] **REQ-ui-local**: painel Next.js 16 com dashboard, logs SSE, formulário de conta, atualizações
- [x] **REQ-gestao-usuarios**: página Usuários para admin, com as proteções de D-08
- [x] Release com 5 imagens multi-arch, canais `stable`/`beta`, admin `ci-release` (D-13); central no k8s `tcgreaper` (D-06); E2E com worker real + `e2e/fake-game` (D-12)

## v1.1 Requirements

Cada um mapeia para exatamente uma fase do ROADMAP.

### Validação com conta real (VAL)

Fonte: `packages/worker/GAME.md` §9, `.planning/codebase/CONCERNS.md` ("Pontos de verificação manual pendentes"). Cada item termina com GAME.md §9 marcando o ponto como confirmado, refutado ou não observável, com data e evidência (trecho de log, mensagem WS ou resposta HTTP, sem tokens nem senhas).

- [ ] **VAL-01**: Com uma conta real, fica comprovado se `POST /api/auth/login` aceita o `captchaToken` gerado por `TurnstileTaskProxyless` (resolvido no IP do solver) e se o backend exige `captchaToken` em todo login. Se o token for recusado, o worker cai em `needs-login` com `lastError` claro e o fluxo de tokens colados fica documentado como caminho principal.
- [ ] **VAL-02**: Fica comprovado se o servidor aceita sessão WS sem `cmid` ou fecha com 4007 (`machineLimited`). Se fechar com 4007, o worker para em `error` com motivo explícito no `/health` e no painel, sem reconectar em loop e sem forjar `cmid` (D-10).
- [ ] **VAL-03**: Fica comprovado que a sessão autenticada conecta no shard calculado (djb2 do `sub` % 88) e que esse shard é o mesmo do navegador, recebendo `field-init` depois de `enter-hunt`. Se divergir, o cálculo ou os overrides (`GAME_WS_URL`, `GAME_WS_PATH`, `GAME_WS_SHARDS`) são corrigidos.
- [ ] **VAL-04**: Em sessão real numa hunt, `field-kill` reais chegam, o formato dos eventos (`field-kill`, `catch-result`, `analyzer`) fica registrado e o contador de kills/capturas do worker sobe sem o watchdog de stall disparar à toa.
- [ ] **VAL-05**: Fica comprovado se o farm offline continua depois do drain (`docker stop`) sem `sleep-mode`. Se não continuar, o drain passa a enviar `{"type":"sleep-mode"}` e esperar `sleep-ok` antes de fechar, e o farm offline é observado de novo.
- [ ] **VAL-06**: Os demais pontos de GAME.md §9 são verificados na mesma sessão: rotação do refreshToken no `/api/auth/refresh`, access token como JWT com `exp`, respostas a `restart-state`/`balls-get` (`restart-freeze`, `balls`), `hunt-resume` + `enter-hunt resume:true` preservando o progresso, e close codes 4005-4009 que aparecerem em produção.
- [ ] **VAL-07**: Toda divergência entre o comportamento observado e o implementado vira correção em `packages/worker`, coberta por teste (`client.test.ts`/`provider.test.ts`/`loop`) que reproduz o comportamento real, com a suíte verde.

### Migração para pokeidle.io (MIG) — Phase 01.1 (INSERTED)

Fonte: VAL-01 da Phase 1 (`EVIDENCE.md` e banner do `GAME.md` na branch `ayresigo/validacao-real`): o jogo real é `https://pokeidle.io`, não `poke.idleworld.online`.

- [x] **MIG-01**: `packages/worker/GAME.md` documenta o protocolo do `pokeidle.io` (auth, WS, eventos, comandos, códigos de fechamento observados) como fonte única; o material do `poke.idleworld.online` sai ou fica marcado como histórico.
- [x] **MIG-02**: Auth do worker no `pokeidle.io` (`POST /auth/entrar` com `{id, senha, turnstileToken, dispositivo}`, sitekey dinâmica de `GET /auth/provedores`, solver 2captcha, token colado, renovação) revisada, com a robustez do v1.0 preservada (transitório vs definitivo, `invalidar` com teto, sem segredos em log).
- [x] **MIG-03**: Game loop do worker no `pokeidle.io` (WS raw, `hello`/`welcome`, `hunt.select`/`campo`/`batalha`/`estado`, ping/pong, kills por `batalha.ev[].k==='morte'`) revisado, com reconexão com teto, tratamento de rejeição de token, sessão substituída, manutenção, reciclagem e watchdog restaurados e adaptados ao comportamento real (ou removidos com evidência).
- [x] **MIG-04**: Testes do worker para auth e game loop no nível do v1.0 (reconexão, rejeição, drain, watchdog, com fake timers e servidor ws local), suíte verde.
- [x] **MIG-05**: Nenhuma referência funcional a `poke.idleworld.online` no repo: `GAME_URL` padrão do control-plane, instrução de tokens na UI, `e2e/fake-game`, README, página raiz da central; E2E verde.
- [x] **MIG-06**: Smoke real na conta descartável (login via solver, `welcome`, kills, drain) + conclusão de VAL-05/VAL-06 e das observações read-only do 6-PLAN da Phase 1 para a Phase 2; release beta com o worker migrado. Nada pago na conta real.

### Autoplay (AUTO)

As decisões de produto (qual hunt, que bolas e consumíveis comprar e em que quantidade, o que vender, horários, que eventos tratar e como) saem do `/gsd-discuss-phase 2` com o usuário. Os requisitos abaixo fixam só o resultado esperado.

- [ ] **AUTO-01**: Cada conta caça segundo uma política de hunt definida (escolha, troca e recuperação quando a hunt para de render kills), sem ficar presa em hunt inválida ou sem kills.
- [ ] **AUTO-02**: A conta não para de capturar por falta de pokébolas ou consumíveis: o worker repõe sozinho (`POST /api/game/balls/buy` e equivalentes) segundo uma política de estoque e gasto de gold definida.
- [ ] **AUTO-03**: O inventário/depot não lota a ponto de travar o farm: o loot é vendido sozinho (`/api/game/shop/sell`, `/api/game/flint/sell`) segundo uma política definida do que vender e do que guardar.
- [ ] **AUTO-04**: O bot segue uma rotina definida ao longo do dia (sessões, pausas, uso do Modo Soneca ou equivalente, conforme os achados de VAL-05), sem relogins que cancelem o farm offline (menos de ~5 min entre sessões).
- [ ] **AUTO-05**: Os eventos do jogo que interrompem o farm (por exemplo `restart-freeze`, `hunt-cooldown`, `field-lost`, `field-teleport-city`, manutenção 4003) são tratados sozinhos e o farm volta sem ação do usuário.
- [ ] **AUTO-06**: Run de aceite: até 4 contas reais do jogador rodam 24 h contínuas sem nenhum clique, sem cair em `needs-login` ou `error`, sem ban nem aviso do jogo, e com kills/capturas subindo ao longo da janela, comprovado por um relatório da run (estado por conta, kills, compras, vendas, reinícios).

### Supervisão contínua (SUP)

Fonte: `.planning/codebase/CONCERNS.md` (Tech Debt "Estado desejado do supervisor só em memória"; Known Bug "Auto-update perde a supervisão dos workers").

- [ ] **SUP-01**: O estado desejado de cada worker (rodando/parado) sobrevive a reinício do control-plane, inclusive o causado pelo auto-update via `mpw-updater`, e a reboot do Docker Desktop. Workers que deviam estar rodando voltam e seguem supervisionados (backoff, `degraded`) sem clicar em Iniciar.
- [ ] **SUP-02**: Tokens do jogo renovados pelo worker não se perdem num reinício: o worker recriado sobe com o refresh token mais recente, sem cair em `needs-login` por usar um token já rotacionado.

### Página raiz da central (ROOT)

- [x] **ROOT-01**: `GET /` em `https://pokeidle.ayresigo.dev` devolve 200 com conteúdo útil (o que é o PokeIdle Plus e como instalar ou começar) em vez do 404 JSON padrão do Fastify. O formato (página HTML simples ou JSON informativo) é decidido no `/gsd-plan-phase 3`.
- [x] **ROOT-02**: A rota raiz é pública, não expõe dados de usuários, contas, releases internas nem segredos, e as rotas existentes (`/health`, `/auth/*`, `/accounts*`, `/version`, `/admin/*`) mantêm o comportamento, com os testes da central verdes.
- [x] **ROOT-03**: A nova versão da central está no ar no `tcgreaper`: release publicada, `newTag` atualizado em `k8s/base/kustomization.yaml` e `kubectl apply` feito pelo usuário ou com a confirmação explícita dele.

## v2 Requirements (backlog)

Reconhecidos, fora do roadmap do v1.1. Ver a seção Backlog do ROADMAP e `.planning/codebase/CONCERNS.md`.

### Release e update

- **REL-01**: Canal de update configurável no control-plane (hoje fixo em `GET /version?channel=stable`), derivado de `MPW_TAG` ou das configurações, para painéis no `beta` receberem atualizações beta.
- **REL-02**: Tag `:stable` disponível (primeira release estável ou instrução de instalação pelo `beta`), para o `.env.example` padrão (`MPW_TAG=stable`) não falhar no `docker compose pull`.

### Central

- **CEN-01**: Rate limit e limite de tamanho no `POST /auth/login` e `/auth/refresh` da central (`@fastify/rate-limit` ou middleware do Traefik, `maxLength`, `trustProxy`).
- **CEN-02**: Logger habilitado no Fastify da central e do control-plane, para `request.log.error` deixar rastro.

### Qualidade

- **QA-01**: E2E Playwright rodando no CI (hoje só local), com typecheck de `e2e/`.
- **QA-02**: Helpers de teste duplicados consolidados em `__fixtures__/` por pacote, como no worker (`fabricarJwt` em 9 arquivos do control-plane, `criarOrchestratorFake`/`workerRodando` em 4, `limparBanco`/`seedUser` em 5 da central).

## Out of Scope

| Feature | Reason |
|---------|--------|
| Mais de 4 contas por jogador | Regra oficial do jogo (seção 10) deleta contas acima disso sem autorização (D-11) |
| Forjar `cmid`/fingerprint de máquina | Burla o limite por máquina; 4007 é bloqueio, não alvo de contorno (D-10) |
| Browser/Playwright no worker | Worker Node puro WS/REST (D-01) |
| Banco de dados local | Dados 100% na central (D-05) |
| Rollback em um clique do painel inteiro | Escopo aprovado: um clique para os workers, painel via `MPW_TAG` (D-15) |
| 2FA nas contas do jogo | Exige código humano; conta com 2FA vai para `needs-login` (D-04) |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| VAL-01 | Phase 1 | Pending |
| VAL-02 | Phase 1 | Pending |
| VAL-03 | Phase 1 | Pending |
| VAL-04 | Phase 1 | Pending |
| VAL-05 | Phase 1 | Pending |
| VAL-06 | Phase 1 | Pending |
| VAL-07 | Phase 1 | Pending |
| MIG-01 | Phase 01.1 | Complete |
| MIG-02 | Phase 01.1 | Complete |
| MIG-03 | Phase 01.1 | Complete |
| MIG-04 | Phase 01.1 | Complete |
| MIG-05 | Phase 01.1 | Complete |
| MIG-06 | Phase 01.1 | Complete |
| AUTO-01 | Phase 2 | Pending |
| AUTO-02 | Phase 2 | Pending |
| AUTO-03 | Phase 2 | Pending |
| AUTO-04 | Phase 2 | Pending |
| AUTO-05 | Phase 2 | Pending |
| AUTO-06 | Phase 2 | Pending |
| SUP-01 | Phase 2 | Pending |
| SUP-02 | Phase 2 | Pending |
| ROOT-01 | Phase 3 | Complete |
| ROOT-02 | Phase 3 | Complete |
| ROOT-03 | Phase 3 | Complete |

**Coverage:**
- v1.1 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0 ✓

---
*Requirements defined: 2026-10-12*
*Last updated: 2026-10-12 after criação do roadmap (v1.1 — Farm autônomo)*
