import { criarAuthManager, type ResultadoAuth } from "./auth/provider.js";
import { loadConfig, type WorkerConfig } from "./config.js";
import { criarGameClient, type GameClient } from "./game/client.js";
import { criarAcoes, drenar, runGameLoop, type GameLoop } from "./game/loop.js";
import { HealthState, startHealthServer, type HealthServer } from "./health.js";

const TIMEOUT_DRENAGEM_MS = 20_000;
const ATRASO_MIN_ACAO_MS = 10_000;
const ATRASO_MAX_ACAO_MS = 30_000;

function carregarConfig(): WorkerConfig {
  try {
    return loadConfig(process.env);
  } catch (erro) {
    console.error(erro instanceof Error ? erro.message : String(erro));
    process.exit(1);
  }
}

function descreverResultado(resultado: ResultadoAuth): string {
  if (resultado.ok) return `autenticado via ${resultado.origem}`;
  return resultado.needsLogin
    ? `needs-login (${resultado.motivo})`
    : `autenticação adiada (${resultado.motivo})`;
}

const config = carregarConfig();
const health = new HealthState(
  config.accessToken && config.refreshToken
    ? { accessToken: config.accessToken, refreshToken: config.refreshToken }
    : null,
);
const auth = criarAuthManager(config, health);
let server: HealthServer | null = null;
let client: GameClient | null = null;
let loop: GameLoop | null = null;
let encerrando = false;

const encerrar = (sinal: NodeJS.Signals) => {
  if (encerrando) return;
  encerrando = true;
  console.log(`worker ${config.accountId}: ${sinal} recebido, drenando`);
  drenar({ loop, client, auth, server, timeoutMs: TIMEOUT_DRENAGEM_MS }).then(
    ({ acaoConcluida }) => {
      if (!acaoConcluida) {
        console.log(
          `worker ${config.accountId}: ação em andamento não terminou em ${TIMEOUT_DRENAGEM_MS / 1000}s`,
        );
      }
      process.exit(0);
    },
    (erro: unknown) => {
      console.error(erro);
      process.exit(1);
    },
  );
};
process.once("SIGTERM", encerrar);
process.once("SIGINT", encerrar);

server = await startHealthServer(health, config.healthPort);
console.log(
  `worker ${config.accountId}: health em :${server.port} (state ${health.snapshot().state})`,
);

const resultado = await auth.autenticar();
console.log(`worker ${config.accountId}: ${descreverResultado(resultado)}`);

if (!encerrando && (resultado.ok || !resultado.needsLogin)) {
  const jogo = criarGameClient(config, auth, health);
  const rodando = runGameLoop(jogo, criarAcoes({ huntSlug: config.huntSlug, health }), {
    minDelayMs: ATRASO_MIN_ACAO_MS,
    maxDelayMs: ATRASO_MAX_ACAO_MS,
    health,
  });
  client = jogo;
  loop = rodando;
  jogo.conectar();

  void jogo.encerrado.then((motivo) => {
    if (encerrando || motivo.estado === "desconectado") return;
    console.log(`worker ${config.accountId}: jogo encerrado (${motivo.estado}): ${motivo.motivo}`);
    void rodando.parar(TIMEOUT_DRENAGEM_MS);
    auth.parar();
  });

  rodando.concluido.catch((erro: unknown) => {
    if (encerrando) return;
    encerrando = true;
    console.error(
      `worker ${config.accountId}: game loop abortado: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
    void jogo.desconectar().finally(() => {
      auth.parar();
      process.exit(1);
    });
  });
}
