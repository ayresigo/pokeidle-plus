# Codebase Concerns

**Analysis Date:** 2026-10-12

Escopo: monorepo `multiacc-pokeidle` (PokeIdle Plus) na versão publicada `v0.0.1-beta.1`. Componentes: `apps/central-api` (Fastify + Prisma, k8s), `apps/control-plane` (Fastify + dockerode, local), `apps/web` (Next.js 16), `packages/worker` (Node WS/REST), `packages/updater`, `e2e/` (Playwright), `.github/workflows/`, `k8s/base/`.

Prioridade sugerida (maior impacto primeiro): regra de segurança Docker → verificações manuais do worker (GAME.md §9) → estado desejado do supervisor em memória → canal `beta` x `stable` → painel sem autenticação própria → falta de logs nos serviços Fastify.

---

## Regra de segurança Docker (OBRIGATÓRIA para qualquer fase que toque Docker)

**Origem:** a regra global do usuário em `C:/Users/ayres/.omp/agent/AGENTS.md` (linha 7) foi criada depois de um incidente em que volumes Docker foram apagados por comandos com escopo global. Os detalhes do incidente não estão registrados no repositório; o que vale é a regra:

- Nunca rodar `docker system prune`, `docker volume prune`, `docker image prune`.
- Nunca rodar `docker volume rm` / `docker rm` / `docker rmi` sobre listagens com filtros globais (`dangling`, `-a`, `$(docker ... -q)`, `xargs`).
- Remover somente recursos criados na própria sessão, **por nome exato**.
- Repassar a regra a todo subagente que tocar em Docker.
- Não executar comandos destrutivos (delete, reset, drop) sem confirmação explícita.

**Onde o repositório ainda conflita ou chega perto da regra:**

- `README.md` linhas 63-73 (seção "Parar") instrui o usuário final a rodar `docker ps -aq --filter label=mpw.managed=true | xargs -r docker rm -f` (e o equivalente PowerShell com `ForEach-Object`). É exatamente o padrão proibido (listagem filtrada + `xargs rm -f`). Também apaga workers de qualquer outra instalação/ambiente que use a mesma label (ex.: o E2E, `e2e/docker-compose.e2e.yml`, cujos workers também são `mpw-worker-<id>` com `mpw.managed=true`), e containers de teste criados por `apps/control-plane/src/orchestrator/orchestrator.test.ts`.
  - Fix approach: substituir por uma ação "parar e remover todas as contas" no painel (control-plane já sabe os IDs via `listWorkers()` em `apps/control-plane/src/orchestrator/orchestrator.ts`) ou por instruções de remoção por nome exato (`docker rm -f mpw-worker-<accountId>`).
- `README.md` linha 75: avisa contra `docker compose down -v` (perda do volume `mpw_mpw-data` com `session.json`, `settings.json`, `rollback.json`). Manter o aviso.
- `e2e/docker.ts` `derrubarAmbiente()` (linhas 111-122) roda `docker compose -p mpw-e2e -f e2e/docker-compose.e2e.yml down -v --remove-orphans` **automaticamente no início** (`e2e/global-setup.ts` linha 15) e no fim de todo `pnpm e2e`. Escopo limitado ao projeto `mpw-e2e` (volumes `mpw-e2e_db`, `mpw-e2e_data`), e workers são removidos por nome exato a partir de `e2e/.estado/workers.txt` — conforme a regra. Risco residual: qualquer coisa que alguém crie manualmente com nome de projeto `mpw-e2e` é destruída sem confirmação.
- `apps/control-plane/src/orchestrator/orchestrator.test.ts` roda dentro de `pnpm -r test` sempre que um daemon Docker responde (`describe.skipIf(!dockerDisponivel)`, linha 12): faz `pull` de `alpine:latest` e cria containers reais `mpw-worker-test-<ts>-<n>` com `mpw.managed=true` no daemon do desenvolvedor. A limpeza é por ID exato (ok), mas durante o teste o control-plane real enxerga esses containers como workers.
- O próprio produto apaga containers: `DockerOrchestrator.removeUpdater()`/`removeOneShot()` usam `remove({ force: true })` por nome/ID exato (`mpw-updater`, ID do one-shot) — conforme a regra. `packages/updater/src/docker.ts` `remover` também é por ID. Não introduzir remoção por label/filtro nesses módulos.
- Restrição para agentes neste repo: proibido qualquer `docker` que crie/pare/remova recursos fora do que a própria tarefa criou, e qualquer `kubectl` que altere o cluster `tcgreaper` sem confirmação explícita.

---

## Tech Debt

