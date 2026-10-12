# Multiacc PokeIdle

Roda várias contas do PokeIdle no seu PC, cada uma num container próprio, controladas por um painel web local.

> **Aviso:** automatizar contas pode violar os Termos de Uso do jogo e levar a banimento. Use por sua conta e risco.

## Para quem vai usar

### Pré-requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado e aberto (no Windows, com WSL 2).
- Usuário e senha da central, fornecidos pelo admin.
- O endereço da central (`CENTRAL_API_URL`), também passado pelo admin.

As imagens ficam no GitHub Container Registry (`ghcr.io`) e são públicas: não precisa de `docker login`.

### Instalar e subir

1. Baixe este repositório (ou só os arquivos `docker-compose.yml` e `.env.example`) para uma pasta.
2. Copie `.env.example` para `.env` e preencha `CENTRAL_API_URL` com o endereço que o admin passou. O resto pode ficar como está.
3. Na pasta, rode:

   ```sh
   docker compose pull
   docker compose up -d
   ```

4. Abra http://localhost:3000 e entre com o usuário fornecido pelo admin.

O painel só escuta em `127.0.0.1`: ninguém da sua rede consegue acessá-lo, e não exponha essa porta para fora. Ele também só responde quando aberto como `localhost`, `127.0.0.1` ou `[::1]`; se você usa outro nome que aponta para o próprio PC, coloque-o em `ALLOWED_HOSTS` no `.env`.

### Cadastrar contas

Em **Dashboard → Nova conta**, preencha usuário/senha do jogo e, se tiver, o proxy (use **testar proxy** para conferir o IP de saída). Depois clique em **Iniciar** na linha da conta.

Se a conta aparecer como **precisa de login**, cole os tokens do jogo:

1. No navegador normal, entre em https://poke.idleworld.online com essa conta.
2. Aperte F12 → aba **Console**.
3. Rode `sessionStorage.getItem('pokeweb:tokens')` e copie o texto inteiro.
4. Cole no campo **JSON de pokeweb:tokens** da conta, salve e reinicie o worker.
5. Não jogue mais com essa conta naquele navegador: o jogo só aceita uma sessão por conta.

### Atualizar

- Em **Configurações** dá para ver a versão atual, clicar em **atualizar agora** e ligar/desligar a **Atualização automática**.
- Se uma atualização falhar, o erro aparece em **Configurações**. A atualização automática não tenta de novo a mesma versão; **atualizar agora** tenta.
- Manualmente: `docker compose pull && docker compose up -d`.

### Fixar ou voltar de versão (rollback)

- **Configurações → voltar para vX** devolve os workers para a versão anterior.
- Para fixar ou voltar o painel inteiro:
  1. Em **Configurações**, desligue a **Atualização automática**. Se ficar ligada, o painel volta sozinho para a versão mais nova.
  2. Coloque a versão desejada em `MPW_TAG` no `.env` (ex.: `MPW_TAG=1.2.0`).
  3. Rode `docker compose pull && docker compose up -d`.
- Para voltar a acompanhar as releases, coloque `MPW_TAG=stable`, rode `docker compose pull && docker compose up -d` e religue a **Atualização automática**.
- Depois de mudar o `.env`, use sempre `docker compose pull && docker compose up -d`. Só `docker compose up -d` pode recriar o painel a partir de uma imagem local antiga.

### Parar

- `docker compose stop` para tudo e mantém seus dados.
- Antes de um `docker compose down`, clique em **Parar** em cada conta no painel. Os containers das contas não fazem parte do compose; para removê-los de vez:

  ```sh
  # bash (Linux, macOS, WSL, Git Bash)
  docker ps -aq --filter label=mpw.managed=true | xargs -r docker rm -f
  ```

  ```powershell
  # PowerShell
  docker ps -aq --filter label=mpw.managed=true | ForEach-Object { docker rm -f $_ }
  ```

- Seus dados ficam no volume `mpw_mpw-data`. Não use `docker compose down -v`, a menos que queira perder a sessão salva.

## Para o admin: central na VPS

A central (`mpw-central-api` + Postgres) guarda usuários, contas e releases. Use o `docker-compose.central.yml` como referência:

```sh
cat > .env <<'EOF'
POSTGRES_PASSWORD=uma-senha-forte
JWT_SECRET=resultado-de-openssl-rand-hex-32
SECRETS_KEY=outro-resultado-de-openssl-rand-hex-32
ADMIN_USERNAME=admin
ADMIN_PASSWORD=outra-senha-forte
EOF
docker compose -f docker-compose.central.yml up -d
```

- `JWT_SECRET` e `SECRETS_KEY` saem de `openssl rand -hex 32` (rode uma vez para cada; os dois precisam ser diferentes). A API não sobe com `JWT_SECRET` menor que 32 caracteres.
- A cada start a imagem aplica as migrações e garante que o usuário admin exista.
- A API escuta só em `127.0.0.1:8080` na VPS (`CENTRAL_PORT` muda a porta), em HTTP. Quem expõe para a internet é um proxy reverso com HTTPS na mesma máquina, na porta 443. Exemplo mínimo de `Caddyfile` (o Caddy emite o certificado sozinho):

  ```caddyfile
  mpw.exemplo.com {
      reverse_proxy 127.0.0.1:8080
  }
  ```

  Com nginx, use um `server` com `listen 443 ssl` e `proxy_pass http://127.0.0.1:8080;`. Passe a URL HTTPS (ex.: `https://mpw.exemplo.com`) aos amigos como `CENTRAL_API_URL`.
- Guarde o `SECRETS_KEY`: sem ele as credenciais salvas não podem ser lidas.

### Cadastrar amigos

