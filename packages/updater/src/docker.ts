import type Docker from "dockerode";
import { LABEL_ROLE, type MotorDocker } from "./atualizar.js";

function statusHttp(err: unknown): number | undefined {
  return (err as { statusCode?: number } | null)?.statusCode;
}

export function motorDockerode(docker: Docker): MotorDocker {
  return {
    async listarPorRole(role) {
      const containers = await docker.listContainers({
        all: true,
        filters: { label: [`${LABEL_ROLE}=${role}`] },
      });
      return containers.map((container) => ({
        id: container.Id,
        nome: (container.Names[0] ?? container.Id).replace(/^\//, ""),
      }));
    },
    inspecionarContainer: (id) => docker.getContainer(id).inspect(),
    async inspecionarImagem(ref) {
      try {
        return await docker.getImage(ref).inspect();
      } catch (err) {
        if (statusHttp(err) === 404) return null;
        throw err;
      }
    },
    async baixarImagem(ref) {
      const stream = await docker.pull(ref);
      await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(stream, (erro: unknown) => (erro ? reject(erro) : resolve()));
      });
    },
    async parar(id, timeoutSegundos) {
      try {
        await docker.getContainer(id).stop({ t: timeoutSegundos });
      } catch (err) {
        if (statusHttp(err) !== 304) throw err;
      }
    },
    renomear: (id, nome) => docker.getContainer(id).rename({ name: nome }),
    async criar(opcoes) {
      return (await docker.createContainer(opcoes)).id;
    },
    conectar: (rede, id, endpoint) =>
      docker.getNetwork(rede).connect({ Container: id, EndpointConfig: endpoint }),
    async iniciar(id) {
      try {
        await docker.getContainer(id).start();
      } catch (err) {
        if (statusHttp(err) !== 304) throw err;
      }
    },
    remover: (id) => docker.getContainer(id).remove({ force: true }),
  };
}
