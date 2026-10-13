import type { FastifyInstance } from "fastify";

const REPO_URL = "https://github.com/ayresigo/pokeidle-plus";

const PAGINA = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="index,follow" />
<title>PokeIdle Plus</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; line-height: 1.6; max-width: 46rem; margin: 2.5rem auto; padding: 0 1.25rem; }
  h1 { margin-bottom: 0.25rem; }
  .lead { font-size: 1.1rem; }
  .aviso { border-left: 4px solid #d98100; padding: 0.5rem 0.9rem; margin: 1.25rem 0; background: rgba(217, 129, 0, 0.08); }
  code { background: rgba(127, 127, 127, 0.18); padding: 0.1rem 0.35rem; border-radius: 4px; }
  pre { background: rgba(127, 127, 127, 0.14); padding: 0.9rem 1rem; border-radius: 6px; overflow-x: auto; }
  ol { padding-left: 1.3rem; }
  footer { margin-top: 2.5rem; font-size: 0.9rem; opacity: 0.8; }
  a { color: #2f6fed; }
</style>
</head>
<body>
<h1>PokeIdle Plus</h1>
<p class="lead">Rode várias contas do <a href="https://pokeidle.io" rel="noopener">pokeidle.io</a> no seu PC, cada uma em um container próprio, controladas por um painel web local. Esta é apenas a central de contas e releases do projeto.</p>

<div class="aviso">
  <strong>Aviso:</strong> automatizar contas pode violar os Termos de Uso do jogo e levar a banimento. Use por sua conta e risco.
</div>

<h2>Como começar</h2>
<ol>
  <li>Tenha o <strong>Docker Desktop</strong> instalado e aberto (no Windows, com WSL 2).</li>
  <li>Baixe os arquivos <code>docker-compose.yml</code> e <code>.env.example</code> do repositório para uma pasta.</li>
  <li>Copie <code>.env.example</code> para <code>.env</code> (não precisa mudar nada).</li>
  <li>Na pasta, rode:
    <pre>docker compose pull
docker compose up -d</pre>
  </li>
  <li>Abra <code>http://localhost:3000</code> e entre com o usuário fornecido pelo admin.</li>
</ol>

<p>O passo a passo completo (cadastrar contas, colar tokens do jogo, atualizar e fazer rollback) está no README do projeto.</p>

<p><a href="${REPO_URL}#readme" rel="noopener">Documentação e código no GitHub →</a></p>

<footer>
  PokeIdle Plus · projeto open source · <a href="${REPO_URL}" rel="noopener">${REPO_URL}</a>
</footer>
</body>
</html>
`;

export function registerRootRoute(app: FastifyInstance): void {
  app.get("/", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(PAGINA);
  });
}