**Estado desejado do supervisor só em memória:**
- Issue: `Supervisor.estados` (desired running/stopped), `tokensObservados` e `recriacoesPendentes` vivem só em memória. `desireRunning()` só é chamado em `POST /workers/:accountId/start|restart`. Workers são criados sem `RestartPolicy` (`HostConfig: { AutoRemove: false }`, confirmado pelo teste que espera `RestartPolicy "no"`).
- Files: `apps/control-plane/src/supervisor/supervisor.ts` (linhas 66-110), `apps/control-plane/src/workers/routes.ts` (linhas 82-101), `apps/control-plane/src/orchestrator/orchestrator.ts` (linhas 58-72)
- Impact: depois de qualquer reinício do control-plane — inclusive o que o próprio auto-update provoca via `mpw-updater` — ou de reboot do Docker Desktop, nenhum worker volta sozinho; workers que caírem ficam `exited` para sempre; o painel mostra `desired: "none"`. Tokens renovados que só existiam em `tokensObservados` se perdem e o worker volta com o `REFRESH_TOKEN` antigo do env (que pode já ter sido rotacionado → needs-login).
- Fix approach: persistir o estado desejado em `/data` (mesmo padrão de `settings.json`/`rollback.json` do `UpdateManager`) ou reidratar no boot a partir dos containers com `mpw.managed=true` existentes; avaliar `RestartPolicy: unless-stopped` nos workers com o supervisor só tratando recriação.

**Canal de release fixo em `stable` no painel:**
- Issue: `UpdateManager.checkForUpdate()` sempre consulta `GET /version?channel=stable`. O workflow manda tags com pré-release para o canal `beta` e só move `:beta`. A única release publicada é `v0.0.1-beta.1` (canal beta).
- Files: `apps/control-plane/src/update/manager.ts` (linha 163), `.github/workflows/release.yml` (linhas 27-37, 196-203), `docker-compose.yml` (`MPW_TAG:-stable`), `.env.example` (`MPW_TAG=stable`)
- Impact: com o `.env.example` padrão, `docker compose pull` procura `ghcr.io/ayresigo/mpw-*:stable`, que só existe depois da primeira release estável. Painéis instalados com `MPW_TAG=beta` nunca recebem atualizações beta (o `/version?channel=stable` dá 404 → "sem atualização").
- Fix approach: tornar o canal configurável (env `UPDATE_CHANNEL`/settings) e derivá-lo de `MPW_TAG`; documentar no README como instalar o beta.

**Comparação de versão não é semver:**
- Issue: a central devolve a release mais recente por `publishedAt` (`orderBy: { publishedAt: "desc" }`), e o painel considera update qualquer `latestVersion !== currentVersion`.
- Files: `apps/central-api/src/releases/routes.ts` (linhas 57-60), `apps/control-plane/src/update/manager.ts` (linhas 182-183)
- Impact: publicar um hotfix de uma linha antiga depois de uma mais nova faz todo painel com auto-update "atualizar" para trás. Não existe rota para despublicar/yank uma release ruim (só `POST`/`GET /admin/releases`).
- Fix approach: ordenar/comparar por semver; adicionar `DELETE /admin/releases/:id` (ou flag `yanked`).

**Configuração `CONTROL_PLANE_URL` do worker sem uso:**
- Issue: `loadConfig` lê e valida `CONTROL_PLANE_URL`, e `montarEnv` sempre o injeta, mas nenhum código do worker usa `config.controlPlaneUrl`.
- Files: `packages/worker/src/config.ts` (linhas 10, 83, 154), `apps/control-plane/src/workers/routes.ts` (linha 73), `apps/control-plane/src/app.ts` (linhas 71-74)
- Fix approach: remover de ponta a ponta ou implementar o uso previsto.

**`HUNT_SLUG` não configurável pelo painel:**
- Issue: o worker aceita `HUNT_SLUG`, mas `Account` (Prisma) não tem campo de hunt e `montarEnv` não passa `HUNT_SLUG`. Sempre cai na escolha automática (hunt de menor nível > 0), que GAME.md §9.2 descreve como "pode ser fraca demais".
- Files: `apps/central-api/prisma/schema.prisma` (model `Account`), `apps/control-plane/src/workers/routes.ts` (linhas 67-80), `packages/worker/src/game/loop.ts` (`escolherHuntPadrao`)
- Fix approach: campo `huntSlug` em `Account` + formulário `apps/web/components/AccountForm.tsx` + env no `montarEnv`.

**Recriação de worker reaproveita env antigo:**
- Issue: em auto-update/rollback (`UpdateManager.recriarWorker`) e no restart do supervisor com tokens novos (`Supervisor.reiniciar`), a config vem de `inspectWorker()` (env do container atual) e não de `/accounts/:id/credentials`. Senha, proxy ou solver key alterados na central só valem após `POST /workers/:id/restart` manual. Se a imagem antiga já não existir localmente, `inspectWorker` não consegue filtrar o env da imagem (`envDaImagem` vazio) e `APP_VERSION`/`NODE_ENV` antigos são copiados para o container novo.
- Files: `apps/control-plane/src/orchestrator/recriar.ts`, `apps/control-plane/src/orchestrator/orchestrator.ts` (linhas 180-202), `apps/control-plane/src/update/manager.ts` (linhas 366-401)

