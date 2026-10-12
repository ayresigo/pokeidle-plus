FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --prod --filter e2e
COPY e2e/fake-game e2e/fake-game
WORKDIR /app/e2e
ENV NODE_ENV=production PORT=8090
EXPOSE 8090
CMD ["node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "fake-game/server.ts"]
