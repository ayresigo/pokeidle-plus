import { describe, expect, it } from "vitest";
import { CONFIG_IMAGEM_CONTROL_PLANE, inspectControlPlane } from "./fixtures.js";
import { planejarRecriacao, repositorioDaImagem } from "./recriacao.js";

const NOVA = "ghcr.io/ayresigo/mpw-control-plane:1.1.0";

describe("repositorioDaImagem", () => {
  it("remove tag e digest preservando porta do registry", () => {
    expect(repositorioDaImagem("ghcr.io/ayresigo/mpw-web:stable")).toBe("ghcr.io/ayresigo/mpw-web");
    expect(repositorioDaImagem("ghcr.io/ayresigo/mpw-web@sha256:abc")).toBe("ghcr.io/ayresigo/mpw-web");
    expect(repositorioDaImagem("localhost:5000/mpw-web")).toBe("localhost:5000/mpw-web");
    expect(repositorioDaImagem("localhost:5000/mpw-web:1.0.0")).toBe("localhost:5000/mpw-web");
  });
});

describe("planejarRecriacao", () => {
  const { nome, criar, redesExtras } = planejarRecriacao(
    inspectControlPlane(),
    CONFIG_IMAGEM_CONTROL_PLANE,
    NOVA,
  );

  it("mantém o mesmo nome e troca só a imagem", () => {
    expect(nome).toBe("mpw-control-plane-1");
    expect(criar.name).toBe("mpw-control-plane-1");
    expect(criar.Image).toBe(NOVA);
  });

  it("preserva env do usuário e deixa a nova imagem definir as envs dela", () => {
    expect(criar.Env).toEqual([
      "CENTRAL_API_URL=https://central.test",
      "WORKER_NETWORK=mpw",
      "AUTO_UPDATE=true",
    ]);
  });

  it("preserva labels do compose e de role, sem congelar labels da imagem antiga", () => {
    expect(criar.Labels).toEqual({
      "mpw.role": "control-plane",
      "com.docker.compose.project": "mpw",
      "com.docker.compose.service": "control-plane",
      "com.docker.compose.config-hash": "hash123",
    });
  });

  it("preserva binds, mounts, restart policy, port bindings e modo de rede", () => {
    expect(criar.HostConfig).toEqual({
      Binds: ["/var/run/docker.sock:/var/run/docker.sock:rw"],
      Mounts: [{ Type: "volume", Source: "mpw_mpw-data", Target: "/data" }],
      NetworkMode: "mpw",
      RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
      PortBindings: { "4000/tcp": [{ HostIp: "127.0.0.1", HostPort: "4000" }] },
    });
  });

  it("preserva o healthcheck do compose e herda cmd/workdir/volumes/portas da nova imagem", () => {
    expect(criar.Healthcheck).toEqual({ Test: ["CMD", "node", "-e", "fetch()"], Interval: 10_000_000_000 });
    expect(criar).not.toHaveProperty("Cmd");
    expect(criar).not.toHaveProperty("WorkingDir");
    expect(criar).not.toHaveProperty("Volumes");
    expect(criar).not.toHaveProperty("ExposedPorts");
    expect(criar).not.toHaveProperty("Hostname");
  });

  it("conecta à rede principal e às extras com os mesmos aliases, sem o id antigo", () => {
    expect(criar.NetworkingConfig).toEqual({
      EndpointsConfig: { mpw: { Aliases: ["mpw-control-plane-1", "control-plane"] } },
    });
    expect(redesExtras).toEqual([{ rede: "extra", endpoint: { Aliases: ["cp-extra"] } }]);
  });

  it("reaproveita volumes anônimos que não estavam declarados no HostConfig", () => {
    const inspect = inspectControlPlane();
    inspect.HostConfig = { ...inspect.HostConfig, Mounts: [] };
    const plano = planejarRecriacao(inspect, CONFIG_IMAGEM_CONTROL_PLANE, NOVA);
    expect(plano.criar.HostConfig?.Mounts).toEqual([
      { Type: "volume", Source: "mpw_mpw-data", Target: "/data", ReadOnly: false },
    ]);
  });

  it("não altera o inspect recebido", () => {
    const inspect = inspectControlPlane();
    const antes = structuredClone(inspect);
    planejarRecriacao(inspect, CONFIG_IMAGEM_CONTROL_PLANE, NOVA);
    expect(inspect).toEqual(antes);
  });

  it("sem config da imagem antiga mantém tudo que o container tinha", () => {
    const plano = planejarRecriacao(inspectControlPlane(), {}, NOVA);
    expect(plano.criar.Env).toContain("APP_VERSION=1.0.0");
    expect(plano.criar.Cmd).toEqual(["node", "dist/server.js"]);
    expect(plano.criar.Hostname).toBeUndefined();
  });
});
