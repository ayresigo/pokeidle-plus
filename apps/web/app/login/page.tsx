"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useState, type FormEvent } from "react";
import { ApiError, getSession, login } from "@/lib/api";

function mensagemDeErro(erro: unknown): string {
  if (!(erro instanceof ApiError)) return "control-plane inalcançável, tente novamente";
  if (erro.status === 401) return "credenciais inválidas";
  if (erro.status === 503) return "servidor central inalcançável, tente novamente";
  return `falha ao entrar (${erro.status}): ${erro.message}`;
}

export default function LoginPage() {
  const router = useRouter();
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useLayoutEffect(
    () => () => {
      setSenha("");
      setEnviando(false);
      setErro(null);
    },
    [],
  );

  useEffect(() => {
    let ativo = true;
    getSession()
      .then((sessao) => {
        if (ativo && sessao.authenticated) router.replace("/");
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, [router]);

  async function entrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      await login(usuario, senha);
      router.replace("/");
    } catch (falha) {
      setErro(mensagemDeErro(falha));
      setEnviando(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form
        onSubmit={entrar}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h1 className="text-lg font-semibold">Multiacc PokeIdle</h1>
        <label className="flex flex-col gap-1 text-sm">
          Usuário
          <input
            name="username"
            autoComplete="username"
            required
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Senha
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          />
        </label>
        {erro && (
          <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
            {erro}
          </p>
        )}
        <button
          type="submit"
          disabled={enviando}
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
