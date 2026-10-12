import { criarAuthManager, type AuthManager, type ResultadoAuth } from "./auth/provider.js";
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

function registrarEncerramento(server: HealthServer, auth: AuthManager, accountId: string): void {
  let encerrando = false;
  const encerrar = (sinal: NodeJS.Signals) => {
    if (encerrando) return;
    encerrando = true;
    console.log(`worker ${accountId}: ${sinal} recebido, encerrando`);
    auth.parar();
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
const server = await startHealthServer(health, config.healthPort);
console.log(`worker ${config.accountId}: health em :${server.port} (state ${health.snapshot().state})`);

const auth = criarAuthManager(config, health);
registrarEncerramento(server, auth, config.accountId);

const resultado = await auth.autenticar();
console.log(`worker ${config.accountId}: ${descreverResultado(resultado)}`);
