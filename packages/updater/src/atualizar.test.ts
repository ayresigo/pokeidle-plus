import type Docker from "dockerode";
import { describe, expect, it } from "vitest";
import { atualizar, type ContainerListado, type MotorDocker } from "./atualizar.js";
import { CONFIG_IMAGEM_CONTROL_PLANE, ID_CONTROL_PLANE, inspectControlPlane } from "./fixtures.js";

const ID_WEB = "web0000000000000000000000000000";
const NOVA_CP = "ghcr.io/ayresigo/mpw-control-plane:1.1.0";
const NOVA_WEB = "ghcr.io/ayresigo/mpw-web:1.1.0";

function inspectWeb(): Docker.ContainerInspectInfo {
  const base = inspectControlPlane();
  return {
    ...base,
    Id: ID_WEB,
    Name: "/mpw-web-1",
    Image: "sha256:web-antiga",
    Config: {
      ...base.Config,
      Hostname: ID_WEB.slice(0, 12),
      Image: "ghcr.io/ayresigo/mpw-web:stable",
      Env: ["CONTROL_PLANE_URL=http://control-plane:4000"],
      Labels: { "mpw.role": "web", "com.docker.compose.service": "web" },
      Healthcheck: undefined,
    },
    HostConfig: { NetworkMode: "mpw", PortBindings: { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: "3000" }] } },
    Mounts: [],
    NetworkSettings: {
      ...base.NetworkSettings,
      Networks: { mpw: { ...base.NetworkSettings.Networks.mpw, Aliases: ["mpw-web-1", "web"] } },
    },
  };
}

interface Cenario {
  semWeb?: boolean;
  falhaPull?: string[];
  imagensLocais?: string[];
  falhaIniciarNovo?: boolean;
  saudeNova?: "healthy" | "unhealthy" | "starting";
  novoParaDeRodar?: boolean;
  extrasPorRole?: Record<string, ContainerListado[]>;
  novoReinicia?: boolean;
}

function criarMotor(cenario: Cenario = {}) {
  const chamadas: string[] = [];
  const criados: Docker.ContainerCreateOptions[] = [];
  const inspects: Record<string, Docker.ContainerInspectInfo> = {
    [ID_CONTROL_PLANE]: inspectControlPlane(),
    ...(cenario.semWeb ? {} : { [ID_WEB]: inspectWeb() }),
  };
  const porRole: Record<string, ContainerListado[]> = {
    "control-plane": [{ id: ID_CONTROL_PLANE, nome: "mpw-control-plane-1" }],
    web: cenario.semWeb ? [] : [{ id: ID_WEB, nome: "mpw-web-1" }],
  };
  for (const [role, extras] of Object.entries(cenario.extrasPorRole ?? {})) {
    porRole[role] = [...extras, ...porRole[role]];
  }
  const novos: Record<string, Docker.ContainerCreateOptions> = {};

  const motor: MotorDocker = {
    async listarPorRole(role) {
      return porRole[role] ?? [];
    },
    async inspecionarContainer(id) {
      const opcoes = novos[id];
      if (!opcoes) return inspects[id];
      const comHealth = opcoes.Healthcheck !== undefined;
      return {
        Id: id,
        RestartCount: cenario.novoReinicia ? 1 : 0,
        State: {
          Status: cenario.novoParaDeRodar ? "exited" : "running",
          Running: !cenario.novoParaDeRodar,
          ExitCode: cenario.novoParaDeRodar ? 1 : 0,
          ...(comHealth ? { Health: { Status: cenario.saudeNova ?? "healthy" } } : {}),
        },
      } as unknown as Docker.ContainerInspectInfo;
    },
    async inspecionarImagem(ref) {
      if (ref === "sha256:imagem-antiga") return { Config: CONFIG_IMAGEM_CONTROL_PLANE } as Docker.ImageInspectInfo;
      if (ref.startsWith("sha256:")) return { Config: {} } as unknown as Docker.ImageInspectInfo;
      return cenario.imagensLocais?.includes(ref) ? ({ Config: {} } as unknown as Docker.ImageInspectInfo) : null;
    },
    async baixarImagem(ref) {
      chamadas.push(`pull:${ref}`);
      if (cenario.falhaPull?.includes(ref)) throw new Error("manifest unknown");
    },
    async parar(id, timeout) {
      chamadas.push(`parar:${id}:${timeout}`);
    },
    async renomear(id, nome) {
      chamadas.push(`renomear:${id}:${nome}`);
    },
    async criar(opcoes) {
      const id = `novo-${opcoes.name}`;
      chamadas.push(`criar:${opcoes.name}:${opcoes.Image}`);
      criados.push(opcoes);
      novos[id] = opcoes;
      return id;
    },
    async conectar(rede, id, endpoint) {
      chamadas.push(`conectar:${rede}:${id}:${(endpoint.Aliases ?? []).join(",")}`);
    },
    async iniciar(id) {
      chamadas.push(`iniciar:${id}`);
      if (cenario.falhaIniciarNovo && id.startsWith("novo-")) throw new Error("porta ocupada");
    },
    async remover(id) {
      chamadas.push(`remover:${id}`);
    },
  };
  return { motor, chamadas, criados };
}

