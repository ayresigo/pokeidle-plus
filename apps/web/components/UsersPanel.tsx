"use client";

import { Fragment, use, useEffect, useLayoutEffect, useState, type FormEvent } from "react";
import { ApiError, apiFetch, type NovoUsuario, type Papel, type Usuario, type UsuarioPatch } from "@/lib/api";
import { SessaoContext } from "@/lib/sessao";
import { gerarSenhaForte, validarNovoUsuario, validarSenha, type ErrosNovoUsuario } from "@/lib/usuario";

type Aviso = { tipo: "ok" | "erro"; texto: string };

const NOVO_VAZIO: NovoUsuario = { username: "", password: "", role: "user" };

const ROTULO_PAPEL: Record<Papel, string> = { admin: "administrador", user: "usuário" };

const CLASSE_BOTAO = "rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 disabled:opacity-50";

function mensagem(erro: unknown): string {
  return erro instanceof ApiError ? erro.message : "control-plane inalcançável";
}

function AvisoTexto({ aviso }: { aviso: Aviso | null }) {
  if (!aviso) return null;
  return (
    <p
      role={aviso.tipo === "erro" ? "alert" : "status"}
      className={`rounded px-3 py-2 text-sm ${aviso.tipo === "erro" ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}
    >
      {aviso.texto}
    </p>
  );
}

interface CampoSenhaProps {
  id: string;
  rotulo: string;
  valor: string;
  erro?: string;
  onChange: (valor: string) => void;
}

function CampoSenha({ id, rotulo, valor, erro, onChange }: CampoSenhaProps) {
  const [gerada, setGerada] = useState<string | null>(null);
  const [copia, setCopia] = useState<"ok" | "falhou" | null>(null);
  const mostrarGerada = gerada !== null && gerada === valor;

  useLayoutEffect(
    () => () => {
      setGerada(null);
      setCopia(null);
    },
    [],
  );

  function gerar() {
    const senha = gerarSenhaForte();
    setGerada(senha);
    setCopia(null);
    onChange(senha);
  }

  function digitar(texto: string) {
    setGerada(null);
    setCopia(null);
    onChange(texto);
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopia("ok");
    } catch {
      setCopia("falhou");
    }
  }

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {rotulo}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type={mostrarGerada ? "text" : "password"}
          value={valor}
          onChange={(e) => digitar(e.target.value)}
          autoComplete="new-password"
          spellCheck={false}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? `${id}-erro` : undefined}
          className={`min-w-0 flex-1 rounded border px-3 py-2 font-mono ${erro ? "border-red-400" : "border-slate-300"}`}
        />
        <button type="button" onClick={gerar} className={`whitespace-nowrap ${CLASSE_BOTAO}`}>
          gerar senha forte
        </button>
      </div>
      {mostrarGerada && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span>Copie a senha agora: ela não será exibida de novo depois de salvar.</span>
          <button type="button" onClick={copiar} className="rounded border border-amber-400 px-2 py-0.5 hover:bg-amber-100">
            {copia === "ok" ? "copiada" : "copiar"}
          </button>
          {copia === "falhou" && <span>não foi possível copiar; selecione o campo e copie manualmente</span>}
        </div>
      )}
      <p className="text-xs text-slate-500">entre 12 e 256 caracteres</p>
      {erro && (
        <p id={`${id}-erro`} className="text-xs text-red-700">
          {erro}
        </p>
      )}
    </div>
  );
}

function NovoUsuarioForm({ onCriado }: { onCriado: (usuario: Usuario) => void }) {
  const [valores, setValores] = useState<NovoUsuario>(NOVO_VAZIO);
  const [erros, setErros] = useState<ErrosNovoUsuario>({});
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [versao, setVersao] = useState(0);

  useLayoutEffect(
    () => () => {
      setValores(NOVO_VAZIO);
      setErros({});
      setEnviando(false);
      setAviso(null);
    },
    [],
  );

  function alterar(campo: keyof NovoUsuario, valor: string) {
    setValores((v) => ({ ...v, [campo]: valor }));
    if (campo !== "role") setErros((e) => ({ ...e, [campo]: undefined }));
    setAviso((a) => (a?.tipo === "erro" ? null : a));
  }

  async function criar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const encontrados = validarNovoUsuario(valores);
    setErros(encontrados);
    if (Object.keys(encontrados).length > 0) {
      setAviso({ tipo: "erro", texto: "corrija os campos destacados" });
      return;
    }
    setEnviando(true);
    setAviso(null);
    try {
      const criado = await apiFetch<Usuario>("/admin/users", { method: "POST", body: JSON.stringify(valores) });
      onCriado(criado);
      setValores(NOVO_VAZIO);
      setVersao((n) => n + 1);
      setAviso({ tipo: "ok", texto: `usuário "${criado.username}" criado` });
    } catch (erro) {
      setAviso({ tipo: "erro", texto: mensagem(erro) });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={criar} noValidate className="flex max-w-2xl flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">Novo usuário</h2>
      <fieldset disabled={enviando} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="novo-username" className="font-medium">
            Usuário
          </label>
          <input
            id="novo-username"
            value={valores.username}
            onChange={(e) => alterar("username", e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={erros.username ? true : undefined}
            aria-describedby={erros.username ? "novo-username-erro" : undefined}
            className={`rounded border px-3 py-2 ${erros.username ? "border-red-400" : "border-slate-300"}`}
          />
          <p className="text-xs text-slate-500">3 a 64 caracteres: letras sem acento, números, ponto, hífen ou sublinhado</p>
          {erros.username && (
            <p id="novo-username-erro" className="text-xs text-red-700">
              {erros.username}
            </p>
          )}
        </div>
        <CampoSenha
          key={versao}
          id="novo-password"
          rotulo="Senha"
          valor={valores.password}
          erro={erros.password}
          onChange={(valor) => alterar("password", valor)}
        />
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="novo-role" className="font-medium">
            Papel
          </label>
          <select
            id="novo-role"
            value={valores.role}
            onChange={(e) => alterar("role", e.target.value)}
            className="w-48 rounded border border-slate-300 px-3 py-2"
          >
            <option value="user">usuário</option>
            <option value="admin">administrador</option>
          </select>
        </div>
        <AvisoTexto aviso={aviso} />
        <div>
          <button
            type="submit"
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {enviando ? "criando…" : "Criar usuário"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

interface LinhaUsuarioProps {
  usuario: Usuario;
  proprio: boolean;
  onAtualizado: (usuario: Usuario) => void;
}

function LinhaUsuario({ usuario, proprio, onAtualizado }: LinhaUsuarioProps) {
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [redefinindo, setRedefinindo] = useState(false);
  const [novaSenha, setNovaSenha] = useState("");
  const [erroSenha, setErroSenha] = useState<string | undefined>(undefined);

  useLayoutEffect(
    () => () => {
      setOcupado(false);
      setAviso(null);
      setRedefinindo(false);
      setNovaSenha("");
      setErroSenha(undefined);
    },
    [],
  );

  async function alterar(patch: UsuarioPatch, sucesso: string): Promise<boolean> {
    setOcupado(true);
    setAviso(null);
    try {
      const atualizado = await apiFetch<Usuario>(`/admin/users/${encodeURIComponent(usuario.id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      onAtualizado(atualizado);
      setAviso({ tipo: "ok", texto: sucesso });
      return true;
    } catch (erro) {
      setAviso({ tipo: "erro", texto: mensagem(erro) });
      return false;
    } finally {
      setOcupado(false);
    }
  }

  function alternarAtivo() {
    const pergunta = usuario.active
      ? `Desativar "${usuario.username}"? O login fica bloqueado e as sessões ativas dele são encerradas.`
      : `Reativar "${usuario.username}"? O login volta a ser permitido.`;
    if (!window.confirm(pergunta)) return;
    void alterar({ active: !usuario.active }, usuario.active ? "usuário desativado" : "usuário reativado");
  }

  function alternarPapel() {
    const role: Papel = usuario.role === "admin" ? "user" : "admin";
    void alterar({ role }, `papel alterado para ${ROTULO_PAPEL[role]}`);
  }

  async function redefinirSenha(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const erro = validarSenha(novaSenha);
    setErroSenha(erro ?? undefined);
    if (erro) return;
    if (await alterar({ password: novaSenha }, "senha redefinida; as sessões ativas do usuário foram encerradas")) {
      setNovaSenha("");
      setRedefinindo(false);
    }
  }

  function alternarRedefinicao() {
    setRedefinindo((r) => !r);
    setNovaSenha("");
    setErroSenha(undefined);
  }

  return (
    <Fragment>
      <tr className="border-t border-slate-200 align-top">
        <td className="px-3 py-2 font-medium">
          {usuario.username}
          {proprio && <span className="ml-2 text-xs font-normal text-slate-500">(você)</span>}
        </td>
        <td className="px-3 py-2">{ROTULO_PAPEL[usuario.role]}</td>
        <td className="px-3 py-2">
          <span className={usuario.active ? "text-green-700" : "text-slate-500"}>{usuario.active ? "ativo" : "desativado"}</span>
        </td>
        <td className="px-3 py-2 text-slate-600">{new Date(usuario.createdAt).toLocaleString("pt-BR")}</td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-2">
            {!proprio && (
              <button type="button" onClick={alternarAtivo} disabled={ocupado} className={CLASSE_BOTAO}>
                {usuario.active ? "desativar" : "ativar"}
              </button>
            )}
            {!proprio && (
              <button type="button" onClick={alternarPapel} disabled={ocupado} className={CLASSE_BOTAO}>
                {usuario.role === "admin" ? "tornar usuário" : "tornar admin"}
              </button>
            )}
            <button type="button" onClick={alternarRedefinicao} disabled={ocupado} className={CLASSE_BOTAO}>
              {redefinindo ? "cancelar" : "redefinir senha"}
            </button>
          </div>
        </td>
      </tr>
      {(redefinindo || aviso) && (
        <tr>
          <td colSpan={5} className="px-3 pb-3">
            <div className="flex max-w-2xl flex-col gap-2">
              {redefinindo && (
                <form onSubmit={redefinirSenha} noValidate className="flex flex-col gap-2 rounded border border-slate-200 bg-slate-50 p-3">
                  <fieldset disabled={ocupado} className="flex flex-col gap-2">
                    <CampoSenha
                      id={`senha-${usuario.id}`}
                      rotulo={`Nova senha de ${usuario.username}`}
                      valor={novaSenha}
                      erro={erroSenha}
                      onChange={(valor) => {
                        setNovaSenha(valor);
                        setErroSenha(undefined);
                      }}
                    />
                    <div>
                      <button
                        type="submit"
                        className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                      >
                        {ocupado ? "salvando…" : "salvar nova senha"}
                      </button>
                    </div>
                  </fieldset>
                </form>
              )}
              <AvisoTexto aviso={aviso} />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function UsersPanel() {
  const sessao = use(SessaoContext);
  const admin = sessao.role === "admin";
  const habilitado = admin && !sessao.offline;
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);

  useLayoutEffect(
    () => () => {
      setUsuarios(null);
      setErroCarga(null);
    },
    [],
  );

  useEffect(() => {
    if (!habilitado) return;
    let ativo = true;
    apiFetch<Usuario[]>("/admin/users").then(
      (lista) => {
        if (!ativo) return;
        setUsuarios(lista);
        setErroCarga(null);
      },
      (erro: unknown) => {
        if (ativo) setErroCarga(mensagem(erro));
      },
    );
    return () => {
      ativo = false;
    };
  }, [habilitado]);

  function substituir(atualizado: Usuario) {
    setUsuarios((lista) => lista?.map((u) => (u.id === atualizado.id ? atualizado : u)) ?? lista);
  }

  if (!admin) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Usuários</h1>
        <p role="alert" className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Acesso restrito: apenas administradores podem gerenciar usuários.
        </p>
      </div>
    );
  }

  if (sessao.offline) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Usuários</h1>
        <p role="alert" className="rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
          Modo offline: a gestão de usuários depende do servidor central e fica desabilitada até a conexão voltar.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Usuários</h1>
      {erroCarga && (
        <p role="alert" className="text-sm text-red-800">
          {erroCarga}
        </p>
      )}
      {!usuarios && !erroCarga && <p className="text-sm text-slate-500">carregando usuários…</p>}
      {usuarios && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">Usuário</th>
                <th className="px-3 py-2 font-medium">Papel</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Criado em</th>
                <th className="px-3 py-2 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((usuario) => (
                <LinhaUsuario
                  key={usuario.id}
                  usuario={usuario}
                  proprio={usuario.username === sessao.username}
                  onAtualizado={substituir}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NovoUsuarioForm onCriado={(criado) => setUsuarios((lista) => (lista ? [...lista, criado] : [criado]))} />
    </div>
  );
}
