import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

export const RAIZ = path.resolve(import.meta.dirname, "..");
export const PROJETO = "mpw-e2e";
export const ARQUIVO_COMPOSE = path.join(import.meta.dirname, "docker-compose.e2e.yml");
export const VERSAO_E2E = "0.0.1-e2e";
export const CONTAINER_CONTROL_PLANE = "mpw-e2e-control-plane";
export const NOME_UPDATER = "mpw-updater";

const DIR_ESTADO = path.join(import.meta.dirname, ".estado");
const ARQUIVO_WORKERS = path.join(DIR_ESTADO, "workers.txt");
const REGEX_ACCOUNT_ID = /^[A-Za-z0-9_-]+$/;

interface Imagem {
  nome: string;
  dockerfile: string;
}

const IMAGENS: Imagem[] = [
  { nome: "web", dockerfile: "docker/Dockerfile.web" },
  { nome: "control-plane", dockerfile: "docker/Dockerfile.control-plane" },
  { nome: "worker", dockerfile: "docker/Dockerfile.worker" },
  { nome: "central-api", dockerfile: "docker/Dockerfile.central-api" },
  { nome: "fake-game", dockerfile: "e2e/fake-game/Dockerfile" },
];

export const tagDaImagem = (nome: string): string => `ghcr.io/ayresigo/mpw-${nome}:e2e`;
export const TAGS_E2E = IMAGENS.map((imagem) => tagDaImagem(imagem.nome));
export const nomeDoWorker = (accountId: string): string => `mpw-worker-${accountId}`;

export interface Resultado {
  status: number;
  saida: string;
}

export function docker(args: string[], opcoes: { silencioso?: boolean } = {}): Resultado {
  const r = spawnSync("docker", args, { cwd: RAIZ, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const saida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.error) throw r.error;
  if (!opcoes.silencioso && r.status !== 0) {
    throw new Error(`docker ${args.join(" ")} falhou (${r.status}):\n${saida}`);
  }
  return { status: r.status ?? 1, saida };
}

export function compose(args: string[], opcoes: { silencioso?: boolean } = {}): Resultado {
  return docker(["compose", "-p", PROJETO, "-f", ARQUIVO_COMPOSE, ...args], opcoes);
}

function construir(imagem: Imagem): Promise<void> {
  const args = [
    "build",
    "-f",
    imagem.dockerfile,
    "-t",
    tagDaImagem(imagem.nome),
    "--build-arg",
    `VERSION=${VERSAO_E2E}`,
    ".",
  ];
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const filho = spawn("docker", args, { cwd: RAIZ });
  let saida = "";
  filho.stdout.on("data", (parte: Buffer) => (saida += parte.toString()));
  filho.stderr.on("data", (parte: Buffer) => (saida += parte.toString()));
  filho.on("error", reject);
  filho.on("close", (codigo) => {
    if (codigo === 0) resolve();
    else reject(new Error(`build de ${tagDaImagem(imagem.nome)} falhou (${codigo}):\n${saida.slice(-4000)}`));
  });
  return promise;
}

export async function construirImagens(): Promise<void> {
  await Promise.all(IMAGENS.map(construir));
}

export function containerExiste(nome: string): boolean {
  return docker(["container", "inspect", nome], { silencioso: true }).status === 0;
}

export function saudeDoContainer(nome: string): string {
  const r = docker(["container", "inspect", "-f", "{{.State.Health.Status}}", nome], { silencioso: true });
  return r.status === 0 ? r.saida.trim() : "inexistente";
}

export function registrarWorker(accountId: string): void {
  if (!REGEX_ACCOUNT_ID.test(accountId)) throw new Error(`accountId inesperado: ${accountId}`);
  mkdirSync(DIR_ESTADO, { recursive: true });
  appendFileSync(ARQUIVO_WORKERS, `${accountId}\n`);
}

function workersRegistrados(): string[] {
  if (!existsSync(ARQUIVO_WORKERS)) return [];
  return readFileSync(ARQUIVO_WORKERS, "utf8")
    .split("\n")
    .map((linha) => linha.trim())
    .filter((linha) => REGEX_ACCOUNT_ID.test(linha));
}

export function verificarPreCondicoes(): void {
  if (containerExiste(NOME_UPDATER)) {
    throw new Error(
      `existe um container "${NOME_UPDATER}" (de uma instalação real); o control-plane do E2E o inspecionaria/removeria. Rode o E2E sem ele.`,
    );
  }
}

export function derrubarAmbiente(): string[] {
  const removidos: string[] = [];
  for (const accountId of workersRegistrados()) {
    const nome = nomeDoWorker(accountId);
    if (!containerExiste(nome)) continue;
    docker(["container", "rm", "-f", nome]);
    removidos.push(nome);
  }
  compose(["down", "-v", "--remove-orphans"]);
  rmSync(ARQUIVO_WORKERS, { force: true });
  return removidos;
}
