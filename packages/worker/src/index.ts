import { loadConfig, type WorkerConfig } from "./config.js";
import { HealthState, startHealthServer, type HealthServer } from "./health.js";

function carregarConfig(): WorkerConfig {
  try {
    return loadConfig(process.env);
  } catch (erro) {
    console.error(erro instanceof Error ? erro.message : String(erro));
    process.exit(1);
  }
}

function registrarEncerramento(server: HealthServer, accountId: string): void {
  let encerrando = false;
  const encerrar = (sinal: NodeJS.Signals) => {
    if (encerrando) return;
    encerrando = true;
    console.log(`worker ${accountId}: ${sinal} recebido, encerrando`);
    server.close().then(
      () => process.exit(0),
      (erro: unknown) => {
        console.error(erro);
        process.exit(1);
      },
    );
  };
  process.once("SIGTERM", encerrar);
  process.once("SIGINT", encerrar);
}

const config = carregarConfig();
const health = new HealthState(
  config.accessToken && config.refreshToken
    ? { accessToken: config.accessToken, refreshToken: config.refreshToken }
    : null,
);
const server = await startHealthServer(health, config.healthPort);
console.log(`worker ${config.accountId}: health em :${server.port} (state ${health.snapshot().state})`);

registrarEncerramento(server, config.accountId);
