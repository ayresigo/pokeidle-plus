import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("buildApp", () => {
  it("responde GET /health com status ok", async () => {
    const { app } = buildApp();
    const resposta = await app.inject({ method: "GET", url: "/health" });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({ status: "ok" });
    await app.close();
  });
});
