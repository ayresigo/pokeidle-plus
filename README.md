# Multiacc PokeIdle

Roda várias contas do PokeIdle no seu PC, cada uma num container próprio, controladas por um painel web local.

> **Aviso:** automatizar contas pode violar os Termos de Uso do jogo e levar a banimento. Use por sua conta e risco.

## Para quem vai usar

### Pré-requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado e aberto (no Windows, com WSL 2).
- Usuário e senha da central, fornecidos pelo admin.
- O endereço da central (`CENTRAL_API_URL`), também passado pelo admin.

### Instalar e subir

1. Baixe este repositório (ou só os arquivos `docker-compose.yml` e `.env.example`) para uma pasta.
2. Copie `.env.example` para `.env` e preencha `CENTRAL_API_URL` com o endereço que o admin passou. O resto pode ficar como está.
3. Na pasta, rode:

   ```sh
   docker compose up -d
   ```

4. Abra http://localhost:3000 e entre com o usuário fornecido pelo admin.

O painel só escuta em `127.0.0.1`: ninguém da sua rede consegue acessá-lo, e não exponha essa porta para fora.

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
- Manualmente: `docker compose pull && docker compose up -d`.

### Voltar de versão (rollback)

- **Configurações → voltar para vX** devolve os workers para a versão anterior.
- Para voltar o painel inteiro, coloque a versão desejada em `MPW_TAG` no `.env` (ex.: `MPW_TAG=1.2.0`) e rode `docker compose up -d`. Volte para `MPW_TAG=stable` depois.

### Parar

- `docker compose stop` para tudo e mantém seus dados.
- Antes de um `docker compose down`, pare os workers pelo painel; se algum ficar para trás, remova com `docker rm -f $(docker ps -aq --filter label=mpw.managed=true)`.
- Seus dados ficam no volume `mpw_mpw-data`. Não use `docker compose down -v`, a menos que queira perder a sessão salva.

## Para o admin: central na VPS

A central (`mpw-central-api` + Postgres) guarda usuários, contas e releases. Use o `docker-compose.central.yml` como referência:

```sh
cat > .env <<'EOF'
POSTGRES_PASSWORD=uma-senha-forte
JWT_SECRET=um-segredo-longo-e-aleatorio
SECRETS_KEY=resultado-de-openssl-rand-hex-32
ADMIN_USERNAME=admin
ADMIN_PASSWORD=outra-senha-forte
EOF
docker compose -f docker-compose.central.yml up -d
```

- A cada start a imagem aplica as migrações e garante que o usuário admin exista.
- A API escuta na porta 8080 (`CENTRAL_PORT` muda a porta publicada). Coloque um proxy reverso com HTTPS na frente e passe essa URL aos amigos como `CENTRAL_API_URL`.
- Guarde o `SECRETS_KEY`: sem ele as credenciais salvas não podem ser lidas.
- Ainda não existe tela/rota para criar usuários. Por enquanto, crie cada amigo com o seed e rebaixe o papel para `user`:

  ```sh
  docker compose -f docker-compose.central.yml exec -e ADMIN_USERNAME=amigo -e ADMIN_PASSWORD=senha central-api pnpm db:seed
  docker compose -f docker-compose.central.yml exec db psql -U mpw -d mpw -c "UPDATE users SET role = 'user' WHERE username = 'amigo';"
  ```
