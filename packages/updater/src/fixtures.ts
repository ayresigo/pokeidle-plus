import type Docker from "dockerode";
import type { ConfigDaImagem } from "./recriacao.js";

export const ID_CONTROL_PLANE = "abcdef1234567890abcdef1234567890";

export const CONFIG_IMAGEM_CONTROL_PLANE: ConfigDaImagem = {
  Env: ["PATH=/usr/local/bin:/usr/bin", "NODE_ENV=production", "APP_VERSION=1.0.0"],
  Cmd: ["node", "dist/server.js"],
  WorkingDir: "/app/apps/control-plane",
  User: "",
  Labels: { "org.opencontainers.image.source": "repo" },
  ExposedPorts: { "4000/tcp": {} },
  Volumes: { "/data": {} },
};

export function inspectControlPlane(
  parciais: Partial<Docker.ContainerInspectInfo> = {},
): Docker.ContainerInspectInfo {
  return {
    Id: ID_CONTROL_PLANE,
    Name: "/mpw-control-plane-1",
    Image: "sha256:imagem-antiga",
    State: {
      Status: "running",
      Running: true,
      Paused: false,
      Restarting: false,
      OOMKilled: false,
      Dead: false,
      Pid: 1,
      ExitCode: 0,
      Error: "",
      StartedAt: "",
      FinishedAt: "",
    },
    Config: {
      Hostname: ID_CONTROL_PLANE.slice(0, 12),
      Domainname: "",
      User: "",
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      ExposedPorts: { "4000/tcp": {} },
      Tty: false,
      OpenStdin: false,
      StdinOnce: false,
      Env: [
        "CENTRAL_API_URL=https://central.test",
        "WORKER_NETWORK=mpw",
        "AUTO_UPDATE=true",
        "PATH=/usr/local/bin:/usr/bin",
        "NODE_ENV=production",
        "APP_VERSION=1.0.0",
      ],
      Cmd: ["node", "dist/server.js"],
      Image: "ghcr.io/ayresigo/mpw-control-plane:stable",
      Volumes: { "/data": {} },
      WorkingDir: "/app/apps/control-plane",
      Labels: {
        "org.opencontainers.image.source": "repo",
        "mpw.role": "control-plane",
        "com.docker.compose.project": "mpw",
        "com.docker.compose.service": "control-plane",
        "com.docker.compose.config-hash": "hash123",
      },
      Healthcheck: { Test: ["CMD", "node", "-e", "fetch()"], Interval: 10_000_000_000 },
    },
    HostConfig: {
      Binds: ["/var/run/docker.sock:/var/run/docker.sock:rw"],
      Mounts: [{ Type: "volume", Source: "mpw_mpw-data", Target: "/data" }],
      NetworkMode: "mpw",
      RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
      PortBindings: { "4000/tcp": [{ HostIp: "127.0.0.1", HostPort: "4000" }] },
    },
    Mounts: [
      {
        Type: "bind",
        Source: "/var/run/docker.sock",
        Destination: "/var/run/docker.sock",
        Mode: "rw",
        RW: true,
        Propagation: "rprivate",
      },
      {
        Type: "volume",
        Name: "mpw_mpw-data",
        Source: "/var/lib/docker/volumes/mpw_mpw-data/_data",
        Destination: "/data",
        Mode: "z",
        RW: true,
        Propagation: "",
      },
    ],
    NetworkSettings: {
      Networks: {
        mpw: {
          Aliases: ["mpw-control-plane-1", "control-plane"],
          NetworkID: "rede-mpw",
          EndpointID: "endpoint-1",
          Gateway: "172.20.0.1",
          IPAddress: "172.20.0.2",
          IPPrefixLen: 16,
          IPv6Gateway: "",
          GlobalIPv6Address: "",
        },
        extra: {
          Aliases: [ID_CONTROL_PLANE.slice(0, 12), "cp-extra"],
          NetworkID: "rede-extra",
          EndpointID: "endpoint-2",
          Gateway: "172.21.0.1",
          IPAddress: "172.21.0.2",
          IPPrefixLen: 16,
          IPv6Gateway: "",
          GlobalIPv6Address: "",
        },
      },
    },
    ...parciais,
  } as unknown as Docker.ContainerInspectInfo;
}
