import type { Account, WorkerSnapshot } from "./api";

export interface LinhaConta {
  accountId: string;
  account: Account | null;
  worker: WorkerSnapshot | null;
}

export type TomBadge = "vermelho" | "laranja" | "verde" | "azul" | "cinza";

export interface Badge {
  tom: TomBadge;
  texto: string;
}

export function mesclarContas(accounts: Account[], snapshot: WorkerSnapshot[]): LinhaConta[] {
  const workers = new Map(snapshot.map((worker) => [worker.accountId, worker]));
  const linhas: LinhaConta[] = accounts.map((account) => ({
    accountId: account.id,
    account,
    worker: workers.get(account.id) ?? null,
  }));
  const conhecidas = new Set(accounts.map((account) => account.id));
  for (const worker of snapshot) {
    if (!conhecidas.has(worker.accountId)) {
      linhas.push({ accountId: worker.accountId, account: null, worker });
    }
  }
  return linhas;
}

export function estaRodando(worker: WorkerSnapshot | null): boolean {
  return worker !== null && (worker.state === "running" || worker.desired === "running");
}

export function badgeDoStatus(worker: WorkerSnapshot | null): Badge {
  if (worker === null) return { tom: "cinza", texto: "parado" };
  if (worker.degraded) {
    return {
      tom: "vermelho",
      texto: `degradado — reiniciando em ${Math.round(worker.backoffAtual / 1000)}s`,
    };
  }
  switch (worker.jogo?.state) {
    case "needs-login":
      return { tom: "laranja", texto: "precisa de login" };
    case "error":
      return { tom: "vermelho", texto: "erro" };
    case "in-game":
      return { tom: "verde", texto: "jogando" };
    case "authenticating":
    case "booting":
      return { tom: "azul", texto: "iniciando" };
  }
  if (worker.state === "running") return { tom: "cinza", texto: "sem resposta" };
  return { tom: "cinza", texto: "parado" };
}

export function erroDoWorker(worker: WorkerSnapshot | null): string | null {
  return worker?.lastError ?? worker?.jogo?.lastError ?? null;
}

export function formatarUptime(startedAt: string | null, agora: number): string {
  if (startedAt === null) return "—";
  const inicio = Date.parse(startedAt);
  if (Number.isNaN(inicio)) return "—";
  const total = Math.max(0, Math.floor((agora - inicio) / 1000));
  const dias = Math.floor(total / 86_400);
  const horas = Math.floor((total % 86_400) / 3_600);
  const minutos = Math.floor((total % 3_600) / 60);
  const segundos = total % 60;
  const dois = (n: number) => String(n).padStart(2, "0");
  if (dias > 0) return `${dias}d ${horas}h ${dois(minutos)}m`;
  if (horas > 0) return `${horas}h ${dois(minutos)}m ${dois(segundos)}s`;
  if (minutos > 0) return `${minutos}m ${dois(segundos)}s`;
  return `${segundos}s`;
}
