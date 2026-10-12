import type Docker from "dockerode";

export interface ConfigDaImagem {
  Env?: string[] | null;
  Cmd?: string[] | null;
  Entrypoint?: string | string[] | null;
  WorkingDir?: string;
  User?: string;
  Labels?: Record<string, string> | null;
  ExposedPorts?: Record<string, object> | null;
  Volumes?: Record<string, object> | null;
  Healthcheck?: Docker.HealthConfig | null;
  StopSignal?: string;
}

type ConfigDoContainer = Docker.ContainerInspectInfo["Config"] & {
  StopSignal?: string;
  StopTimeout?: number;
};

export interface RedeExtra {
  rede: string;
  endpoint: Docker.EndpointSettings;
}

export interface PlanoRecriacao {
  nome: string;
  criar: Docker.ContainerCreateOptions;
  redesExtras: RedeExtra[];
}

export function repositorioDaImagem(ref: string): string {
  return ref.replace(/@.*$/, "").replace(/:[^:/]+$/, "");
}

export function nomeDoContainer(inspect: Pick<Docker.ContainerInspectInfo, "Name">): string {
  return inspect.Name.replace(/^\//, "");
}

function seDiferente<T>(doContainer: T | undefined, daImagem: unknown): T | undefined {
  return JSON.stringify(doContainer ?? null) === JSON.stringify(daImagem ?? null)
    ? undefined
    : doContainer;
}

function chavesProprias<T>(
  doContainer: Record<string, T> | null | undefined,
  daImagem: Record<string, T> | null | undefined,
): Record<string, T> | undefined {
  if (!doContainer) return undefined;
  const proprias = Object.entries(doContainer).filter(
    ([chave, valor]) => seDiferente(valor, daImagem?.[chave]) !== undefined,
  );
  return proprias.length > 0 ? Object.fromEntries(proprias) : undefined;
}

function destinosMontados(hostConfig: Docker.HostConfig): Set<string> {
  const destinos = new Set<string>();
  for (const bind of hostConfig.Binds ?? []) {
    const partes = bind.split(":");
    const destino = partes.at(-1)?.startsWith("/") ? partes.at(-1) : partes.at(-2);
    if (destino?.startsWith("/")) destinos.add(destino);
  }
  for (const mount of hostConfig.Mounts ?? []) destinos.add(mount.Target);
  return destinos;
}

function hostConfigComVolumesImplicitos(inspect: Docker.ContainerInspectInfo): Docker.HostConfig {
  const hostConfig: Docker.HostConfig = structuredClone(inspect.HostConfig);
  const montados = destinosMontados(hostConfig);
  const implicitos: Docker.MountSettings[] = inspect.Mounts.filter(
    (mount) => mount.Type === "volume" && mount.Name && !montados.has(mount.Destination),
  ).map((mount) => ({
    Type: "volume",
    Source: mount.Name as string,
    Target: mount.Destination,
    ReadOnly: !mount.RW,
  }));
  if (implicitos.length > 0) hostConfig.Mounts = [...(hostConfig.Mounts ?? []), ...implicitos];
  return hostConfig;
}

function endpointPreservado(
  endpoint: Docker.ContainerInspectInfo["NetworkSettings"]["Networks"][string],
  idContainer: string,
): Docker.EndpointSettings {
  const aliases = ((endpoint.Aliases as string[] | null | undefined) ?? []).filter(
    (alias) => alias !== idContainer && alias !== idContainer.slice(0, 12),
  );
  const preservado: Docker.EndpointSettings = {};
  if (aliases.length > 0) preservado.Aliases = aliases;
  if (endpoint.IPAMConfig) preservado.IPAMConfig = endpoint.IPAMConfig;
  if (endpoint.Links) preservado.Links = endpoint.Links;
  return preservado;
}

function planejarRedes(inspect: Docker.ContainerInspectInfo): {
  endpoints: Docker.EndpointsConfig | undefined;
  redesExtras: RedeExtra[];
} {
  const redes = Object.entries(inspect.NetworkSettings?.Networks ?? {});
  if (redes.length === 0) return { endpoints: undefined, redesExtras: [] };
  const modo = inspect.HostConfig.NetworkMode;
  const principal = redes.find(([nome]) => nome === modo) ?? redes[0];
  return {
    endpoints: { [principal[0]]: endpointPreservado(principal[1], inspect.Id) },
    redesExtras: redes
      .filter(([nome]) => nome !== principal[0])
      .map(([rede, endpoint]) => ({ rede, endpoint: endpointPreservado(endpoint, inspect.Id) })),
  };
}

export function planejarRecriacao(
  inspect: Docker.ContainerInspectInfo,
  imagemAntiga: ConfigDaImagem,
  novaImagem: string,
): PlanoRecriacao {
  const config = inspect.Config as ConfigDoContainer;
  const env = (config.Env ?? []).filter((item) => !(imagemAntiga.Env ?? []).includes(item));
  const hostname = config.Hostname === inspect.Id.slice(0, 12) ? undefined : config.Hostname;
  const { endpoints, redesExtras } = planejarRedes(inspect);

  const criar: Docker.ContainerCreateOptions = {
    name: nomeDoContainer(inspect),
    Image: novaImagem,
    Hostname: hostname || undefined,
    Domainname: config.Domainname || undefined,
    User: seDiferente(config.User, imagemAntiga.User ?? ""),
    AttachStdin: config.AttachStdin,
    AttachStdout: config.AttachStdout,
    AttachStderr: config.AttachStderr,
    Tty: config.Tty,
    OpenStdin: config.OpenStdin,
    StdinOnce: config.StdinOnce,
    Env: env,
    Cmd: seDiferente(config.Cmd, imagemAntiga.Cmd),
    Entrypoint: seDiferente(config.Entrypoint, imagemAntiga.Entrypoint),
    WorkingDir: seDiferente(config.WorkingDir, imagemAntiga.WorkingDir ?? ""),
    Labels: chavesProprias(config.Labels, imagemAntiga.Labels) ?? {},
    ExposedPorts: chavesProprias(config.ExposedPorts, imagemAntiga.ExposedPorts),
    Volumes: chavesProprias(config.Volumes, imagemAntiga.Volumes),
    Healthcheck: seDiferente(config.Healthcheck, imagemAntiga.Healthcheck),
    StopSignal: seDiferente(config.StopSignal, imagemAntiga.StopSignal),
    StopTimeout: config.StopTimeout,
    HostConfig: hostConfigComVolumesImplicitos(inspect),
    ...(endpoints ? { NetworkingConfig: { EndpointsConfig: endpoints } } : {}),
  };

  for (const chave of Object.keys(criar) as (keyof Docker.ContainerCreateOptions)[]) {
    if (criar[chave] === undefined) delete criar[chave];
  }

  return { nome: criar.name as string, criar, redesExtras };
}
