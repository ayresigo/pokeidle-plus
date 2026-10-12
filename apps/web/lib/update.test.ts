import { describe, expect, it } from "vitest";
import type { UpdateStatus } from "./api";
import { TEXTO_ESTADO, acoesUpdate, emAndamento, mensagemErroUpdate } from "./update";

function status(extra: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    latestChangelog: "- novidades",
    latestImageDigest: null,
    updateAvailable: true,
    autoUpdate: false,
    lastCheck: "2026-10-11T00:00:00.000Z",
    lastError: null,
    state: "idle",
    rollbackDisponivel: false,
    rollbackVersao: null,
    ...extra,
  };
}

describe("TEXTO_ESTADO", () => {
  it("tem texto em PT-BR para todos os estados", () => {
    expect(TEXTO_ESTADO).toEqual({
      idle: "pronto",
      checking: "verificando atualizações",
      updating: "atualizando",
      update_failed: "falha na última atualização",
      rolling_back: "voltando para a versão anterior",
    });
  });
});

describe("emAndamento", () => {
  it("só updating e rolling_back estão em andamento", () => {
    expect(emAndamento(status({ state: "updating" }))).toBe(true);
    expect(emAndamento(status({ state: "rolling_back" }))).toBe(true);
    expect(emAndamento(status({ state: "checking" }))).toBe(false);
    expect(emAndamento(status({ state: "idle" }))).toBe(false);
    expect(emAndamento(status({ state: "update_failed" }))).toBe(false);
  });
});

describe("acoesUpdate", () => {
  it("com atualização disponível e online habilita aplicar e auto-update", () => {
    expect(acoesUpdate(status(), false)).toEqual({
      aplicar: { habilitado: true, motivo: null },
      rollback: { habilitado: false, motivo: "nenhuma versão anterior registrada" },
      autoUpdate: { habilitado: true, motivo: null },
    });
  });

  it("sem atualização desabilita aplicar com motivo", () => {
    expect(acoesUpdate(status({ updateAvailable: false }), false).aplicar).toEqual({
      habilitado: false,
      motivo: "nenhuma atualização disponível",
    });
  });

  it("offline bloqueia aplicar e auto-update mas mantém rollback", () => {
    const acoes = acoesUpdate(status({ rollbackDisponivel: true, rollbackVersao: "0.9.0" }), true);
    expect(acoes.aplicar).toEqual({ habilitado: false, motivo: "indisponível em modo offline" });
    expect(acoes.autoUpdate).toEqual({ habilitado: false, motivo: "indisponível em modo offline" });
    expect(acoes.rollback).toEqual({ habilitado: true, motivo: null });
  });

  it("durante operação tudo fica desabilitado", () => {
    for (const state of ["updating", "rolling_back", "checking"] as const) {
      const acoes = acoesUpdate(status({ state, rollbackDisponivel: true }), false);
      expect(acoes.aplicar.habilitado).toBe(false);
      expect(acoes.rollback.habilitado).toBe(false);
      expect(acoes.autoUpdate).toEqual({ habilitado: false, motivo: "aguarde a operação em andamento" });
    }
  });

  it("após falha permite tentar de novo e voltar", () => {
    const acoes = acoesUpdate(status({ state: "update_failed", rollbackDisponivel: true }), false);
    expect(acoes.aplicar.habilitado).toBe(true);
    expect(acoes.rollback.habilitado).toBe(true);
  });
});

describe("mensagemErroUpdate", () => {
  it("mapeia os status de apply", () => {
    expect(mensagemErroUpdate("apply", 400, "x")).toBe("nenhuma atualização disponível para aplicar");
    expect(mensagemErroUpdate("apply", 409, "x")).toBe("já existe uma atualização ou rollback em andamento");
    expect(mensagemErroUpdate("apply", 502, "x")).toBe("a atualização falhou; veja o erro acima");
    expect(mensagemErroUpdate("apply", 503, "x")).toMatch(/central está inalcançável/);
  });

  it("mapeia os status de rollback", () => {
    expect(mensagemErroUpdate("rollback", 404, "x")).toBe("não há versão anterior registrada para voltar");
    expect(mensagemErroUpdate("rollback", 409, "x")).toBe("já existe uma atualização ou rollback em andamento");
    expect(mensagemErroUpdate("rollback", 502, "x")).toBe("o rollback falhou; veja o erro acima");
  });

  it("status não mapeado usa a mensagem do servidor", () => {
    expect(mensagemErroUpdate("settings", 500, "boom")).toBe("falha inesperada (500): boom");
  });
});
