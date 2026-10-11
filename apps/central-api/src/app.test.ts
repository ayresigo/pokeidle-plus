import { describe, it, expect } from "vitest";

process.env.JWT_SECRET ??= "segredo-teste-app";

import { buildApp } from "./app.js";

describe("health", () => {
  it("GET /health retorna ok", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});
