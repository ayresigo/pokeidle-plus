import type { HealthState } from "../health.js";
import type { ClienteJogo } from "./client.js";

export interface Acao<C> {
  nome: string;
  executar(client: C): Promise<string | void>;
}

export interface OpcoesLoop {
  minDelayMs: number;
  maxDelayMs: number;
  health: HealthState;
  random?: () => number;
  maxErrosConsecutivos?: number;
}

export interface GameLoop {
  readonly concluido: Promise<void>;
  parar(timeoutMs: number): Promise<boolean>;
}

const MAX_ERROS_CONSECUTIVOS = 5;
const STALL_MS = 10 * 60_000;
const STALL_ESPACADO_MS = 60 * 60_000;
const MAX_RECUPERACOES_RAPIDAS = 3;
const PRAZO_CAMPO_INIT_MS = 10_000;
const MAX_ENTRADAS_SEM_CAMPO_INIT = 3;

export function atrasoComJitter(
  minMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  return minMs + Math.floor(random() * (maxMs - minMs + 1));
}

export interface OpcoesAcoes {
  huntSlug: string | undefined;
  health: HealthState;
}

export function criarAcoes(opcoes: OpcoesAcoes): Acao<ClienteJogo>[] {
  let entradasSemCampoInit = 0;
  let recuperacoes = 0;
  let ultimaRecuperacaoEm = 0;
  let semKillDesde = 0;

  const garantirHunt: Acao<ClienteJogo> = {
    nome: "garantir-hunt",
    async executar(client) {
      const estado = client.estado;
      if (!client.conectado) return "aguardando conexão";
      if (estado.huntAtual) {
        entradasSemCampoInit = 0;
        return `em hunt ${estado.huntAtual}`;
      }
      if (!opcoes.huntSlug) {
        opcoes.health.setLastError("HUNT_SLUG ausente; defina HUNT_SLUG para o worker caçar");
        return "idle: sem hunt configurada";
      }
      const agora = Date.now();
      if (
        estado.huntSelectEnviadoEm !== null &&
        agora - estado.huntSelectEnviadoEm < PRAZO_CAMPO_INIT_MS
      ) {
        return "aguardando campo.init";
      }
      client.selecionarHunt(opcoes.huntSlug);
      entradasSemCampoInit += 1;
      if (entradasSemCampoInit >= MAX_ENTRADAS_SEM_CAMPO_INIT) {
        opcoes.health.setLastError(`HUNT_SLUG inválido ou hunt ignorada: ${opcoes.huntSlug}`);
      }
      return `hunt.select ${opcoes.huntSlug}`;
    },
  };

  const watchdogStall: Acao<ClienteJogo> = {
    nome: "watchdog-stall",
    async executar(client) {
      const { huntAtual, ultimoKillEm, huntDesde, conectadoEm } = client.estado;
      if (!client.conectado || !huntAtual) return "sem hunt ativa";
      if (ultimoKillEm !== null && ultimoKillEm > ultimaRecuperacaoEm) recuperacoes = 0;
      const agora = Date.now();
      const referencia = Math.max(
        ultimoKillEm ?? 0,
        huntDesde ?? 0,
        conectadoEm ?? 0,
        ultimaRecuperacaoEm,
      );
      const limiar = recuperacoes >= MAX_RECUPERACOES_RAPIDAS ? STALL_ESPACADO_MS : STALL_MS;
      if (agora - referencia < limiar) return `hunt ${huntAtual} ativa`;
      if (recuperacoes === 0) semKillDesde = referencia;
      recuperacoes += 1;
      ultimaRecuperacaoEm = agora;
      client.selecionarHunt(huntAtual);
      if (recuperacoes >= MAX_RECUPERACOES_RAPIDAS) {
        const minutos = Math.round((agora - semKillDesde) / 60_000);
        opcoes.health.setLastError(`hunt ${huntAtual} sem kills há ${minutos}min`);
      }
      return `stall em ${huntAtual}: hunt.select`;
    },
  };

  return [garantirHunt, watchdogStall];
}

export function runGameLoop<C>(client: C, acoes: readonly Acao<C>[], opcoes: OpcoesLoop): GameLoop {
  const maxErros = opcoes.maxErrosConsecutivos ?? MAX_ERROS_CONSECUTIVOS;
  let parando = false;
  let acordar: (() => void) | null = null;
  let emVoo: Promise<unknown> | null = null;

  const dormir = (ms: number) => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const timer = setTimeout(resolve, ms);
    acordar = () => {
      clearTimeout(timer);
      resolve();
    };
    return promise.finally(() => {
      acordar = null;
    });
  };

  const executar = async () => {
    let indice = 0;
    let erros = 0;
    while (!parando) {
      await dormir(atrasoComJitter(opcoes.minDelayMs, opcoes.maxDelayMs, opcoes.random));
      if (parando || acoes.length === 0) continue;
      const acao = acoes[indice % acoes.length]!;
      indice += 1;
      const execucao = acao.executar(client);
      emVoo = execucao;
      try {
        const resultado = await execucao;
        erros = 0;
        opcoes.health.setLastAction(resultado ? `${acao.nome}: ${resultado}` : acao.nome);
      } catch (erro) {
        erros += 1;
        const texto = `${acao.nome}: ${erro instanceof Error ? erro.message : String(erro)}`;
        opcoes.health.setLastError(texto);
        if (erros >= maxErros) throw new Error(`${maxErros} erros consecutivos; último: ${texto}`);
      } finally {
        emVoo = null;
      }
    }
  };

  const concluido = executar();
  concluido.catch(() => {});

  return {
    concluido,
    async parar(timeoutMs) {
      parando = true;
      acordar?.();
      const atual = emVoo;
      if (!atual) return true;
      const { promise: prazo, resolve } = Promise.withResolvers<boolean>();
      const timer = setTimeout(() => resolve(false), timeoutMs);
      const terminou = atual.then(
        () => true,
        () => true,
      );
      try {
        return await Promise.race([terminou, prazo]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export interface AlvosDrenagem {
  loop: GameLoop | null;
  client: { desconectar(): Promise<void> } | null;
  auth: { parar(): void };
  server: { close(): Promise<void> } | null;
  timeoutMs: number;
}

export async function drenar(alvos: AlvosDrenagem): Promise<{ acaoConcluida: boolean }> {
  const acaoConcluida = alvos.loop ? await alvos.loop.parar(alvos.timeoutMs) : true;
  await alvos.client?.desconectar();
  alvos.auth.parar();
  await alvos.server?.close();
  return { acaoConcluida };
}
