"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { getSession, logout, type Session } from "@/lib/api";

const INTERVALO_SESSAO_MS = 15_000;

const LINKS = [
  { href: "/", rotulo: "Dashboard" },
  { href: "/settings", rotulo: "Configurações" },
];

export default function PainelLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [sessao, setSessao] = useState<Session | null>(null);
  const [inalcancavel, setInalcancavel] = useState(false);
  const [saindo, setSaindo] = useState(false);

  useLayoutEffect(
    () => () => {
      setSessao(null);
      setInalcancavel(false);
      setSaindo(false);
    },
    [],
  );

  useEffect(() => {
    let ativo = true;
    const verificar = async () => {
      try {
        const atual = await getSession();
        if (!ativo) return;
        if (!atual.authenticated) {
          router.replace("/login");
          return;
        }
        setSessao(atual);
        setInalcancavel(false);
      } catch {
        if (ativo) setInalcancavel(true);
      }
    };
    void verificar();
    const timer = setInterval(verificar, INTERVALO_SESSAO_MS);
    return () => {
      ativo = false;
      clearInterval(timer);
    };
  }, [router]);

  async function sair() {
    setSaindo(true);
    try {
      await logout();
    } catch {
    } finally {
      router.replace("/login");
    }
  }

  if (!sessao) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-sm text-slate-500">
        {inalcancavel ? "control-plane inalcançável, tentando novamente…" : "verificando sessão…"}
      </main>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <span className="font-semibold">Multiacc PokeIdle</span>
          <nav className="flex gap-4 text-sm">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={
                  pathname === link.href
                    ? "font-medium text-slate-900"
                    : "text-slate-500 hover:text-slate-900"
                }
              >
                {link.rotulo}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            onClick={sair}
            disabled={saindo}
            className="ml-auto rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 disabled:opacity-50"
          >
            Sair
          </button>
        </div>
      </header>
      {sessao.offline && (
        <div role="status" className="border-b border-yellow-300 bg-yellow-100 px-6 py-2 text-center text-sm text-yellow-900">
          modo offline — alterações limitadas
        </div>
      )}
      {inalcancavel && (
        <div role="alert" className="border-b border-red-300 bg-red-100 px-6 py-2 text-center text-sm text-red-900">
          control-plane inalcançável
        </div>
      )}
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
