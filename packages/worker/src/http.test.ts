import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ProxyAgent, Socks5ProxyAgent } from "undici";
import { criarDispatcher, criarFetch, descreverFalhaDeRede } from "./http.js";

let proxy: Server | null = null;

afterEach(async () => {
  if (!proxy) return;
  const { promise, resolve } = Promise.withResolvers<void>();
  proxy.closeAllConnections();
  proxy.close(() => resolve());
  proxy = null;
  await promise;
});

describe("criarDispatcher", () => {
  it("sem proxy usa o dispatcher padrão", () => {
    expect(criarDispatcher(undefined)).toBeUndefined();
  });

  it.each(["http://proxy:8080", "https://usuario:senha@proxy:8443"])(
    "usa ProxyAgent para %s",
    (url) => {
      expect(criarDispatcher(url)).toBeInstanceOf(ProxyAgent);
    },
  );

  it("usa Socks5ProxyAgent para socks5", () => {
    expect(criarDispatcher("socks5://usuario:senha@proxy:1080")).toBeInstanceOf(Socks5ProxyAgent);
  });
});

describe("criarFetch", () => {
  it("encaminha a requisição pelo proxy http", async () => {
    const recebidas: string[] = [];
    const servidor = createServer((req, res) => {
      recebidas.push(`${req.method} ${req.url}`);
      res.end("via-proxy");
    });
    proxy = servidor;
    const { promise, resolve } = Promise.withResolvers<number>();
    servidor.listen(0, "127.0.0.1", () => resolve((servidor.address() as AddressInfo).port));
    const porta = await promise;

    const resposta = await criarFetch(`http://127.0.0.1:${porta}`)("http://jogo.invalid/api/x", {
      method: "POST",
      body: "{}",
    });

    expect(await resposta.text()).toBe("via-proxy");
    expect(recebidas).toEqual(["POST http://jogo.invalid/api/x"]);
  });

  it("aborta a requisição depois do timeout", async () => {
    const servidor = createServer(() => {});
    proxy = servidor;
    const { promise, resolve } = Promise.withResolvers<number>();
    servidor.listen(0, "127.0.0.1", () => resolve((servidor.address() as AddressInfo).port));
    const porta = await promise;

    const erro = await criarFetch(undefined, 50)(`http://127.0.0.1:${porta}/lento`).then(
      () => null,
      (e: unknown) => e,
    );

    expect(erro).not.toBeNull();
    expect(descreverFalhaDeRede(erro)).toBe("TimeoutError");
  });
});