Logado no painel com o usuário admin, abra **Usuários** (o link só aparece para administradores):

- **Novo usuário**: escolha o nome (3 a 64 caracteres: letras sem acento, números, `.`, `-` ou `_`), clique em **gerar senha forte**, copie a senha (ela só aparece até você salvar) e clique em **Criar usuário**. Passe o usuário e a senha ao amigo por um canal privado.
- **desativar** bloqueia o login e revoga as sessões do amigo (o acesso já aberto expira em até 15 minutos); **ativar** libera de novo.
- **redefinir senha** troca a senha e também revoga todas as sessões abertas do usuário, com o mesmo limite de 15 minutos.
- **tornar admin / tornar usuário** muda o papel; vale a partir da próxima renovação da sessão dele (até 15 minutos). Ninguém pode desativar nem rebaixar a si mesmo, e a central recusa qualquer operação que deixaria o sistema sem nenhum admin ativo.
- A página precisa da central: em modo offline ela fica desabilitada.

Para o GitHub Actions, crie um admin só para o CI em vez de usar o seu: em **Usuários → Novo usuário**, nome `ci-release`, papel **administrador**, senha gerada. Use esse usuário e essa senha nos secrets `CENTRAL_ADMIN_USERNAME` e `CENTRAL_ADMIN_PASSWORD` (veja abaixo). Se o secret vazar, basta desativar ou redefinir a senha do `ci-release` sem afetar o seu acesso.

## Para o admin: publicar uma versão

O workflow `.github/workflows/release.yml` roda a cada tag `v*`: testa tudo, gera as 5 imagens (`mpw-web`, `mpw-control-plane`, `mpw-worker`, `mpw-updater`, `mpw-central-api`) para `linux/amd64` e `linux/arm64`, publica em `ghcr.io/ayresigo/mpw-*:<versão>`, registra a release na central e só então move a tag do canal (`:stable` ou `:beta`). PRs e pushes na `main` rodam só os testes (`.github/workflows/ci.yml`).

### Pré-requisitos (uma vez)

- O repositório no GitHub em `ayresigo/pokeidle-plus` (as imagens vão para `ghcr.io/ayresigo`).
- Em **Settings → Secrets and variables → Actions**:
  - secrets `CENTRAL_ADMIN_USERNAME` e `CENTRAL_ADMIN_PASSWORD`: o admin dedicado `ci-release` (veja [Cadastrar amigos](#cadastrar-amigos));
  - variable `CENTRAL_API_URL`: a URL HTTPS pública da central (ex.: `https://mpw.exemplo.com`).
- Depois da primeira release, torne os 5 pacotes públicos: em https://github.com/ayresigo?tab=packages abra cada `mpw-*` → **Package settings** → **Change visibility** → **Public**. Enquanto estiverem privados, os amigos não conseguem baixar as imagens.

### Publicar

```sh
git tag -a v1.0.0 -m "changelog"
git push origin v1.0.0
```

- A tag precisa ser semver com `v` na frente. `v1.0.0` vai para o canal `stable`; uma tag com pré-release (ex.: `v1.1.0-beta.1`) vai para o canal `beta` e move só a tag `:beta`.
- A versão registrada na central é a tag sem o `v` (`1.0.0`), a mesma embutida nas imagens; é ela que os painéis comparam para saber se há atualização.
- O changelog que aparece no painel é a mensagem da tag anotada. Sem mensagem (ou com tag leve), vai a lista de commits desde a tag anterior.
- Se algo falhar no meio, use **Re-run failed jobs** na aba Actions. Release que já existe na central só gera um aviso, e a tag do canal só muda depois que a central aceitou a release.

## Rodar o E2E

Smoke do fluxo completo (login → criar conta → iniciar → logs → needs-login → parar → aviso de update) num navegador de verdade, contra imagens buildadas localmente e um jogo falso. Nunca fala com o jogo real nem com o GHCR.

```sh
pnpm install
pnpm --filter e2e exec playwright install chromium   # uma vez
pnpm e2e
```

- Builda `ghcr.io/ayresigo/mpw-{web,control-plane,worker,central-api,fake-game}:e2e` (`VERSION=0.0.1-e2e`) e sobe `e2e/docker-compose.e2e.yml` como projeto `mpw-e2e` (rede `mpw-e2e`, web em `127.0.0.1:3100`, central em `:3101`, jogo falso em `:3102`). Precisa dessas portas livres e do Docker Desktop aberto.
- O jogo falso (`e2e/fake-game`) aceita só o JWT fake de `e2e/fake-game/token.ts`, manda `field-init`/`field-kill` e tem `POST /__e2e/kick`, que derruba as sessões com WS 4005.
- No fim, remove os workers que o teste criou (`mpw-worker-<id>`, pelo nome exato) e roda `docker compose -p mpw-e2e down -v`, que só apaga volumes do projeto `mpw-e2e`. Se o teste for interrompido: `pnpm --filter e2e e2e:down`.
- `E2E_SKIP_BUILD=1` reaproveita as imagens já buildadas; `E2E_KEEP=1` deixa o ambiente de pé para depurar.
- Recusa rodar se existir um container `mpw-updater` (de uma instalação real), porque o control-plane do teste o inspecionaria. Não rode com a instalação real (`mpw`) com workers ativos: os dois control-planes enxergam os containers com label `mpw.managed=true`.
- As imagens `:e2e` ficam como cache. Para removê-las, pela tag exata:

```sh
docker image rm ghcr.io/ayresigo/mpw-web:e2e ghcr.io/ayresigo/mpw-control-plane:e2e ghcr.io/ayresigo/mpw-worker:e2e ghcr.io/ayresigo/mpw-central-api:e2e ghcr.io/ayresigo/mpw-fake-game:e2e
```
