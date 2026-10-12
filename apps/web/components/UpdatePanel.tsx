"use client";

import { use, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError, apiFetch, apiUrl, type UpdateStatus } from "@/lib/api";
import { SessaoContext } from "@/lib/sessao";
import { TEXTO_ESTADO, acoesUpdate, emAndamento, mensagemErroUpdate, type OperacaoUpdate } from "@/lib/update";

const INTERVALO_NORMAL_MS = 60_000;
const INTERVALO_ANDAMENTO_MS = 3_000;
const ERRO_PROXY = "control-plane inalcançável";

type Aviso = { tipo: "ok" | "erro"; texto: string };

function formatarData(iso: string | null): string {
  return iso === null ? "nunca" : new Date(iso).toLocaleString("pt-BR");
}

function respondeuControlPlane(erro: unknown): erro is ApiError {
  return erro instanceof ApiError && erro.message !== ERRO_PROXY;
}

export function UpdatePanel() {
  const { offline } = use(SessaoContext);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [acao, setAcao] = useState<OperacaoUpdate | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [reiniciando, setReiniciando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const versaoRef = useRef<string | null>(null);

  useLayoutEffect(() => () => setAviso(null), []);

  useEffect(() => {
    if (reiniciando) return;
    let ativo = true;
    let timer: number | undefined;
    let ultimo: UpdateStatus | null = null;
    const ciclo = async () => {
      let espera = INTERVALO_NORMAL_MS;
      try {
        const atual = await apiFetch<UpdateStatus>("/update/status");
        if (!ativo) return;
        ultimo = atual;
        versaoRef.current = atual.currentVersion;
        setStatus(atual);
        setErroCarga(null);
        if (emAndamento(atual)) espera = INTERVALO_ANDAMENTO_MS;
      } catch (erro) {
        if (!ativo) return;
        if (ultimo !== null && emAndamento(ultimo) && !respondeuControlPlane(erro)) {
          setReiniciando(true);
          return;
        }
        setErroCarga(erro instanceof ApiError ? erro.message : ERRO_PROXY);
        espera = INTERVALO_ANDAMENTO_MS;
      }
      if (ativo) timer = window.setTimeout(ciclo, espera);
    };
    void ciclo();
    return () => {
      ativo = false;
      clearTimeout(timer);
    };
  }, [reiniciando, recarga]);

  useEffect(() => {
    if (!reiniciando) return;
    let ativo = true;
    let caiu = false;
    let timer: number | undefined;
    const ciclo = async () => {
      try {
        const saude = await fetch(apiUrl("/health"), { cache: "no-store" });
        if (!saude.ok) throw new Error(`health ${saude.status}`);
        if (caiu) {
          window.location.reload();
          return;
        }
        const atual = await apiFetch<UpdateStatus>("/update/status", { redirectOn401: false });
        if (!ativo) return;
        if (atual.currentVersion !== versaoRef.current) {
          window.location.reload();
          return;
        }
        if (atual.state === "update_failed") {
          setStatus(atual);
          setReiniciando(false);
          return;
        }
      } catch {
        caiu = true;
      }
      if (ativo) timer = window.setTimeout(ciclo, INTERVALO_ANDAMENTO_MS);
    };
    timer = window.setTimeout(ciclo, INTERVALO_ANDAMENTO_MS);
    return () => {
      ativo = false;
      clearTimeout(timer);
    };
  }, [reiniciando]);

  async function aplicar() {
    if (!status) return;
    const confirmado = window.confirm(
      `Atualizar para v${status.latestVersion}?\n\nOs workers serão recriados um a um com a nova versão e, no fim, a interface e o control-plane reiniciam. A página pode ficar fora do ar por alguns instantes e recarrega sozinha.`,
    );
    if (!confirmado) return;
    setAcao("apply");
    setAviso(null);
    setRecarga((n) => n + 1);
    try {
      const novo = await apiFetch<UpdateStatus>("/update/apply", { method: "POST" });
      setStatus(novo);
      setReiniciando(true);
    } catch (erro) {
      if (respondeuControlPlane(erro)) {
        setAviso({ tipo: "erro", texto: mensagemErroUpdate("apply", erro.status, erro.message) });
        setRecarga((n) => n + 1);
      } else {
        setReiniciando(true);
      }
    } finally {
      setAcao(null);
    }
  }

  async function voltar() {
    if (!status?.rollbackVersao) return;
    const confirmado = window.confirm(
      `Voltar para v${status.rollbackVersao}?\n\nOs workers serão recriados um a um com a versão anterior.`,
    );
    if (!confirmado) return;
    setAcao("rollback");
    setAviso(null);
    setRecarga((n) => n + 1);
    try {
      const novo = await apiFetch<UpdateStatus>("/update/rollback", { method: "POST" });
      setStatus(novo);
      setAviso({ tipo: "ok", texto: `workers de volta à v${status.rollbackVersao}` });
    } catch (erro) {
      setAviso({
        tipo: "erro",
        texto: erro instanceof ApiError ? mensagemErroUpdate("rollback", erro.status, erro.message) : ERRO_PROXY,
      });
    } finally {
      setAcao(null);
      setRecarga((n) => n + 1);
    }
  }

  async function alternarAuto() {
    if (!status) return;
    setAcao("settings");
    setAviso(null);
    try {
      const novo = await apiFetch<UpdateStatus>("/update/settings", {
        method: "POST",
        body: JSON.stringify({ autoUpdate: !status.autoUpdate }),
      });
      setStatus(novo);
      setAviso({ tipo: "ok", texto: novo.autoUpdate ? "atualização automática ligada" : "atualização automática desligada" });
    } catch (erro) {
      setAviso({
        tipo: "erro",
        texto: erro instanceof ApiError ? mensagemErroUpdate("settings", erro.status, erro.message) : ERRO_PROXY,
      });
    } finally {
      setAcao(null);
    }
  }

  if (reiniciando) {
    return (
      <div role="status" className="flex max-w-2xl flex-col gap-2 rounded-lg border border-blue-300 bg-blue-50 p-6 text-blue-900">
        <h1 className="text-lg font-semibold">Atualizando…</h1>
        <p className="text-sm">A interface está reiniciando com a nova versão. A página vai recarregar sozinha quando voltar.</p>
      </div>
    );
  }

  if (!status) {
    return (
      <p className={`text-sm ${erroCarga ? "text-red-800" : "text-slate-500"}`}>
        {erroCarga ? `não foi possível carregar o status de atualização: ${erroCarga}` : "carregando…"}
      </p>
    );
  }

  const acoes = acoesUpdate(status, offline);
  const ocupado = acao !== null;
  const andamento = emAndamento(status);
  const rotuloEstado = acao === "apply" ? "atualizando" : TEXTO_ESTADO[status.state];

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-semibold">Configurações</h1>
      {offline && (
        <p role="alert" className="rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
          Modo offline: atualizar e mudar a atualização automática exigem o servidor central. Voltar para a versão anterior continua disponível.
        </p>
      )}
      <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Atualizações</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-slate-500">Versão atual</dt>
          <dd>v{status.currentVersion}</dd>
          <dt className="text-slate-500">Última versão</dt>
          <dd>{status.latestVersion ? `v${status.latestVersion}` : "nenhuma release publicada"}</dd>
          <dt className="text-slate-500">Último check</dt>
          <dd>{formatarData(status.lastCheck)}</dd>
          <dt className="text-slate-500">Estado</dt>
          <dd className={status.state === "update_failed" ? "text-red-800" : andamento ? "text-blue-800" : ""}>{rotuloEstado}</dd>
        </dl>
        {status.lastError && (
          <p role="alert" className="whitespace-pre-wrap break-words rounded bg-red-50 px-3 py-2 text-sm text-red-800">
            {status.lastError}
          </p>
        )}
        {erroCarga && <p className="text-xs text-red-700">falha ao atualizar o status: {erroCarga}</p>}
        {status.updateAvailable && status.latestChangelog && (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">Novidades da v{status.latestVersion}</h3>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs text-slate-800">{status.latestChangelog}</pre>
          </div>
        )}
        {aviso && (
          <p
            role={aviso.tipo === "erro" ? "alert" : "status"}
            className={`rounded px-3 py-2 text-sm ${aviso.tipo === "erro" ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}
          >
            {aviso.texto}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={aplicar}
            disabled={ocupado || !acoes.aplicar.habilitado}
            title={acoes.aplicar.motivo ?? undefined}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {acao === "apply" ? "atualizando…" : "atualizar agora"}
          </button>
          {status.rollbackDisponivel && status.rollbackVersao && (
            <button
              type="button"
              onClick={voltar}
              disabled={ocupado || !acoes.rollback.habilitado}
              title={acoes.rollback.motivo ?? undefined}
              className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {acao === "rollback" ? "voltando…" : `voltar para v${status.rollbackVersao}`}
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm" title={acoes.autoUpdate.motivo ?? undefined}>
          <input
            type="checkbox"
            role="switch"
            checked={status.autoUpdate}
            onChange={alternarAuto}
            disabled={ocupado || !acoes.autoUpdate.habilitado}
            className="h-4 w-4"
          />
          Atualização automática
          {acao === "settings" && <span className="text-xs text-slate-500">salvando…</span>}
        </label>
      </section>
    </div>
  );
}
