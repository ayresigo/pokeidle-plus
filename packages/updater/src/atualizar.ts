import type Docker from "dockerode";
import {
  nomeDoContainer,
  planejarRecriacao,
  repositorioDaImagem,
  type PlanoRecriacao,
} from "./recriacao.js";

export const LABEL_ROLE = "mpw.role";
export const ROLES_ALVO = ["control-plane", "web"] as const;

export interface ContainerListado {
  id: string;
  nome: string;
}

export interface MotorDocker {
  listarPorRole(role: string): Promise<ContainerListado[]>;
  inspecionarContainer(id: string): Promise<Docker.ContainerInspectInfo>;
  inspecionarImagem(ref: string): Promise<Docker.ImageInspectInfo | null>;
  baixarImagem(ref: string): Promise<void>;
  parar(id: string, timeoutSegundos: number): Promise<void>;
  renomear(id: string, nome: string): Promise<void>;
  criar(opcoes: Docker.ContainerCreateOptions): Promise<string>;
  conectar(rede: string, id: string, endpoint: Docker.EndpointSettings): Promise<void>;
  iniciar(id: string): Promise<void>;
  remover(id: string): Promise<void>;
}

export interface OpcoesAtualizacao {
  motor: MotorDocker;
  targetTag: string;
  log?: (mensagem: string) => void;
  dormir?: (ms: number) => Promise<void>;
  agora?: () => number;
  timeoutSaudeMs?: number;
  estabilidadeMs?: number;
  intervaloMs?: number;
}

interface AlvoPreparado {
  role: string;
  id: string;
  novaImagem: string;
  plano: PlanoRecriacao;
}

const STOP_TIMEOUT_SEGUNDOS = 30;
const TIMEOUT_SAUDE_PADRAO_MS = 90_000;
const ESTABILIDADE_PADRAO_MS = 10_000;
const INTERVALO_PADRAO_MS = 1_000;
const SUFIXO_ANTIGO = /-old-\d+$/;

function mensagemDeErro(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function atualizar(opts: OpcoesAtualizacao): Promise<void> {
  const { motor, targetTag } = opts;
  const log = opts.log ?? ((mensagem: string) => console.log(`[updater] ${mensagem}`));

  const alvos: AlvoPreparado[] = [];
  for (const role of ROLES_ALVO) {
    const candidatos = (await motor.listarPorRole(role)).filter(
      (container) => !SUFIXO_ANTIGO.test(container.nome),
    );
    if (candidatos.length === 0) {
      log(`nenhum container com ${LABEL_ROLE}=${role}; pulando`);
      continue;
    }
    if (candidatos.length > 1) {
      log(`${candidatos.length} containers com ${LABEL_ROLE}=${role}; usando ${candidatos[0].nome}`);
    }
    const inspect = await motor.inspecionarContainer(candidatos[0].id);
    const novaImagem = `${repositorioDaImagem(inspect.Config.Image)}:${targetTag}`;
    try {
      await motor.baixarImagem(novaImagem);
      log(`imagem ${novaImagem} baixada`);
    } catch (err) {
      if ((await motor.inspecionarImagem(novaImagem)) === null) {
        throw new Error(
          `pull de ${novaImagem} falhou e a imagem não existe localmente: ${mensagemDeErro(err)}`,
        );
      }
      log(`pull de ${novaImagem} falhou (${mensagemDeErro(err)}); usando a imagem local`);
    }
    const imagemAntiga = await motor.inspecionarImagem(inspect.Image);
    alvos.push({
      role,
      id: inspect.Id,
      novaImagem,
      plano: planejarRecriacao(inspect, imagemAntiga?.Config ?? {}, novaImagem),
    });
  }

  for (const alvo of alvos) {
    await recriar(alvo, opts, log);
  }
  log(alvos.length > 0 ? `atualização para ${targetTag} concluída` : "nada a atualizar");
}

async function recriar(
  { role, id, novaImagem, plano }: AlvoPreparado,
  opts: OpcoesAtualizacao,
  log: (mensagem: string) => void,
): Promise<void> {
  const { motor } = opts;
  const agora = opts.agora ?? Date.now;
  const nomeAntigo = `${plano.nome}-old-${agora()}`;

  log(`${role}: parando ${plano.nome}`);
  await motor.parar(id, STOP_TIMEOUT_SEGUNDOS);
  let renomeado = false;
  let novoId: string | null = null;
  try {
    await motor.renomear(id, nomeAntigo);
    renomeado = true;
    novoId = await motor.criar(plano.criar);
    for (const { rede, endpoint } of plano.redesExtras) {
      await motor.conectar(rede, novoId, endpoint);
    }
    await motor.iniciar(novoId);
    await aguardarSaudavel(novoId, opts);
  } catch (err) {
    log(`${role}: falhou (${mensagemDeErro(err)}); restaurando versão anterior`);
    const falhasRollback: string[] = [];
    if (novoId !== null) {
      await motor.remover(novoId).catch((e) => falhasRollback.push(`remover novo: ${mensagemDeErro(e)}`));
    }
    if (renomeado) {
      await motor
        .renomear(id, plano.nome)
        .catch((e) => falhasRollback.push(`renomear antigo: ${mensagemDeErro(e)}`));
    }
    await motor.iniciar(id).catch((e) => falhasRollback.push(`iniciar antigo: ${mensagemDeErro(e)}`));
    const sufixo = falhasRollback.length > 0 ? `; rollback incompleto: ${falhasRollback.join("; ")}` : "";
    throw new Error(`falha ao atualizar ${role} para ${novaImagem}: ${mensagemDeErro(err)}${sufixo}`);
  }

  try {
    await motor.remover(id);
  } catch (err) {
    log(`${role}: atualizado, mas não consegui remover ${nomeAntigo}: ${mensagemDeErro(err)}`);
    return;
  }
  log(`${role}: atualizado para ${novaImagem}`);
}

async function aguardarSaudavel(id: string, opts: OpcoesAtualizacao): Promise<void> {
  const { motor } = opts;
  const agora = opts.agora ?? Date.now;
  const dormir =
    opts.dormir ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = opts.timeoutSaudeMs ?? TIMEOUT_SAUDE_PADRAO_MS;
  const estabilidadeMs = opts.estabilidadeMs ?? ESTABILIDADE_PADRAO_MS;
  const intervaloMs = opts.intervaloMs ?? INTERVALO_PADRAO_MS;
  const inicio = agora();
  let rodandoDesde: number | null = null;

  for (;;) {
    const { State, RestartCount } = await motor.inspecionarContainer(id);
    if (!State.Running) {
      throw new Error(`container parou (status ${State.Status}, exit ${State.ExitCode})`);
    }
    if (RestartCount > 0) throw new Error(`container reiniciou ${RestartCount}x`);
    const saude = State.Health?.Status;
    if (saude === "healthy") return;
    if (saude === "unhealthy") throw new Error("container ficou unhealthy");
    if (saude === undefined || saude === "none") {
      rodandoDesde ??= agora();
      if (agora() - rodandoDesde >= estabilidadeMs) return;
    }
    if (agora() - inicio >= timeoutMs) {
      throw new Error(`container não ficou saudável em ${timeoutMs}ms`);
    }
    await dormir(intervaloMs);
  }
}