**Imagens de runtime carregam o monorepo inteiro:**
- Issue: todos os Dockerfiles fazem `COPY --from=build /app ./` (node_modules com devDependencies, fontes, `tsx`, `vitest`, `typescript`), rodam como root (sem `USER`) e não usam `pnpm deploy --prod`. A central depende de `tsx` (devDependency da raiz) em produção para o seed (`pnpm db:seed` → `tsx prisma/seed.ts`) e chama `pnpm` via corepack no `CMD`; o cache do corepack não é copiado para o estágio runtime, então o pnpm é baixado no start do pod [INFERENCE: comportamento padrão do corepack, não observado em runtime].
- Files: `docker/Dockerfile.central-api` (linhas 13-23), `docker/Dockerfile.control-plane`, `docker/Dockerfile.worker`, `docker/Dockerfile.updater`
- Impact: imagens maiores (multi-arch), superfície de ataque maior, start da central dependente de rede externa para baixar o pnpm.
- Fix approach: compilar o seed para `dist/`, usar `node node_modules/prisma/build/index.js migrate deploy` ou um init container, `pnpm deploy --prod`, `USER node`.

**Código duplicado entre pacotes:**
- `repositorioDaImagem` existe em `apps/control-plane/src/orchestrator/orchestrator.ts` (linha 23) e `packages/updater/src/recriacao.ts` (linha 32); `NOME_UPDATER = "mpw-updater"` em `apps/control-plane/src/orchestrator/orchestrator.ts` e `e2e/docker.ts`; tipos de snapshot/update duplicados entre `apps/control-plane/src/supervisor/supervisor.ts`/`update/manager.ts` e `apps/web/lib/api.ts`. Não há pacote compartilhado; mudanças de contrato precisam ser feitas em vários lugares à mão.
- O design (`docs/plans/2026-10-11-multiacc-pokeidle-design.md` linha 70) prevê "env var contract versionado" entre control-plane e worker; não há nenhuma verificação de versão de contrato.

**Script `lint` só existe na web:**
- Issue: `package.json` raiz tem `"lint": "pnpm -r lint"`, mas só `apps/web` define `lint` (ESLint). `central-api`, `control-plane`, `worker`, `updater` e `e2e` não têm linter; o CI faz só `tsc --noEmit` neles. `e2e` nem tem typecheck no CI.
- Files: `package.json`, `apps/*/package.json`, `packages/*/package.json`, `.github/workflows/ci.yml` (linhas 50-57)

**Deploy da central desacoplado do release:**
- Issue: o workflow publica a imagem `mpw-central-api` e registra a release, mas o cluster só muda com bump manual de `newTag` em `k8s/base/kustomization.yaml` + `kubectl --context tcgreaper apply -k k8s/base`. Migrações rodam no start do pod (`prisma migrate deploy`) com `strategy: Recreate` e 1 réplica.
- Files: `k8s/base/kustomization.yaml`, `k8s/base/central-api.yaml`, `docker/Dockerfile.central-api` (linha 23)
- Impact: painéis podem ficar numa versão que espera uma central mais nova (ou vice-versa); toda atualização da central tem downtime; migração com erro derruba o pod em CrashLoop.

---

## Known Bugs

