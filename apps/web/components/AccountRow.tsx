"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import {
  badgeDoStatus,
  erroDoWorker,
  estaRodando,
  formatarUptime,
  type LinhaConta,
  type TomBadge,
} from "@/lib/status";

type Acao = "start" | "stop" | "restart";

const CLASSE_TOM: Record<TomBadge, string> = {
  vermelho: "bg-red-100 text-red-800 ring-red-300",
  laranja: "bg-orange-100 text-orange-800 ring-orange-300",
  verde: "bg-green-100 text-green-800 ring-green-300",
  azul: "bg-blue-100 text-blue-800 ring-blue-300",
  cinza: "bg-slate-100 text-slate-700 ring-slate-300",
};

const TITULO_OFFLINE = "indisponível em modo offline";

const ESPERA_SNAPSHOT_MS = 20_000;

interface Esperado {
  rodando: boolean;
  desde: number;
}

const BOTAO =
  "rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50";

interface AccountRowProps {
  linha: LinhaConta;
  agora: number;
  offline: boolean;
  onLogs: (accountId: string) => void;
}

export function AccountRow({ linha, agora, offline, onLogs }: AccountRowProps) {
  const { accountId, account, worker } = linha;
  const [pendente, setPendente] = useState<Acao | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [esperado, setEsperado] = useState<Esperado | null>(null);

  const badge = badgeDoStatus(worker);
  const rodando = estaRodando(worker);
  const erro = erroDoWorker(worker);
  const precisaLogin = worker?.jogo?.state === "needs-login";
  const aguardando =
    esperado !== null && esperado.rodando !== rodando && agora - esperado.desde < ESPERA_SNAPSHOT_MS;
  const ocupado = pendente !== null || aguardando;

  async function executar(acao: Acao) {
    setPendente(acao);
    setErroAcao(null);
    try {
      await apiFetch(`/workers/${encodeURIComponent(accountId)}/${acao}`, { method: "POST" });
      setEsperado({ rodando: acao !== "stop", desde: Date.now() });
    } catch (falha) {
      setErroAcao(falha instanceof ApiError ? falha.message : "control-plane inalcançável");
    } finally {
      setPendente(null);
    }
  }

  return (
    <tr className="border-t border-slate-200 align-top">
      <td className="px-3 py-2">
        <div className="font-medium">{account?.label ?? accountId}</div>
        <div className="text-xs text-slate-500">{account?.pokeidleUser ?? "sem dados da conta"}</div>
      </td>
      <td className="px-3 py-2">
        <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${CLASSE_TOM[badge.tom]}`}>
          {badge.texto}
        </span>
        {precisaLogin && account && (
          <Link
            href={`/accounts/${account.id}#tokens`}
            className="mt-1 block w-fit rounded bg-orange-500 px-2 py-0.5 text-xs font-medium text-white hover:bg-orange-600"
          >
            colar tokens
          </Link>
        )}
      </td>
      <td className="px-3 py-2 text-sm text-slate-700">{worker?.jogo?.lastAction ?? "—"}</td>
      <td className="px-3 py-2 font-mono text-sm tabular-nums text-slate-700">
        {worker?.state === "running" ? formatarUptime(worker.startedAt, agora) : "—"}
      </td>
      <td className="max-w-56 px-3 py-2 text-sm text-red-800">
        {erro ? (
          <span title={erro} className="block truncate">
            {erro}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {rodando ? (
            <>
              <button type="button" className={BOTAO} disabled={ocupado} onClick={() => executar("stop")}>
                {pendente === "stop" ? "Parando…" : "Parar"}
              </button>
              <button
                type="button"
                className={BOTAO}
                disabled={ocupado || offline}
                title={offline ? TITULO_OFFLINE : undefined}
                onClick={() => executar("restart")}
              >
                {pendente === "restart" ? "Reiniciando…" : "Reiniciar"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={BOTAO}
              disabled={ocupado || offline}
              title={offline ? TITULO_OFFLINE : undefined}
              onClick={() => executar("start")}
            >
              {pendente === "start" ? "Iniciando…" : "Iniciar"}
            </button>
          )}
          <button type="button" className={BOTAO} onClick={() => onLogs(accountId)}>
            Logs
          </button>
          {account && (
            <Link href={`/accounts/${account.id}`} className={BOTAO}>
              Editar
            </Link>
          )}
        </div>
        {aguardando && <p className="mt-1 text-xs text-slate-500">aguardando status…</p>}
        {erroAcao && (
          <p role="alert" className="mt-1 text-xs text-red-800">
            {erroAcao}
          </p>
        )}
      </td>
    </tr>
  );
}
