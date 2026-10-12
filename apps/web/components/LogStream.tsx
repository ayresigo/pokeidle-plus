"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { apiUrl, type LogLine } from "@/lib/api";
import { extrairDadosSse } from "@/lib/sse";

const LIMITE_LINHAS = 2000;
const TOLERANCIA_FIM_PX = 16;

type EstadoStream = "conectando" | "ao vivo" | "encerrado" | "sem worker" | "erro";

interface LinhaLog extends LogLine {
  seq: number;
}

interface LogStreamProps {
  accountId: string;
  titulo: string;
  onClose: () => void;
}

export function LogStream({ accountId, titulo, onClose }: LogStreamProps) {
  const [linhas, setLinhas] = useState<LinhaLog[]>([]);
  const [estado, setEstado] = useState<EstadoStream>("conectando");
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [seguindo, setSeguindo] = useState(true);
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controle = new AbortController();
    let seq = 0;
    const abrir = async () => {
      const res = await fetch(apiUrl(`/workers/${encodeURIComponent(accountId)}/logs/stream`), {
        signal: controle.signal,
        cache: "no-store",
        headers: { accept: "text/event-stream" },
      });
      if (res.status === 404) {
        setEstado("sem worker");
        return;
      }
      if (!res.ok || !res.body) {
        setEstado("erro");
        setDetalhe(`control-plane respondeu ${res.status}`);
        return;
      }
      setEstado("ao vivo");
      const leitor = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        const { dados, resto } = extrairDadosSse(buffer + value);
        buffer = resto;
        const novas: LinhaLog[] = [];
        for (const dado of dados) {
          try {
            const log = JSON.parse(dado) as LogLine;
            novas.push({ line: log.line, ts: log.ts, seq: seq++ });
          } catch {}
        }
        if (novas.length > 0) {
          setLinhas((atuais) => [...atuais, ...novas].slice(-LIMITE_LINHAS));
        }
      }
      setEstado("encerrado");
    };
    abrir().catch((erro: unknown) => {
      if (controle.signal.aborted) return;
      setEstado("erro");
      setDetalhe(erro instanceof Error ? erro.message : String(erro));
    });
    return () => controle.abort();
  }, [accountId]);

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (area && seguindo) area.scrollTop = area.scrollHeight;
  }, [linhas, seguindo]);

  function aoRolar() {
    const area = areaRef.current;
    if (!area) return;
    setSeguindo(area.scrollHeight - area.scrollTop - area.clientHeight < TOLERANCIA_FIM_PX);
  }

  return (
    <aside
      role="dialog"
      aria-label={`Logs de ${titulo}`}
      className="fixed inset-y-0 right-0 z-20 flex w-full max-w-3xl flex-col border-l border-slate-300 bg-white shadow-xl"
    >
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold">Logs — {titulo}</h2>
        <span className="text-xs text-slate-500">{estado}</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
        >
          Fechar
        </button>
      </div>
      {estado === "sem worker" && (
        <p className="px-4 py-3 text-sm text-slate-600">worker não está rodando</p>
      )}
      {estado === "erro" && (
        <p role="alert" className="px-4 py-3 text-sm text-red-800">
          falha no stream de logs{detalhe ? `: ${detalhe}` : ""}
        </p>
      )}
      <div
        ref={areaRef}
        onScroll={aoRolar}
        hidden={linhas.length === 0 && (estado === "sem worker" || estado === "erro")}
        className="flex-1 overflow-y-auto bg-slate-950 px-4 py-2 font-mono text-xs leading-5 text-slate-100"
      >
        {linhas.map((linha) => (
          <div key={linha.seq} className="whitespace-pre-wrap break-all">
            <span className="mr-2 text-slate-500">{new Date(linha.ts).toLocaleTimeString("pt-BR")}</span>
            {linha.line}
          </div>
        ))}
      </div>
      {!seguindo && (
        <button
          type="button"
          onClick={() => setSeguindo(true)}
          className="border-t border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          auto-scroll pausado — voltar ao fim
        </button>
      )}
    </aside>
  );
}
