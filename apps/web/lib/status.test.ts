import { describe, expect, it } from "vitest";
import type { Account, EstadoJogo, WorkerSnapshot } from "./api";
import { badgeDoStatus, erroDoWorker, estaRodando, formatarUptime, mesclarContas } from "./status";

function conta(id: string): Account {
  return { id, label: `conta ${id}`, pokeidleUser: `user-${id}`, proxyUrl: null, createdAt: "2026-10-01T00:00:00.000Z" };
}

function worker(accountId: string, extra: Partial<WorkerSnapshot> = {}): WorkerSnapshot {
  return {
    id: `c-${accountId}`,
    accountId,
    state: "running",
    health: "none",
    startedAt: "2026-10-11T12:00:00.000Z",
    restartCount: 0,
    desired: "running",
    backoffAtual: 0,
    degraded: false,
    lastError: null,
    jogo: null,
    ...extra,
  };
}

function jogo(state: EstadoJogo["state"], extra: Partial<EstadoJogo> = {}): EstadoJogo {
  return { state, lastAction: null, lastError: null, ...extra };
}

describe("mesclarContas", () => {
  it("associa worker por accountId e deixa conta sem snapshot como parada", () => {
    const w = worker("a");
    const linhas = mesclarContas([conta("a"), conta("b")], [w]);

    expect(linhas).toEqual([
      { accountId: "a", account: conta("a"), worker: w },
      { accountId: "b", account: conta("b"), worker: null },
    ]);
  });

  it("inclui workers de contas desconhecidas ao final", () => {
    const orfao = worker("x");
    const linhas = mesclarContas([conta("a")], [orfao]);

    expect(linhas.map((l) => [l.accountId, l.account?.id ?? null, l.worker?.id ?? null])).toEqual([
      ["a", "a", null],
      ["x", null, "c-x"],
    ]);
  });

  it("sem contas carregadas mostra só os workers do snapshot", () => {
    expect(mesclarContas([], [worker("x")]).map((l) => l.accountId)).toEqual(["x"]);
  });
});

describe("badgeDoStatus", () => {
  it("sem worker é parado", () => {
    expect(badgeDoStatus(null)).toEqual({ tom: "cinza", texto: "parado" });
  });

  it("degraded tem prioridade máxima e usa backoffAtual em segundos", () => {
    const w = worker("a", { degraded: true, backoffAtual: 300_000, jogo: jogo("in-game") });
    expect(badgeDoStatus(w)).toEqual({ tom: "vermelho", texto: "degradado — reiniciando em 300s" });
  });

  it("segue a prioridade dos estados do jogo", () => {
    expect(badgeDoStatus(worker("a", { jogo: jogo("needs-login") }))).toEqual({ tom: "laranja", texto: "precisa de login" });
    expect(badgeDoStatus(worker("a", { jogo: jogo("error") }))).toEqual({ tom: "vermelho", texto: "erro" });
    expect(badgeDoStatus(worker("a", { jogo: jogo("in-game") }))).toEqual({ tom: "verde", texto: "jogando" });
    expect(badgeDoStatus(worker("a", { jogo: jogo("authenticating") }))).toEqual({ tom: "azul", texto: "iniciando" });
    expect(badgeDoStatus(worker("a", { jogo: jogo("booting") }))).toEqual({ tom: "azul", texto: "iniciando" });
  });

  it("container rodando sem estado do jogo é sem resposta", () => {
    expect(badgeDoStatus(worker("a"))).toEqual({ tom: "cinza", texto: "sem resposta" });
  });

  it("container parado é parado", () => {
    expect(badgeDoStatus(worker("a", { state: "exited", desired: "stopped" }))).toEqual({ tom: "cinza", texto: "parado" });
  });
});

describe("estaRodando", () => {
  it("considera rodando o container running ou desejado running", () => {
    expect(estaRodando(null)).toBe(false);
    expect(estaRodando(worker("a"))).toBe(true);
    expect(estaRodando(worker("a", { state: "exited", desired: "running" }))).toBe(true);
    expect(estaRodando(worker("a", { state: "exited", desired: "stopped" }))).toBe(false);
    expect(estaRodando(worker("a", { state: "exited", desired: "none" }))).toBe(false);
  });
});

describe("erroDoWorker", () => {
  it("prefere o erro do supervisor ao do jogo", () => {
    expect(erroDoWorker(worker("a", { lastError: "sup", jogo: jogo("error", { lastError: "jogo" }) }))).toBe("sup");
    expect(erroDoWorker(worker("a", { jogo: jogo("error", { lastError: "jogo" }) }))).toBe("jogo");
    expect(erroDoWorker(worker("a"))).toBeNull();
    expect(erroDoWorker(null)).toBeNull();
  });
});

describe("formatarUptime", () => {
  const inicio = "2026-10-11T12:00:00.000Z";
  const base = Date.parse(inicio);

  it("formata segundos, minutos, horas e dias", () => {
    expect(formatarUptime(inicio, base + 7_000)).toBe("7s");
    expect(formatarUptime(inicio, base + 65_000)).toBe("1m 05s");
    expect(formatarUptime(inicio, base + 3_600_000 + 2 * 60_000 + 3_000)).toBe("1h 02m 03s");
    expect(formatarUptime(inicio, base + 2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000)).toBe("2d 3h 04m");
  });

  it("sem início ou com data inválida mostra traço", () => {
    expect(formatarUptime(null, base)).toBe("—");
    expect(formatarUptime("lixo", base)).toBe("—");
  });

  it("não fica negativo com relógio adiantado no servidor", () => {
    expect(formatarUptime(inicio, base - 5_000)).toBe("0s");
  });
});
