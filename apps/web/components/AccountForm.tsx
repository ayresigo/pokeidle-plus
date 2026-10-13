"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { use, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { ApiError, apiFetch, type Account, type WorkerSnapshot } from "@/lib/api";
import {
  VALORES_VAZIOS,
  corpoCriacao,
  corpoEdicao,
  extrairTokens,
  tokensPreenchidos,
  validarConta,
  validarProxyUrl,
  type CampoConta,
  type ErrosConta,
  type ValoresConta,
} from "@/lib/conta";
import { SessaoContext } from "@/lib/sessao";
import { estaRodando } from "@/lib/status";

type ResultadoProxy = { ip: string } | { erro: string };

type Aviso = { tipo: "ok" | "erro"; texto: string };

function mensagem(erro: unknown): string {
  return erro instanceof ApiError ? erro.message : "control-plane inalcançável";
}

interface CampoProps {
  campo: CampoConta;
  rotulo: string;
  valores: ValoresConta;
  erros: ErrosConta;
  onChange: (campo: CampoConta, valor: string) => void;
  tipo?: "text" | "password";
  placeholder?: string;
  dica?: string;
  autoComplete?: string;
  children?: ReactNode;
}

function Campo({ campo, rotulo, valores, erros, onChange, tipo = "text", placeholder, dica, autoComplete = "off", children }: CampoProps) {
  const erro = erros[campo];
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={`campo-${campo}`} className="font-medium">
        {rotulo}
      </label>
      <div className="flex gap-2">
        <input
          id={`campo-${campo}`}
          name={campo}
          type={tipo}
          value={valores[campo]}
          onChange={(e) => onChange(campo, e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          spellCheck={false}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? `erro-${campo}` : undefined}
          className={`min-w-0 flex-1 rounded border px-3 py-2 ${erro ? "border-red-400" : "border-slate-300"}`}
        />
        {children}
      </div>
      {dica && !erro && <p className="text-xs text-slate-500">{dica}</p>}
      {erro && (
        <p id={`erro-${campo}`} className="text-xs text-red-700">
          {erro}
        </p>
      )}
    </div>
  );
}

interface AccountFormProps {
  editar?: boolean;
}

