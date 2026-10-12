import type { UpdateState, UpdateStatus } from "./api";

export const TEXTO_ESTADO: Record<UpdateState, string> = {
  idle: "pronto",
  checking: "verificando atualizações",
  updating: "atualizando",
  update_failed: "falha na última atualização",
  rolling_back: "voltando para a versão anterior",
};

export interface Disponibilidade {
  habilitado: boolean;
  motivo: string | null;
}

export interface AcoesUpdate {
  aplicar: Disponibilidade;
  rollback: Disponibilidade;
  autoUpdate: Disponibilidade;
}

const OCUPADO: Record<UpdateState, boolean> = {
  idle: false,
  checking: true,
  updating: true,
  update_failed: false,
  rolling_back: true,
};

export function emAndamento(status: UpdateStatus): boolean {
  return status.state === "updating" || status.state === "rolling_back";
}

function disponibilidade(motivo: string | null): Disponibilidade {
  return { habilitado: motivo === null, motivo };
}

export function acoesUpdate(status: UpdateStatus, offline: boolean): AcoesUpdate {
  const ocupado = OCUPADO[status.state] ? "aguarde a operação em andamento" : null;
  const semCentral = offline ? "indisponível em modo offline" : null;
  return {
    aplicar: disponibilidade(
      ocupado ?? semCentral ?? (status.updateAvailable ? null : "nenhuma atualização disponível"),
    ),
    rollback: disponibilidade(ocupado ?? (status.rollbackDisponivel ? null : "nenhuma versão anterior registrada")),
    autoUpdate: disponibilidade(ocupado ?? semCentral),
  };
}

export type OperacaoUpdate = "apply" | "rollback" | "settings";

const MENSAGENS_ERRO: Record<OperacaoUpdate, Record<number, string>> = {
  apply: {
    400: "nenhuma atualização disponível para aplicar",
    409: "já existe uma atualização ou rollback em andamento",
    502: "a atualização falhou; veja o erro acima",
    503: "o servidor central está inalcançável; tente quando a conexão voltar",
  },
  rollback: {
    404: "não há versão anterior registrada para voltar",
    409: "já existe uma atualização ou rollback em andamento",
    502: "o rollback falhou; veja o erro acima",
  },
  settings: {
    400: "valor inválido para atualização automática",
    503: "o servidor central está inalcançável; tente quando a conexão voltar",
  },
};

export function mensagemErroUpdate(operacao: OperacaoUpdate, status: number, mensagem: string): string {
  return MENSAGENS_ERRO[operacao][status] ?? `falha inesperada (${status}): ${mensagem}`;
}