function relogio() {
  let agora = 1_000;
  return {
    agora: () => agora,
    dormir: async (ms: number) => {
      agora += ms;
    },
  };
}

async function rodar(motor: MotorDocker, logs: string[] = []) {
  return atualizar({ motor, targetTag: "1.1.0", log: (m) => logs.push(m), ...relogio() });
}

describe("atualizar", () => {
  it("recria control-plane e depois web com a nova tag, mesmo nome, e remove os antigos", async () => {
    const { motor, chamadas, criados } = criarMotor();

    await rodar(motor);

    expect(chamadas).toEqual([
      `pull:${NOVA_CP}`,
      `pull:${NOVA_WEB}`,
      `parar:${ID_CONTROL_PLANE}:30`,
      `renomear:${ID_CONTROL_PLANE}:mpw-control-plane-1-old-1000`,
      `criar:mpw-control-plane-1:${NOVA_CP}`,
      "conectar:extra:novo-mpw-control-plane-1:cp-extra",
      "iniciar:novo-mpw-control-plane-1",
      `remover:${ID_CONTROL_PLANE}`,
      `parar:${ID_WEB}:30`,
      `renomear:${ID_WEB}:mpw-web-1-old-1000`,
      `criar:mpw-web-1:${NOVA_WEB}`,
      "iniciar:novo-mpw-web-1",
      `remover:${ID_WEB}`,
    ]);
    expect(criados[0].Env).toEqual([
      "CENTRAL_API_URL=https://central.test",
      "WORKER_NETWORK=mpw",
      "AUTO_UPDATE=true",
    ]);
    expect(criados[1].HostConfig?.PortBindings).toEqual({
      "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: "3000" }],
    });
  });

  it("sem healthcheck exige o container rodando por 10s", async () => {
    const { motor } = criarMotor();
    const tempo = relogio();
    await atualizar({ motor, targetTag: "1.1.0", log: () => {}, ...tempo });
    expect(tempo.agora()).toBeGreaterThanOrEqual(1_000 + 10_000);
  });

  it("falha no start do novo faz rollback do alvo e não toca nos próximos", async () => {
    const { motor, chamadas } = criarMotor({ falhaIniciarNovo: true });

    await expect(rodar(motor)).rejects.toThrow(/falha ao atualizar control-plane.*porta ocupada/);

    expect(chamadas.slice(2)).toEqual([
      `parar:${ID_CONTROL_PLANE}:30`,
      `renomear:${ID_CONTROL_PLANE}:mpw-control-plane-1-old-1000`,
      `criar:mpw-control-plane-1:${NOVA_CP}`,
      "conectar:extra:novo-mpw-control-plane-1:cp-extra",
      "iniciar:novo-mpw-control-plane-1",
      "remover:novo-mpw-control-plane-1",
      `renomear:${ID_CONTROL_PLANE}:mpw-control-plane-1`,
      `iniciar:${ID_CONTROL_PLANE}`,
    ]);
    expect(chamadas.some((c) => c.includes(ID_WEB) && !c.startsWith("pull"))).toBe(false);
  });

  it("healthcheck unhealthy faz rollback", async () => {
    const { motor, chamadas } = criarMotor({ saudeNova: "unhealthy" });

    await expect(rodar(motor)).rejects.toThrow(/unhealthy/);

    expect(chamadas.slice(-3)).toEqual([
      "remover:novo-mpw-control-plane-1",
      `renomear:${ID_CONTROL_PLANE}:mpw-control-plane-1`,
      `iniciar:${ID_CONTROL_PLANE}`,
    ]);
  });

  it("health que nunca fica healthy estoura o timeout de 90s e faz rollback", async () => {
    const { motor, chamadas } = criarMotor({ saudeNova: "starting" });
    const tempo = relogio();

    await expect(
      atualizar({ motor, targetTag: "1.1.0", log: () => {}, ...tempo }),
    ).rejects.toThrow(/90000ms/);

    expect(tempo.agora()).toBeGreaterThanOrEqual(1_000 + 90_000);
    expect(chamadas.at(-1)).toBe(`iniciar:${ID_CONTROL_PLANE}`);
  });

  it("novo container que reinicia durante a espera faz rollback", async () => {
    const { motor, chamadas } = criarMotor({ novoReinicia: true, saudeNova: "starting" });

    await expect(rodar(motor)).rejects.toThrow(/reiniciou/);

    expect(chamadas.at(-1)).toBe(`iniciar:${ID_CONTROL_PLANE}`);
  });

  it("novo container que morre durante a espera faz rollback", async () => {
    const { motor, chamadas } = criarMotor({ novoParaDeRodar: true });

    await expect(rodar(motor)).rejects.toThrow(/parou/);

    expect(chamadas.at(-1)).toBe(`iniciar:${ID_CONTROL_PLANE}`);
  });

  it("pull falhando com a imagem presente localmente segue com a local", async () => {
    const { motor, chamadas } = criarMotor({
      falhaPull: [NOVA_CP, NOVA_WEB],
      imagensLocais: [NOVA_CP, NOVA_WEB],
    });
    const logs: string[] = [];

    await rodar(motor, logs);

    expect(chamadas).toContain(`criar:mpw-control-plane-1:${NOVA_CP}`);
    expect(chamadas).toContain(`criar:mpw-web-1:${NOVA_WEB}`);
    expect(logs.some((l) => l.includes("usando a imagem local"))).toBe(true);
  });

  it("pull falhando sem imagem local aborta tudo antes de parar qualquer container", async () => {
    const { motor, chamadas } = criarMotor({ falhaPull: [NOVA_WEB] });

    await expect(rodar(motor)).rejects.toThrow(/não existe localmente/);

    expect(chamadas).toEqual([`pull:${NOVA_CP}`, `pull:${NOVA_WEB}`]);
  });

  it("alvo ausente é pulado com log", async () => {
    const { motor, chamadas } = criarMotor({ semWeb: true });
    const logs: string[] = [];

    await rodar(motor, logs);

    expect(logs).toContain("nenhum container com mpw.role=web; pulando");
    expect(chamadas.filter((c) => c.startsWith("criar"))).toEqual([
      `criar:mpw-control-plane-1:${NOVA_CP}`,
    ]);
  });

  it("ignora sobras -old- de atualizações anteriores", async () => {
    const { motor, chamadas } = criarMotor({
      extrasPorRole: { web: [{ id: "sobra", nome: "mpw-web-1-old-123" }] },
    });

    await rodar(motor);

    expect(chamadas.some((c) => c.includes("sobra"))).toBe(false);
    expect(chamadas).toContain(`parar:${ID_WEB}:30`);
  });
});