export function AccountForm({ editar = false }: AccountFormProps) {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const { offline } = use(SessaoContext);
  const accountId = editar ? params.id : undefined;
  const editando = accountId !== undefined;

  const [atual, setAtual] = useState<Account | null>(null);
  const [worker, setWorker] = useState<WorkerSnapshot | null>(null);
  const [carregando, setCarregando] = useState(editando);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [valores, setValores] = useState<ValoresConta>(VALORES_VAZIOS);
  const [erros, setErros] = useState<ErrosConta>({});
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [testandoProxy, setTestandoProxy] = useState(false);
  const [resultadoProxy, setResultadoProxy] = useState<ResultadoProxy | null>(null);
  const [jsonTokens, setJsonTokens] = useState("");
  const [erroJson, setErroJson] = useState<string | null>(null);
  const [oferecerRestart, setOferecerRestart] = useState(false);
  const [reiniciando, setReiniciando] = useState(false);
  const [excluindo, setExcluindo] = useState<"parando" | "excluindo" | null>(null);
  const secaoTokensRef = useRef<HTMLElement>(null);

  useLayoutEffect(
    () => () => {
      setValores(VALORES_VAZIOS);
      setErros({});
      setAviso(null);
      setResultadoProxy(null);
      setJsonTokens("");
      setErroJson(null);
      setOferecerRestart(false);
      setEnviando(false);
      setTestandoProxy(false);
      setReiniciando(false);
      setExcluindo(null);
      setCarregando(accountId !== undefined);
    },
    [accountId],
  );

  useEffect(() => {
    if (accountId === undefined) return;
    let ativo = true;
    Promise.all([apiFetch<Account[]>("/accounts"), apiFetch<WorkerSnapshot[]>("/workers/status")]).then(
      ([contas, snapshot]) => {
        if (!ativo) return;
        const conta = contas.find((c) => c.id === accountId) ?? null;
        setAtual(conta);
        setWorker(snapshot.find((w) => w.accountId === accountId) ?? null);
        setErroCarga(conta ? null : "conta não encontrada");
        if (conta) {
          setValores({ ...VALORES_VAZIOS, label: conta.label, pokeidleUser: conta.pokeidleUser, proxyUrl: conta.proxyUrl ?? "", huntSlug: conta.huntSlug ?? "" });
        }
        setCarregando(false);
      },
      (erro: unknown) => {
        if (!ativo) return;
        setErroCarga(mensagem(erro));
        setCarregando(false);
      },
    );
    return () => {
      ativo = false;
    };
  }, [accountId]);

  const prontoParaAncora = !carregando && (editando ? atual !== null : true);
  useEffect(() => {
    if (!prontoParaAncora || window.location.hash !== "#tokens") return;
    secaoTokensRef.current?.scrollIntoView({ block: "start" });
    secaoTokensRef.current?.querySelector("textarea")?.focus();
  }, [prontoParaAncora]);

  function alterar(campo: CampoConta, valor: string) {
    setValores((v) => ({ ...v, [campo]: valor }));
    setErros((e) => ({ ...e, [campo]: undefined }));
    setAviso((a) => (a?.tipo === "erro" ? null : a));
    if (campo === "proxyUrl") setResultadoProxy(null);
  }

  function colarJson(evento: ChangeEvent<HTMLTextAreaElement>) {
    const texto = evento.target.value;
    setJsonTokens(texto);
    if (texto.trim() === "") {
      setErroJson(null);
      return;
    }
    const resultado = extrairTokens(texto);
    if (!resultado.ok) {
      setErroJson(resultado.erro);
      return;
    }
    setErroJson(null);
    setValores((v) => ({ ...v, ...resultado.tokens }));
    setErros((e) => ({ ...e, accessToken: undefined, refreshToken: undefined }));
  }

  async function testarProxy() {
    const proxyUrl = valores.proxyUrl.trim();
    const erroFormato = proxyUrl === "" ? "informe o proxy para testar" : validarProxyUrl(proxyUrl);
    if (erroFormato) {
      setErros((e) => ({ ...e, proxyUrl: erroFormato }));
      return;
    }
    setTestandoProxy(true);
    setResultadoProxy(null);
    try {
      const { ip } = await apiFetch<{ ip: string }>("/proxy/test", { method: "POST", body: JSON.stringify({ proxyUrl }) });
      setResultadoProxy({ ip });
    } catch (erro) {
      setResultadoProxy({ erro: mensagem(erro) });
    } finally {
      setTestandoProxy(false);
    }
  }

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setAviso(null);
    setOferecerRestart(false);
    const encontrados = validarConta(valores, atual ? { modo: "editar", proxyAtual: atual.proxyUrl } : { modo: "criar" });
    setErros(encontrados);
    if (Object.keys(encontrados).length > 0) {
      setAviso({ tipo: "erro", texto: "corrija os campos destacados" });
      return;
    }
    setEnviando(true);
    try {
      if (!atual) {
        await apiFetch<Account>("/accounts", { method: "POST", body: JSON.stringify(corpoCriacao(valores)) });
        router.push("/");
        return;
      }
      const patch = corpoEdicao(valores, atual);
      const tokens = tokensPreenchidos(valores);
      if (Object.keys(patch).length === 0 && tokens === null) {
        setAviso({ tipo: "ok", texto: "nenhuma alteração para salvar" });
        return;
      }
      let conta = atual;
      if (Object.keys(patch).length > 0) {
        conta = await apiFetch<Account>(`/accounts/${encodeURIComponent(atual.id)}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        setAtual(conta);
      }
      if (tokens) {
        await apiFetch<void>(`/accounts/${encodeURIComponent(atual.id)}/tokens`, { method: "PUT", body: JSON.stringify(tokens) });
        setJsonTokens("");
        setOferecerRestart(estaRodando(worker));
      }
      setValores({ ...VALORES_VAZIOS, label: conta.label, pokeidleUser: conta.pokeidleUser, proxyUrl: conta.proxyUrl ?? "", huntSlug: conta.huntSlug ?? "" });
      setAviso({ tipo: "ok", texto: tokens ? "alterações e tokens salvos" : "alterações salvas" });
    } catch (erro) {
      setAviso({ tipo: "erro", texto: mensagem(erro) });
    } finally {
      setEnviando(false);
    }
  }

  async function reiniciarWorker() {
    if (!atual) return;
    setReiniciando(true);
    try {
      await apiFetch(`/workers/${encodeURIComponent(atual.id)}/restart`, { method: "POST" });
      setOferecerRestart(false);
      setAviso({ tipo: "ok", texto: "worker reiniciado com os novos tokens" });
    } catch (erro) {
      setAviso({ tipo: "erro", texto: `falha ao reiniciar: ${mensagem(erro)}` });
    } finally {
      setReiniciando(false);
    }
  }

  async function excluir() {
    if (!atual) return;
    const rodando = estaRodando(worker);
    const pergunta = rodando
      ? `O worker de "${atual.label}" está rodando e será parado antes da exclusão. Excluir a conta?`
      : `Excluir a conta "${atual.label}"? Essa ação não pode ser desfeita.`;
    if (!window.confirm(pergunta)) return;
    setAviso(null);
    try {
      if (rodando) {
        setExcluindo("parando");
        await apiFetch(`/workers/${encodeURIComponent(atual.id)}/stop`, { method: "POST" });
      }
      setExcluindo("excluindo");
      await apiFetch<void>(`/accounts/${encodeURIComponent(atual.id)}`, { method: "DELETE" });
      router.push("/");
    } catch (erro) {
      setAviso({ tipo: "erro", texto: `falha ao excluir: ${mensagem(erro)}` });
      setExcluindo(null);
    }
  }

  if (carregando) return <p className="text-sm text-slate-500">carregando conta…</p>;
  if (editando && !atual) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-sm text-red-800">
          {erroCarga ?? "conta não encontrada"}
        </p>
        <Link href="/" className="text-sm text-slate-600 underline">
          voltar ao dashboard
        </Link>
      </div>
    );
  }

  const precisaLogin = worker?.jogo?.state === "needs-login";
  const ocupado = enviando || excluindo !== null;
  const placeholderSegredo = editando ? "não exibido — deixe em branco para não alterar" : undefined;

  const secaoTokens = (
    <section
      id="tokens"
      ref={secaoTokensRef}
      className={`flex scroll-mt-4 flex-col gap-3 rounded-lg border p-4 ${precisaLogin ? "border-orange-400 bg-orange-50" : "border-slate-200 bg-white"}`}
    >
      <h2 className="font-semibold">{precisaLogin ? "Esta conta precisa de login" : "Ou cole os tokens"}</h2>
      {precisaLogin && (
        <p className="text-sm text-orange-900">
          O worker não conseguiu autenticar sozinho. Cole tokens novos abaixo, salve e reinicie o worker.
        </p>
      )}
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
        <li>
          No seu navegador normal, entre em{" "}
          <a href="https://pokeidle.io" target="_blank" rel="noreferrer" className="underline">
            pokeidle.io
          </a>{" "}
          com esta conta.
        </li>
        <li>Com o jogo aberto, aperte F12 e vá na aba Application (ou Armazenamento) → Local Storage → pokeidle.io.</li>
        <li>Copie o valor do token Bearer guardado ali (o texto longo do token de sessão).</li>
        <li>Cole esse token único no campo abaixo; os campos accessToken e refreshToken são preenchidos sozinhos.</li>
        <li>Não use mais essa conta naquele navegador: o jogo permite só uma sessão por conta.</li>
      </ol>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor="campo-json-tokens" className="font-medium">
          Token do pokeidle.io
        </label>
        <textarea
          id="campo-json-tokens"
          value={jsonTokens}
          onChange={colarJson}
          rows={3}
          spellCheck={false}
          placeholder="cole aqui o token do pokeidle.io"
          className={`rounded border px-3 py-2 font-mono text-xs ${erroJson ? "border-red-400" : "border-slate-300"}`}
        />
        {erroJson && <p className="text-xs text-red-700">{erroJson}</p>}
        {!erroJson && jsonTokens.trim() !== "" && <p className="text-xs text-green-700">token aplicado</p>}
      </div>
      <Campo campo="accessToken" rotulo="accessToken" valores={valores} erros={erros} onChange={alterar} placeholder={placeholderSegredo} />
      <Campo campo="refreshToken" rotulo="refreshToken" valores={valores} erros={erros} onChange={alterar} placeholder={placeholderSegredo} />
      {oferecerRestart && (
        <div className="flex items-center gap-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
          Tokens salvos. O worker só usa os novos tokens depois de reiniciar.
          <button
            type="button"
            onClick={reiniciarWorker}
            disabled={reiniciando}
            className="ml-auto rounded bg-green-700 px-3 py-1 text-white hover:bg-green-800 disabled:opacity-50"
          >
            {reiniciando ? "reiniciando…" : "reiniciar worker agora"}
          </button>
        </div>
      )}
    </section>
  );

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
          ← Contas
        </Link>
        <h1 className="text-xl font-semibold">{atual ? `Editar ${atual.label}` : "Nova conta"}</h1>
      </div>
      {offline && (
        <p role="alert" className="rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
          Modo offline: o servidor central é necessário para salvar contas. O formulário volta a funcionar quando a conexão voltar.
        </p>
      )}
      <form onSubmit={salvar} noValidate>
        <fieldset disabled={offline || ocupado} className="flex flex-col gap-4">
          {precisaLogin && secaoTokens}
          <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
            <Campo campo="label" rotulo="Nome da conta" valores={valores} erros={erros} onChange={alterar} />
            <Campo campo="pokeidleUser" rotulo="Usuário PokeIdle" valores={valores} erros={erros} onChange={alterar} />
            <Campo
              campo="pokeidlePass"
              rotulo="Senha PokeIdle"
              tipo="password"
              autoComplete="new-password"
              valores={valores}
              erros={erros}
              onChange={alterar}
              placeholder={placeholderSegredo}
            />
            <Campo
              campo="proxyUrl"
              rotulo="Proxy (opcional)"
              valores={valores}
              erros={erros}
              onChange={alterar}
              placeholder="http://usuario:senha@host:porta"
              dica="http://, https:// ou socks5://"
            >
              <button
                type="button"
                onClick={testarProxy}
                disabled={testandoProxy}
                className="whitespace-nowrap rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50"
              >
                {testandoProxy ? "testando…" : "testar proxy"}
              </button>
            </Campo>
            {resultadoProxy && "ip" in resultadoProxy && (
              <p role="status" className="text-sm text-green-800">
                IP de saída: {resultadoProxy.ip}
              </p>
            )}
            {resultadoProxy && "erro" in resultadoProxy && (
              <p role="alert" className="text-sm text-red-800">
                Teste do proxy falhou: {resultadoProxy.erro}
              </p>
            )}
            <Campo
              campo="solverKey"
              rotulo="Chave do solver (opcional)"
              tipo="password"
              valores={valores}
              erros={erros}
              onChange={alterar}
              placeholder={placeholderSegredo}
              dica="chave 2captcha-compatível para login automático"
            />
            <Campo
              campo="huntSlug"
              rotulo="Hunt (slug) (opcional)"
              valores={valores}
              erros={erros}
              onChange={alterar}
              placeholder="deixe vazio para o worker usar a hunt atual do personagem"
              dica="slug da hunt a caçar (ex.: bellsprout); vazio = mantém a hunt do servidor"
            />
          </div>
          {!precisaLogin && secaoTokens}
          {aviso && (
            <p
              role={aviso.tipo === "erro" ? "alert" : "status"}
              className={`rounded px-3 py-2 text-sm ${aviso.tipo === "erro" ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}
            >
              {aviso.texto}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {enviando ? "salvando…" : atual ? "Salvar alterações" : "Criar conta"}
            </button>
            {atual && (
              <button
                type="button"
                onClick={excluir}
                className="ml-auto rounded border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {excluindo === "parando" ? "parando worker…" : excluindo === "excluindo" ? "excluindo…" : "Excluir conta"}
              </button>
            )}
          </div>
        </fieldset>
      </form>
    </div>
  );
}