**Auto-update perde a supervisão dos workers:**
- Symptoms: depois que o `mpw-updater` recria o control-plane, workers que caem não são reiniciados e aparecem com `desired: "none"`.
- Files: `apps/control-plane/src/supervisor/supervisor.ts`, `apps/control-plane/src/update/manager.ts` (linhas 223-230), `packages/updater/src/atualizar.ts`
- Trigger: qualquer `applyUpdate()` bem-sucedido seguido de queda de worker.
- Workaround: clicar **Iniciar**/**Reiniciar** em cada conta depois do update.

**Painel padrão não encontra imagens `:stable`:**
- Symptoms: `docker compose pull` falha com manifest unknown enquanto só existir release beta.
- Files: `docker-compose.yml` (linhas 5, 21), `.env.example` (linha 12), `.github/workflows/release.yml` (linha 34)
- Trigger: instalar seguindo o README com `v0.0.1-beta.1` como única release.
- Workaround: `MPW_TAG=beta` (ou `0.0.1-beta.1`) no `.env`, sabendo que o auto-update não acompanha o canal beta.

**"Saudável" aceita qualquer estado diferente de `booting`:**
- Symptoms: `UpdateManager.aguardarSaudavel` considera o worker novo saudável se `state` for `needs-login` ou `error`; o rollback automático por conta não dispara nesses casos.
- Files: `apps/control-plane/src/update/manager.ts` (linhas 403-423)

**Updater pode deixar versões misturadas:**
- Symptoms: workers são recriados na versão nova antes do updater; se o updater falhar no `web` depois de atualizar o `control-plane`, fica control-plane novo + web antigo (o rollback do updater só desfaz o alvo que falhou). Com mais de um container com a mesma `mpw.role`, o updater usa o primeiro da lista (`candidatos[0]`) sem critério.
- Files: `packages/updater/src/atualizar.ts` (linhas 63-107), `apps/control-plane/src/update/manager.ts` (linhas 219-230)

---

## Security Considerations

**Painel local sem autenticação própria:**
- Risk: o control-plane guarda **uma** sessão da central em `/data/session.json` e `requireSession` só verifica se essa sessão do servidor é válida — não há cookie/token por navegador (o plano previa "cookie http-only de sessão local"; não há nenhum uso de cookie em `apps/`). Qualquer processo local ou outro usuário do SO que alcance `127.0.0.1:3000` opera o painel (inicia/para workers, lista contas, gerencia usuários se a sessão for admin). Qualquer container na rede Docker `mpw` (incluindo os workers) alcança `http://control-plane:4000` sem autenticação. No modo offline (central fora, refresh < 7 dias) o guard deixa passar até sem access token.
- Files: `apps/control-plane/src/auth/guard.ts`, `apps/control-plane/src/session/store.ts`, `apps/web/app/cp/[...path]/route.ts`, `docker-compose.yml`
- Current mitigation: porta publicada só em `127.0.0.1`; checagem de `Host` (anti DNS rebinding) e de `Origin` em métodos com corpo no proxy `/cp`.
- Recommendations: segredo compartilhado web↔control-plane (header) e sessão local por navegador; rede separada para workers sem acesso ao control-plane.

**Control-plane e updater com `docker.sock`:**
- Risk: `/var/run/docker.sock` montado em `control-plane` e em `mpw-updater` equivale a root no host/VM do Docker Desktop. Qualquer RCE no control-plane (Fastify exposto na rede `mpw`) vira controle total do Docker.
- Files: `docker-compose.yml` (linha 31), `apps/control-plane/src/orchestrator/orchestrator.ts` (linhas 204-218)
- Recommendations: docker socket proxy com allowlist de endpoints; não colocar workers na mesma rede do control-plane.

**Segredos em variáveis de ambiente dos workers:**
- Risk: `POKEIDLE_PASS`, `SOLVER_KEY`, `ACCESS_TOKEN`, `REFRESH_TOKEN` e `PROXY_URL` (com credenciais do proxy) vão como env do container — visíveis em `docker inspect mpw-worker-<id>` para qualquer um com acesso ao Docker. O teste de proxy passa a URL com credenciais como argv do container `curlimages/curl` (removido depois).
- Files: `apps/control-plane/src/workers/routes.ts` (linhas 67-80), `apps/control-plane/src/proxy/routes.ts` (linhas 30-38)
- Recommendations: entregar segredos via arquivo/tmpfs ou buscar sob demanda no control-plane com token por worker.

**`/health` do worker expõe tokens do jogo sem autenticação:**
- Risk: `GET http://mpw-worker-<id>:3001/health` devolve `tokens.accessToken/refreshToken` renovados para qualquer cliente da rede `mpw` (escuta em `0.0.0.0`). Um worker pode ler os tokens de outro.
- Files: `packages/worker/src/health.ts` (linhas 50-112), `apps/control-plane/src/supervisor/supervisor.ts` (linhas 263-295)
- Recommendations: endpoint separado para tokens com segredo compartilhado, ou push do worker para o control-plane.

**Central exposta à internet sem rate limit:**
- Risk: `POST /auth/login` e `/auth/refresh` em `https://pokeidle.ayresigo.dev` não têm rate limiting nem lockout; o schema de login não limita tamanho de `username`/`password` (argon2 em senha de até ~1 MB pelo `bodyLimit` padrão) → brute force e DoS de CPU (pod com `limits.memory: 256Mi`). O Ingress Traefik não tem middleware de rate limit.
- Files: `apps/central-api/src/auth/routes.ts` (linhas 17-46), `k8s/base/ingress.yaml`, `k8s/base/central-api.yaml`
- Recommendations: `@fastify/rate-limit` ou middleware `RateLimit` do Traefik; `maxLength` nos schemas de auth; `trustProxy` para obter o IP real atrás do Traefik.

**Refresh tokens:**
- Risk: sem detecção de reuso (token já rotacionado só retorna 401, sem revogar a família); revogação de usuário/papel só vale no próximo refresh (até 15 min, documentado no README); refresh da sessão do painel fica em texto puro em `/data/session.json` no volume `mpw_mpw-data`.
- Files: `apps/central-api/src/auth/service.ts` (linhas 68-87), `apps/control-plane/src/session/store.ts` (linhas 208-216)

**Criptografia de credenciais na central:**
- Risk: AES-256-GCM sem AAD (ciphertext não amarrado a `accountId`/campo) e sem byte de versão de chave → rotação de `SECRETS_KEY` exige migração manual de todas as linhas; perder `SECRETS_KEY` torna as credenciais irrecuperáveis (o backup `pg_dump` não contém a chave). `proxyUrl` (que pode conter usuário/senha) fica em texto puro e volta em `GET /accounts`. O admin que tem `SECRETS_KEY` + banco lê as senhas do jogo de todos os amigos (modelo de confiança implícito).
- Files: `apps/central-api/src/crypto/secrets.ts`, `apps/central-api/src/accounts/routes.ts` (linhas 62-70, 160-181), `apps/central-api/prisma/schema.prisma`

**Segredos k8s e CI:**
- Current mitigation: `k8s/base/secrets.example.yaml` commitado só como exemplo; `pokeidle-secrets` criado à mão; admin dedicado `ci-release` nos secrets do GitHub; tokens mascarados com `::add-mask::` em `.github/workflows/release.yml`.
- Recommendations: o `ADMIN_PASSWORD` do seed fica para sempre no Secret/env do pod; trocar a senha pelo painel não atualiza o Secret (o seed só cria se o usuário não existir).
- Arquivos `.env` existem só como `.env.example` no repo; `.env` está no `.gitignore`.

**Risco de banimento (Termos de Uso do jogo):**
- Risk: regras oficiais proíbem automação ("Macros, auto-clickers e tools...", seção 03), trade com contas botter → ban permanente (seção 09), multi-conta acima de 4 sem autorização → deleção (seção 10). O servidor é autoritativo e pode detectar padrões inumanos [INFERENCE].
- Files: `packages/worker/GAME.md` §6, `README.md` linha 5
- Current mitigation: aviso no README; jitter de 10-30 s entre ações (`packages/worker/src/index.ts` linhas 8-9); worker não envia `cmid` (não falsifica fingerprint de máquina).

---

## Pontos de verificação manual pendentes (worker — `packages/worker/GAME.md` §9)

Todo o worker foi implementado **sem conta real**, a partir do bundle JS de `/play` e de ferramentas de terceiros. Nada abaixo foi confirmado em produção, exceto onde indicado. Qualquer fase que mexa em `packages/worker/src/auth/` ou `packages/worker/src/game/` deve começar por um smoke manual com conta real.

**Auth (§9.1) — `packages/worker/src/auth/solver.ts`, `provider.ts`, `refresh.ts`:**
- **Solver Turnstile aceito pelo jogo?** O token vem de `TurnstileTaskProxyless` no 2captcha (`DEFAULT_SOLVER_API_URL = "https://api.2captcha.com"` em `packages/worker/src/config.ts`), resolvido no IP do solver, não no proxy da conta; `fetchSolver` é `criarFetch()` sem proxy (`provider.ts` linha 354). Confirmar que `POST /api/auth/login` aceita esse `captchaToken` (o backend pode validar `remoteip` no siteverify).
- **Sitekey**: `0x4AAAAAADkKBnFEMDt0MGBM`, extraída do chunk `/_next/static/chunks/3aqjofv7-1o3x.js` por `descobrirSitekey`. Se o chunk mudar, a extração falha → usar `TURNSTILE_SITEKEY`.
- **Turnstile sempre ligado?** `TURNSTILE_ENABLED = !!sitekey` no bundle; confirmar se o backend exige `captchaToken` em todo login.
- **Refresh rotaciona o refreshToken?** O worker trata os dois casos; confirmar.
- **Validade do access token**: renovação proativa usa `exp` do JWT com 60 s de margem (piso 30 s). Se não for JWT com `exp`, só há renovação reativa via `AuthManager.invalidar()`.
- **2FA** não suportado (`twoFactor` → needs-login).

**Game loop (§9.2) — `packages/worker/src/game/client.ts`, `loop.ts`:**
- **Sessão autenticada no shard**: confirmar `field-init`/`field-kill` e que o shard calculado (88 shards, djb2 do `sub` do JWT) é o mesmo do navegador. Overrides: `GAME_WS_URL`, `GAME_WS_PATH` (padrão `/ws`), `GAME_WS_SHARDS` (padrão 88).
- **Sem `cmid` / close 4007**: o worker não envia `cmid` (fingerprint de máquina; inventar seria burlar o limite por máquina). Confirmar se o servidor aceita sessão sem `cmid` ou se responde 4007 (`machineLimited`), que hoje leva o worker a `error` sem reconexão.
- **Headers do WS**: `Origin: <GAME_URL>` + User-Agent padrão do undici. Probe com token inválido passou pela Cloudflare (101 + close 4001); confirmar com token válido.
- **Mensagens ao abrir**: `restart-state` e `balls-get` → confirmar respostas `restart-freeze` e `balls`.
- **Retomada de hunt**: confirmar `hunt-resume` e que `enter-hunt` com `resume: true` não zera progresso.
- **Hunt sem `HUNT_SLUG`**: escolha automática pode ser fraca; após 3 `enter-hunt` sem `field-init` o lastError vira `HUNT_SLUG inválido ou hunt ignorada: <slug>` (e o painel não permite configurar `HUNT_SLUG`, ver Tech Debt).
- **Drain sem `sleep-mode`**: no SIGTERM o worker para o loop, espera a ação em voo (até 20 s, `TIMEOUT_DRENAGEM_MS` em `packages/worker/src/index.ts`) e fecha o socket com 1000. O bundle tem Modo Soneca (`{type:"sleep-mode"}` → `sleep-ok` com `ghost`). Confirmar se o farm continua offline após `docker stop`; se não, enviar `sleep-mode` no drain (`drenar` em `packages/worker/src/game/loop.ts`).
- **Kills reais**: o watchdog faz leave+enter após 10 min sem kill e, após 3 recuperações sem kill, passa a tentar de hora em hora com lastError `hunt <slug> sem kills há <N>min`. Nunca foi observado um kill real — só os `field-kill` do jogo falso (`e2e/fake-game/server.ts`). Confirmar formato dos eventos e que o contador de kills/capturas sobe com conta real.
- **Códigos de close**: 4001 → refresh/needs-login comprovado contra o servidor real com token falso (2026-10-11). 4005 → needs-login, 4006/4007 → error, 4008/4009 → needs-login: confirmar em produção.
- **Compra de balls / venda de loot**: bodies conhecidos (§4.3), mas **não implementado**; falta política (qual ball, quantidade, estoque mínimo, itens vendáveis). Sem isso a conta para de capturar quando as balls acabam.

---

## Performance Bottlenecks

**Poll do supervisor sequencial e sem timeout:**
- Problem: a cada 10 s, `listWorkers()` faz 1 `inspect` por container e, em seguida, `lerHealth()` faz `fetch` sequencial a `http://mpw-worker-<id>:3001/health` sem `AbortSignal`/timeout, seguido de `PUT /accounts/:id/tokens` na central quando há tokens novos.
- Files: `apps/control-plane/src/supervisor/supervisor.ts` (linhas 155-227, 263-271), `apps/control-plane/src/orchestrator/orchestrator.ts` (linhas 110-130)
- Cause: um worker travado (socket aceito sem resposta) segura o poll inteiro (guard `emPoll`) até o timeout padrão do undici (minutos) — nenhum outro worker é supervisionado nesse intervalo.
- Improvement path: `AbortSignal.timeout()` nas chamadas de health; `Promise.all` com limite de concorrência.

**`fetch` sem timeout em todo o control-plane:**
- Problem: `SessionStore.renovar()`, `criarRepasse`, `buscarCredenciais`, `checkForUpdate` e o write-back de tokens usam `fetch` sem timeout. Como `getAccessToken()` compartilha `refreshEmAndamento`, uma central lenta bloqueia todas as rotas protegidas.
- Files: `apps/control-plane/src/session/store.ts` (linhas 148-176), `apps/control-plane/src/central/repasse.ts`, `apps/control-plane/src/workers/routes.ts`, `apps/control-plane/src/update/manager.ts`
- Improvement path: reutilizar o padrão de `packages/worker/src/http.ts` (`criarFetch` com `AbortSignal.timeout(TIMEOUT_HTTP_MS)`).

**Logs dos workers sem rotação:**
- Problem: workers são criados sem `HostConfig.LogConfig`; com o driver `json-file` padrão os logs crescem sem limite num processo 24/7.
- Files: `apps/control-plane/src/orchestrator/orchestrator.ts` (linhas 58-72)
- Improvement path: `LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } }`; também definir limites de memória/CPU por worker.

**SSE `/events` por aba:**
- Problem: cada aba aberta adiciona um listener em `supervisor.mudancas`; acima de 10 o Node emite `MaxListenersExceededWarning`.
- Files: `apps/control-plane/src/stream/routes.ts` (linhas 71-81), `apps/web/components/Dashboard.tsx` (linhas 53-78)

---

## Fragile Areas

**Rotação de refresh token do painel:**
- Files: `apps/control-plane/src/session/store.ts` (linhas 170-175, 208-216)
- Why fragile: a central rotaciona o refresh (revoga o antigo) antes de o control-plane persistir o novo; `writeFile` não é atômico (sem arquivo temporário + rename). Crash entre os dois passos ou durante a escrita → sessão perdida (o `init` descarta `session.json` corrompido) e o usuário precisa logar de novo. Enquanto isso, workers continuam rodando, mas nada que precise da central funciona.
- Safe modification: escrever em `session.json.tmp` + `rename`; nunca alterar a ordem rotação → persistência sem teste em `store.test.ts`.

**Recriação de containers via Docker API x Compose:**
- Files: `packages/updater/src/recriacao.ts`, `packages/updater/src/atualizar.ts`, `docker-compose.yml`
- Why fragile: o updater recria `web` e `control-plane` copiando `HostConfig`, redes, healthcheck e volumes implícitos do inspect e trocando só a tag da imagem. O resultado diverge do que o Compose espera (imagem `:<versão>` em vez de `:${MPW_TAG}`, hash de config do Compose obsoleto); o próximo `docker compose up -d` pode recriar tudo com a imagem local antiga — por isso o README exige `pull && up -d`. Containers `-old-<ts>` ficam para trás se a remoção falhar.
- Safe modification: manter `planejarRecriacao` coberto por `recriacao.test.ts` com fixtures de `packages/updater/src/fixtures.ts`; testar qualquer novo campo de `HostConfig`.

**Colisão de namespace entre instalação real, E2E e testes:**
- Files: `apps/control-plane/src/orchestrator/orchestrator.ts` (`LABEL_MANAGED`, nome `mpw-worker-<id>`, `NOME_UPDATER`), `e2e/docker.ts`, `e2e/docker-compose.e2e.yml`, `apps/control-plane/src/orchestrator/orchestrator.test.ts`
- Why fragile: os três usam a mesma label `mpw.managed=true` e o mesmo nome `mpw-updater`. O control-plane do E2E lista os workers da instalação real (e vice-versa); `verificarPreCondicoes()` só recusa se existir `mpw-updater`. O `/health` é resolvido por nome DNS `mpw-worker-<id>` dentro da rede do control-plane.
- Safe modification: parametrizar label/prefixo por instalação (`mpw.install=<projeto>`) antes de qualquer automação que remova containers.

**Worker em ambiente desconhecido:**
- Files: `packages/worker/src/game/client.ts` (611 linhas), `packages/worker/src/auth/provider.ts` (357 linhas)
- Why fragile: protocolo WS, códigos de close, sharding e fluxo de login foram inferidos de bundles minificados (`/_next/static/chunks/*.js`) que mudam a cada deploy do jogo; ver §9 acima. `Socks5ProxyAgent` do undici (`packages/worker/src/http.ts` linha 21) é API recente do undici 8.
- Safe modification: alterar sempre junto com `client.test.ts`/`provider.test.ts`; registrar qualquer achado novo em `packages/worker/GAME.md` com fonte.

**Next.js 16 / React 19.3 bleeding edge:**
- Files: `apps/web/package.json`, `apps/web/next.config.ts` (`cacheComponents`, `partialPrefetching`), `apps/web/AGENTS.md`
- Why fragile: `apps/web/AGENTS.md` avisa que APIs e convenções diferem do conhecido; ler `node_modules/next/dist/docs/` antes de alterar a web. O bloco do `AGENTS.md` é regenerado por `next dev`.

**Backup da central:**
- Files: `k8s/base/postgres-backup-cronjob.yaml`
- Why fragile: `pg_dump ... > arquivo && find ... -delete` — se o `pg_dump` falhar, sobra um `.sql` parcial com nome válido e nada alerta (só `failedJobsHistoryLimit`). PVC de 2Gi no mesmo cluster (sem cópia externa); nenhum procedimento de restore testado; o backup não inclui `SECRETS_KEY`.

---

## Scaling Limits

**Número de contas por PC:**
- Current capacity: 1 container Node por conta, sem limites de CPU/memória; supervisor sequencial a cada 10 s.
- Limit: o jogo limita 4 contas por jogador (regra seção 10; >4 sem autorização → deleção) e 1 sessão por conta (WS 4005). Proxy por conta é opcional.
- Scaling path: o limite real é a regra do jogo, não a infra; antes de escalar, paralelizar o poll e definir limites de recurso.

**Tabela `refresh_tokens`:**
- Current capacity: cada refresh insere uma linha nova (access de 15 min) e só marca `revokedAt` na antiga; não há limpeza de tokens expirados/revogados (`deleteMany` só existe nos testes).
- Limit: crescimento linear contínuo por painel ativo.
- Scaling path: job/rota de limpeza de `expiresAt < now()` ou `revokedAt` antigo.

**Central com 1 réplica:**
- Current capacity: `replicas: 1`, `strategy: Recreate`, `limits.memory: 256Mi`, argon2 (64 MiB por hash no `HASH_DUMMY`) no login.
- Limit: poucos logins simultâneos já pressionam a memória; downtime em cada deploy.
- Scaling path: rate limit no login; aumentar limite de memória; `RollingUpdate` quando as migrações forem compatíveis.

---

## Dependencies at Risk

**Serviço de solver (2captcha):**
- Risk: login automático depende de serviço pago de terceiro e de o jogo aceitar token gerado em outro IP (não confirmado, ver §9.1).
- Impact: sem solver funcional, toda conta cai em needs-login e exige colar `pokeweb:tokens` manualmente (fluxo do README).
- Migration plan: manter o fluxo de tokens colados como caminho principal; `SOLVER_API_URL` já é configurável.

**Bundle do jogo como "API":**
- Risk: sitekey, shards (88), paths do WS e bodies REST vêm do bundle minificado do jogo; qualquer deploy do jogo pode quebrar o worker sem aviso.
- Impact: workers em `error`/`needs-login` em massa.
- Migration plan: overrides por env (`TURNSTILE_SITEKEY`, `GAME_WS_URL`, `GAME_WS_PATH`, `GAME_WS_SHARDS`) já existem; documentar no painel.

**Versões fixas muito novas:**
- `next` 16.4.0, `react` 19.3.0, `@prisma/client`/`prisma` 7.10 (com `prisma.config.ts` e `@prisma/adapter-pg`), `undici` ^8.11, `dockerode` ^5, actions `@v7`/`@v4`. Pouca documentação/estabilidade; `@types/node` diverge (`^20` na web, `^22` no resto).

---

## Missing Critical Features

**Compra de balls / venda de loot:**
- Problem: não implementado (GAME.md §9.2).
- Blocks: farm sustentável sem intervenção humana.

**Persistência do estado desejado dos workers:**
- Problem: ver Tech Debt/Known Bugs.
- Blocks: auto-update e reboots sem intervenção manual.

**Observabilidade:**
- Problem: `Fastify()` é criado sem `logger` em `apps/central-api/src/app.ts` e `apps/control-plane/src/app.ts`, então todo `request.log.error(...)` (ex.: "falha ao descriptografar credenciais", "falha ao iniciar worker", "falha inesperada no login") é descartado e erros 500 não deixam rastro. Não há métricas nem alertas; o único log do control-plane é um `console.warn` em `session/store.ts`.
- Blocks: diagnosticar falhas em produção (central no k8s) e nas máquinas dos amigos.

**Canal beta e despublicação de release:** ver Tech Debt.

**Configuração por conta de `HUNT_SLUG` e limpeza de campos opcionais:** `PATCH /accounts/:id` não permite apagar `solverKey`/`proxyUrl`/tokens (só sobrescrever com outro valor).
- Files: `apps/central-api/src/accounts/routes.ts` (linhas 125-148)

---

## Test Coverage Gaps

**E2E fora do CI:**
- What's not tested: o smoke Playwright (`e2e/smoke.spec.ts`) só roda localmente com Docker Desktop; `.github/workflows/ci.yml` e `release.yml` não o executam, nem fazem typecheck de `e2e/`.
- Files: `.github/workflows/ci.yml`, `e2e/`
- Risk: regressões de integração web ↔ control-plane ↔ worker ↔ central chegam à release.
- Priority: High

**Componentes React sem testes:**
- What's not tested: `apps/web/components/*.tsx` (`Dashboard.tsx`, `AccountForm.tsx` 456 linhas, `UsersPanel.tsx` 458 linhas, `UpdatePanel.tsx`, `LogStream.tsx`, `AccountRow.tsx`, `UpdateBadge.tsx`) e as páginas em `apps/web/app/`. Só `apps/web/lib/*.test.ts` e `app/cp/[...path]/route.test.ts` existem.
- Risk: quebra de UI só aparece no E2E manual.
- Priority: Medium

**Bootstrap e adaptadores Docker:**
- What's not tested: `packages/worker/src/index.ts` (wiring de SIGTERM/drain/needs-login), `packages/updater/src/main.ts` e `packages/updater/src/docker.ts` (`motorDockerode`), `apps/control-plane/src/server.ts`, `apps/central-api/src/server.ts`.
- Risk: falhas de wiring/drain só aparecem em runtime.
- Priority: Medium

**Comportamento contra o jogo real:**
- What's not tested: tudo de GAME.md §9 (solver, cmid/4007, sleep-mode, kills reais, shards). Os testes usam `ws` local (`packages/worker/src/game/client.test.ts`) e o jogo falso do E2E.
- Risk: o worker pode não farmar nada em produção mesmo com todos os testes verdes.
- Priority: High

**Persistência e concorrência:**
- What's not tested: crash entre rotação e persistência do refresh do painel; reinício do control-plane com workers rodando (perda de supervisão); updater com múltiplos containers da mesma `mpw.role`.
- Files: `apps/control-plane/src/session/store.test.ts`, `apps/control-plane/src/supervisor/supervisor.test.ts`, `packages/updater/src/atualizar.test.ts`
- Priority: Medium

---

*Concerns audit: 2026-10-12*
