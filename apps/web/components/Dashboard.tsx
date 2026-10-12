"use client";

import Link from "next/link";
import { use, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccountRow } from "@/components/AccountRow";
import { LogStream } from "@/components/LogStream";
import { ApiError, apiFetch, apiUrl, type Account, type WorkerSnapshot } from "@/lib/api";
import { SessaoContext } from "@/lib/sessao";
import { mesclarContas } from "@/lib/status";

const ATRASO_RECONEXAO_MS = 3_000;

type Conexao = "conectando" | "ao vivo" | "reconectando";

const INDICADOR: Record<Conexao, string> = {
  conectando: "bg-slate-400",
  "ao vivo": "bg-green-500",
  reconectando: "bg-amber-500",
};

export function Dashboard() {
  const { offline } = use(SessaoContext);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [erroContas, setErroContas] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<WorkerSnapshot[]>([]);
  const [conexao, setConexao] = useState<Conexao>("conectando");
  const [agora, setAgora] = useState(() => Date.now());
  const [logsDe, setLogsDe] = useState<string | null>(null);
  const [versaoContas, setVersaoContas] = useState(0);
  const idsConhecidos = useRef<Set<string> | null>(null);

  useLayoutEffect(() => () => setLogsDe(null), []);

  useEffect(() => {
    let ativo = true;
    apiFetch<Account[]>("/accounts").then(
      (lista) => {
        if (!ativo) return;
        idsConhecidos.current = new Set([...(idsConhecidos.current ?? []), ...lista.map((conta) => conta.id)]);
        setAccounts(lista);
        setErroContas(null);
      },
      (erro: unknown) => {
        if (!ativo) return;
        setErroContas(erro instanceof ApiError ? erro.message : "control-plane inalcançável");
      },
    );
    return () => {
      ativo = false;
    };
  }, [versaoContas]);

  useEffect(() => {
    let fonte: EventSource | null = null;
    let timer: number | undefined;
    const receber = (evento: MessageEvent<string>) => {
      const lista = JSON.parse(evento.data) as WorkerSnapshot[];
      setSnapshot(lista);
      const conhecidos = idsConhecidos.current;
      const novos = conhecidos === null ? [] : lista.filter((w) => !conhecidos.has(w.accountId));
      if (conhecidos !== null && novos.length > 0) {
        for (const worker of novos) conhecidos.add(worker.accountId);
        setVersaoContas((versao) => versao + 1);
      }
    };
    const conectar = () => {
      const atual = new EventSource(apiUrl("/events"));
      fonte = atual;
      atual.addEventListener("snapshot", receber);
      atual.addEventListener("update", receber);
      atual.onopen = () => setConexao("ao vivo");
      atual.onerror = () => {
        setConexao("reconectando");
        if (atual.readyState === EventSource.CLOSED) {
          timer = window.setTimeout(conectar, ATRASO_RECONEXAO_MS);
        }
      };
    };
    conectar();
    return () => {
      clearTimeout(timer);
      fonte?.close();
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setAgora(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const linhas = useMemo(() => mesclarContas(accounts ?? [], snapshot), [accounts, snapshot]);
  const linhaLogs = logsDe === null ? null : linhas.find((linha) => linha.accountId === logsDe);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold">Contas</h1>
        <span className="flex items-center gap-1.5 text-xs text-slate-500" aria-live="polite">
          <span className={`inline-block h-2 w-2 rounded-full ${INDICADOR[conexao]}`} />
          {conexao}
        </span>
        <Link
          href="/accounts/new"
          className="ml-auto rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          Nova conta
        </Link>
      </div>
      {erroContas && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          não foi possível carregar as contas: {erroContas}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left">
          <thead className="whitespace-nowrap bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Conta</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Última ação</th>
              <th className="px-3 py-2 font-medium">Rodando há</th>
              <th className="px-3 py-2 font-medium">Erro</th>
              <th className="px-3 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => (
              <AccountRow key={linha.accountId} linha={linha} agora={agora} offline={offline} onLogs={setLogsDe} />
            ))}
            {linhas.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">
                  {accounts === null && !erroContas ? "carregando contas…" : "nenhuma conta cadastrada"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {logsDe !== null && (
        <LogStream
          key={logsDe}
          accountId={logsDe}
          titulo={linhaLogs?.account?.label ?? logsDe}
          onClose={() => setLogsDe(null)}
        />
      )}
    </div>
  );
}
