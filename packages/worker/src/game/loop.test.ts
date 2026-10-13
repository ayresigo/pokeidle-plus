import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { HealthState } from "../health.js";
import type { ClienteJogo, EstadoJogo } from "./client.js";
import {
  atrasoComJitter,
  criarAcoes,
  drenar,
  runGameLoop,
  type Acao,
  type GameLoop,
} from "./loop.js";

const cliente = { nome: "cliente-fake" };
type Cliente = typeof cliente;

let health: HealthState;
let loop: GameLoop | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  health = new HealthState(null);
});

afterEach(async () => {
  if (loop) {
    const parando = loop.parar(0);
    await vi.runOnlyPendingTimersAsync();
    await parando;
    loop.concluido.catch(() => {});
  }
  loop = null;
  vi.useRealTimers();
});

function acao(
  nome: string,
  executar: Acao<Cliente>["executar"],
): Acao<Cliente> & { executar: Mock } {
  return { nome, executar: vi.fn(executar) };
}

describe("atrasoComJitter", () => {
  it("cobre os extremos do intervalo", () => {
    expect(atrasoComJitter(1000, 2000, () => 0)).toBe(1000);
    expect(atrasoComJitter(1000, 2000, () => 0.9999999)).toBe(2000);
    expect(atrasoComJitter(1000, 2000, () => 0.5)).toBe(1500);
  });

  it("fica dentro do intervalo com Math.random", () => {
    for (let i = 0; i < 2000; i += 1) {
      const atraso = atrasoComJitter(500, 800);
      expect(atraso).toBeGreaterThanOrEqual(500);
      expect(atraso).toBeLessThanOrEqual(800);
      expect(Number.isInteger(atraso)).toBe(true);
    }
  });

  it("aceita intervalo degenerado", () => {
    expect(atrasoComJitter(700, 700, () => 0.9)).toBe(700);
  });
});

describe("runGameLoop", () => {
  it("espera o jitter sorteado antes de cada ação", async () => {
    const a = acao("a", async () => {});
    const sorteios = [0.5, 0];
    loop = runGameLoop(cliente, [a], {
      minDelayMs: 1000,
      maxDelayMs: 2000,
      health,
      random: () => sorteios.shift() ?? 0,
    });

    await vi.advanceTimersByTimeAsync(1499);
    expect(a.executar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(a.executar).toHaveBeenCalledTimes(1);
    expect(a.executar).toHaveBeenCalledWith(cliente);

    await vi.advanceTimersByTimeAsync(999);
    expect(a.executar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(a.executar).toHaveBeenCalledTimes(2);
  });

  it("faz rodízio das ações e registra lastAction", async () => {
    const ordem: string[] = [];
    const a = acao("garantir-hunt", async () => {
      ordem.push("a");
      return "em hunt caterpie";
    });
    const b = acao("watchdog", async () => {
      ordem.push("b");
    });
    loop = runGameLoop(cliente, [a, b], { minDelayMs: 100, maxDelayMs: 100, health });

    await vi.advanceTimersByTimeAsync(100);
    expect(health.snapshot().lastAction).toBe("garantir-hunt: em hunt caterpie");
    await vi.advanceTimersByTimeAsync(100);
    expect(health.snapshot().lastAction).toBe("watchdog");
    await vi.advanceTimersByTimeAsync(200);
    expect(ordem).toEqual(["a", "b", "a", "b"]);
  });

  it("erro de ação não derruba o loop e vai para lastError", async () => {
    let chamadas = 0;
    const a = acao("instavel", async () => {
      chamadas += 1;
      if (chamadas === 1) throw new Error("falha boba");
    });
    loop = runGameLoop(cliente, [a], { minDelayMs: 10, maxDelayMs: 10, health });

    await vi.advanceTimersByTimeAsync(10);
    expect(health.snapshot().lastError).toBe("instavel: falha boba");
    await vi.advanceTimersByTimeAsync(10);
    expect(a.executar).toHaveBeenCalledTimes(2);
    expect(health.snapshot().lastAction).toBe("instavel");
  });

  it("5 erros consecutivos propagam", async () => {
    const a = acao("quebrada", async () => {
      throw new Error("sempre falha");
    });
    loop = runGameLoop(cliente, [a], { minDelayMs: 10, maxDelayMs: 10, health });
    const resultado = loop.concluido.then(
      () => null,
      (erro: unknown) => erro,
    );

    await vi.advanceTimersByTimeAsync(40);
    expect(a.executar).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(10);

    const erro = await resultado;
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toContain("5 erros consecutivos");
    expect((erro as Error).message).toContain("sempre falha");
    await vi.advanceTimersByTimeAsync(100);
    expect(a.executar).toHaveBeenCalledTimes(5);
    loop = null;
  });

  it("sucesso reseta a contagem de erros consecutivos", async () => {
    const roteiro = [true, true, true, true, false, true, true, true, true, false];
    const a = acao("alternada", async () => {
      if (roteiro.shift() ?? false) throw new Error("falhou");
    });
    loop = runGameLoop(cliente, [a], { minDelayMs: 10, maxDelayMs: 10, health });
    let rejeitado = false;
    loop.concluido.catch(() => {
      rejeitado = true;
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(a.executar).toHaveBeenCalledTimes(10);
    expect(rejeitado).toBe(false);
  });

  it("parar espera a ação em voo e não agenda novas", async () => {
    const emVoo = Promise.withResolvers<void>();
    const a = acao("lenta", () => emVoo.promise);
    loop = runGameLoop(cliente, [a], { minDelayMs: 10, maxDelayMs: 10, health });

    await vi.advanceTimersByTimeAsync(10);
    expect(a.executar).toHaveBeenCalledTimes(1);

    let terminou: boolean | null = null;
    void loop.parar(20_000).then((ok) => {
      terminou = ok;
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(terminou).toBeNull();

    emVoo.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(terminou).toBe(true);
    await loop.concluido;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(a.executar).toHaveBeenCalledTimes(1);
    loop = null;
  });

  it("parar desiste da ação em voo no timeout", async () => {
    const a = acao("travada", () => new Promise<void>(() => {}));
    loop = runGameLoop(cliente, [a], { minDelayMs: 10, maxDelayMs: 10, health });
    await vi.advanceTimersByTimeAsync(10);

    let terminou: boolean | null = null;
    void loop.parar(20_000).then((ok) => {
      terminou = ok;
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(terminou).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(terminou).toBe(false);
    loop = null;
  });

  it("parar durante a espera cancela a próxima ação na hora", async () => {
    const a = acao("nunca", async () => {});
    loop = runGameLoop(cliente, [a], { minDelayMs: 10_000, maxDelayMs: 10_000, health });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(loop.parar(20_000)).resolves.toBe(true);
    await loop.concluido;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(a.executar).not.toHaveBeenCalled();
    loop = null;
  });
});

describe("drenar", () => {
  it("espera a ação em voo até o timeout e só então desconecta, para o auth e fecha o health", async () => {
    const eventos: string[] = [];
    const a = acao("lenta", () => new Promise<void>(() => {}));
    loop = runGameLoop(cliente, [a], { minDelayMs: 10, maxDelayMs: 10, health });
    await vi.advanceTimersByTimeAsync(10);

    let fim: { acaoConcluida: boolean } | null = null;
    void drenar({
      loop,
      client: {
        desconectar: async () => {
          eventos.push("desconectar");
        },
      },
      auth: { parar: () => eventos.push("auth.parar") },
      server: {
        close: async () => {
          eventos.push("server.close");
        },
      },
      timeoutMs: 20_000,
    }).then((r) => {
      fim = r;
    });

    await vi.advanceTimersByTimeAsync(19_000);
    expect(eventos).toEqual([]);
    expect(fim).toBeNull();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(eventos).toEqual(["desconectar", "auth.parar", "server.close"]);
    expect(fim).toEqual({ acaoConcluida: false });
    loop = null;
  });

  it("sem loop nem cliente só para o auth e fecha o health", async () => {
    const eventos: string[] = [];
    await expect(
      drenar({
        loop: null,
        client: null,
        auth: { parar: () => eventos.push("auth.parar") },
        server: {
          close: async () => {
            eventos.push("server.close");
          },
        },
        timeoutMs: 20_000,
      }),
    ).resolves.toEqual({ acaoConcluida: true });
    expect(eventos).toEqual(["auth.parar", "server.close"]);
  });

  it("SIGTERM antes do health subir: tolera server nulo", async () => {
    const eventos: string[] = [];
    await expect(
      drenar({
        loop: null,
        client: null,
        auth: { parar: () => eventos.push("auth.parar") },
        server: null,
        timeoutMs: 20_000,
      }),
    ).resolves.toEqual({ acaoConcluida: true });
    expect(eventos).toEqual(["auth.parar"]);
  });
});

class ClienteFake implements ClienteJogo {
  conectado = true;
  huntAlvo: string | null = "caterpie";
  readonly estado: EstadoJogo = {
    conectadoEm: Date.now(),
    huntAtual: null,
    huntDesde: null,
    huntSelectEnviadoEm: null,
    ultimoKillEm: null,
    ultimoKill: null,
    kills: 0,
    capturas: 0,
  };
  readonly comandos: string[] = [];
  readonly selecionarHunt = vi.fn((slug: string) => {
    this.comandos.push(`hunt.select ${slug}`);
    this.estado.huntSelectEnviadoEm = Date.now();
  });
}

function acoesPorNome(): Record<string, Acao<ClienteJogo>> {
  return Object.fromEntries(criarAcoes({ health }).map((a) => [a.nome, a]));
}

describe("ação garantir-hunt", () => {
  it("desconectado só aguarda", async () => {
    const c = new ClienteFake();
    c.conectado = false;
    await expect(acoesPorNome()["garantir-hunt"]!.executar(c)).resolves.toBe("aguardando conexão");
    expect(c.selecionarHunt).not.toHaveBeenCalled();
  });

  it("fora de hunt seleciona o huntAlvo resolvido", async () => {
    const c = new ClienteFake();
    await expect(acoesPorNome()["garantir-hunt"]!.executar(c)).resolves.toBe("hunt.select caterpie");
    expect(c.comandos).toEqual(["hunt.select caterpie"]);
  });

  it("em hunt não envia nada", async () => {
    const c = new ClienteFake();
    c.estado.huntAtual = "caterpie";
    await expect(acoesPorNome()["garantir-hunt"]!.executar(c)).resolves.toBe("em hunt caterpie");
    expect(c.selecionarHunt).not.toHaveBeenCalled();
  });

  it("sem huntAlvo fica idle", async () => {
    const c = new ClienteFake();
    c.huntAlvo = null;
    await expect(acoesPorNome()["garantir-hunt"]!.executar(c)).resolves.toBe("idle: sem hunt alvo");
    expect(c.selecionarHunt).not.toHaveBeenCalled();
    expect(health.snapshot().lastError).toContain("sem hunt alvo");
  });

  it("não reenvia hunt.select antes de 10s sem campo.init", async () => {
    const garantir = acoesPorNome()["garantir-hunt"]!;
    const c = new ClienteFake();
    await garantir.executar(c);
    vi.advanceTimersByTime(9_999);
    await expect(garantir.executar(c)).resolves.toBe("aguardando campo.init");
    vi.advanceTimersByTime(1);
    await garantir.executar(c);
    expect(c.selecionarHunt).toHaveBeenCalledTimes(2);
  });

  it("3 hunt.select sem campo.init avisam que a hunt foi ignorada; campo.init zera", async () => {
    const garantir = acoesPorNome()["garantir-hunt"]!;
    const c = new ClienteFake();
    for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
      expect(health.snapshot().lastError).toBeNull();
      await garantir.executar(c);
      vi.advanceTimersByTime(10_000);
    }
    expect(c.selecionarHunt).toHaveBeenCalledTimes(3);
    expect(health.snapshot().lastError).toBe("hunt inválida ou ignorada: caterpie");

    c.estado.huntAtual = "caterpie";
    await garantir.executar(c);
    c.estado.huntAtual = null;
    c.estado.huntSelectEnviadoEm = null;
    health.setLastError(null);
    await garantir.executar(c);
    vi.advanceTimersByTime(10_000);
    await garantir.executar(c);
    expect(c.selecionarHunt).toHaveBeenCalledTimes(5);
    expect(health.snapshot().lastError).toBeNull();
  });
});

describe("ação watchdog-stall", () => {
  it("10 min sem kill com socket vivo → hunt.select", async () => {
    const watchdog = acoesPorNome()["watchdog-stall"]!;
    const c = new ClienteFake();
    c.estado.huntAtual = "caterpie";
    c.estado.huntDesde = Date.now();
    c.estado.ultimoKillEm = Date.now();

    vi.advanceTimersByTime(9 * 60_000 + 59_999);
    await watchdog.executar(c);
    expect(c.comandos).toEqual([]);

    vi.advanceTimersByTime(1);
    await expect(watchdog.executar(c)).resolves.toBe("stall em caterpie: hunt.select");
    expect(c.comandos).toEqual(["hunt.select caterpie"]);
  });

  it("kill recente adia o watchdog; sem hunt ou desconectado não age", async () => {
    const watchdog = acoesPorNome()["watchdog-stall"]!;
    const c = new ClienteFake();
    c.estado.huntAtual = "caterpie";
    c.estado.huntDesde = Date.now();
    vi.advanceTimersByTime(9 * 60_000);
    c.estado.ultimoKillEm = Date.now();
    vi.advanceTimersByTime(5 * 60_000);
    await watchdog.executar(c);

    const semHunt = new ClienteFake();
    vi.advanceTimersByTime(20 * 60_000);
    await watchdog.executar(semHunt);

    const caido = new ClienteFake();
    caido.estado.huntAtual = "caterpie";
    caido.estado.huntDesde = 0;
    caido.conectado = false;
    await watchdog.executar(caido);

    expect([...c.comandos, ...semHunt.comandos, ...caido.comandos]).toEqual([]);
  });

  it("após 3 recuperações sem kill avisa no lastError e espaça para 1h; kill zera", async () => {
    const watchdog = acoesPorNome()["watchdog-stall"]!;
    const c = new ClienteFake();
    const entrarNaHunt = () => {
      c.estado.huntAtual = "caterpie";
      c.estado.huntDesde = Date.now();
    };
    entrarNaHunt();
    for (let rodada = 1; rodada <= 3; rodada += 1) {
      vi.advanceTimersByTime(10 * 60_000);
      await watchdog.executar(c);
      entrarNaHunt();
    }
    expect(c.selecionarHunt).toHaveBeenCalledTimes(3);
    expect(health.snapshot().lastError).toBe("hunt caterpie sem kills há 30min");

    vi.advanceTimersByTime(60 * 60_000 - 1);
    await expect(watchdog.executar(c)).resolves.toBe("hunt caterpie ativa");
    vi.advanceTimersByTime(1);
    await watchdog.executar(c);
    expect(c.selecionarHunt).toHaveBeenCalledTimes(4);
    entrarNaHunt();

    vi.advanceTimersByTime(60_000);
    c.estado.ultimoKillEm = Date.now();
    vi.advanceTimersByTime(10 * 60_000);
    await watchdog.executar(c);
    expect(c.selecionarHunt).toHaveBeenCalledTimes(5);
  });

  it("dentro do runGameLoop o stall dispara hunt.select", async () => {
    const c = new ClienteFake();
    c.estado.huntAtual = "caterpie";
    c.estado.huntDesde = Date.now();
    loop = runGameLoop(c, criarAcoes({ health }), {
      minDelayMs: 30_000,
      maxDelayMs: 30_000,
      health,
    });
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(c.selecionarHunt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(c.selecionarHunt).toHaveBeenCalledTimes(1);
    expect(c.comandos.slice(0, 1)).toEqual(["hunt.select caterpie"]);
  });
});
