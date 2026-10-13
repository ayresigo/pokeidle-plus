import type { Account, AccountInput, AccountPatch, Tokens } from "./api";

export interface ValoresConta {
  label: string;
  pokeidleUser: string;
  pokeidlePass: string;
  proxyUrl: string;
  solverKey: string;
  accessToken: string;
  refreshToken: string;
}

export type CampoConta = keyof ValoresConta;

export type ErrosConta = Partial<Record<CampoConta, string>>;

export const LIMITES: Record<CampoConta, number> = {
  label: 128,
  pokeidleUser: 128,
  pokeidlePass: 256,
  proxyUrl: 512,
  solverKey: 2048,
  accessToken: 2048,
  refreshToken: 2048,
};

export const REGEX_PROXY_URL = /^(https?|socks5):\/\/\S+$/;

export const VALORES_VAZIOS: ValoresConta = {
  label: "",
  pokeidleUser: "",
  pokeidlePass: "",
  proxyUrl: "",
  solverKey: "",
  accessToken: "",
  refreshToken: "",
};

export type ModoForm = { modo: "criar" } | { modo: "editar"; proxyAtual: string | null };

export function validarProxyUrl(proxyUrl: string): string | null {
  if (proxyUrl.length > LIMITES.proxyUrl) return `máximo de ${LIMITES.proxyUrl} caracteres`;
  if (!REGEX_PROXY_URL.test(proxyUrl)) return "use http://, https:// ou socks5:// (ex.: http://usuario:senha@host:porta)";
  return null;
}

export function validarConta(valores: ValoresConta, modo: ModoForm): ErrosConta {
  const erros: ErrosConta = {};
  for (const campo of Object.keys(LIMITES) as CampoConta[]) {
    if (valores[campo].length > LIMITES[campo]) erros[campo] = `máximo de ${LIMITES[campo]} caracteres`;
  }
  if (!erros.label && valores.label.trim() === "") erros.label = "obrigatório";
  if (!erros.pokeidleUser && valores.pokeidleUser.trim() === "") erros.pokeidleUser = "obrigatório";
  if (modo.modo === "criar" && !erros.pokeidlePass && valores.pokeidlePass === "") {
    erros.pokeidlePass = "obrigatório";
  }

  const proxy = valores.proxyUrl.trim();
  if (proxy !== "") {
    const erroProxy = validarProxyUrl(proxy);
    if (erroProxy) erros.proxyUrl = erroProxy;
  } else if (modo.modo === "editar" && modo.proxyAtual !== null) {
    erros.proxyUrl = "o central não permite remover o proxy; informe outro endereço";
  }

  const temAccess = valores.accessToken.trim() !== "";
  const temRefresh = valores.refreshToken.trim() !== "";
  if (temAccess && !temRefresh && !erros.refreshToken) erros.refreshToken = "informe também o refreshToken";
  if (temRefresh && !temAccess && !erros.accessToken) erros.accessToken = "informe também o accessToken";
  return erros;
}

export function corpoCriacao(valores: ValoresConta): AccountInput {
  const proxy = valores.proxyUrl.trim();
  const solverKey = valores.solverKey.trim();
  const accessToken = valores.accessToken.trim();
  const refreshToken = valores.refreshToken.trim();
  return {
    label: valores.label.trim(),
    pokeidleUser: valores.pokeidleUser.trim(),
    pokeidlePass: valores.pokeidlePass,
    ...(proxy !== "" && { proxyUrl: proxy }),
    ...(solverKey !== "" && { solverKey }),
    ...(accessToken !== "" && refreshToken !== "" && { accessToken, refreshToken }),
  };
}

export function corpoEdicao(valores: ValoresConta, atual: Account): AccountPatch {
  const label = valores.label.trim();
  const pokeidleUser = valores.pokeidleUser.trim();
  const proxy = valores.proxyUrl.trim();
  const solverKey = valores.solverKey.trim();
  return {
    ...(label !== atual.label && { label }),
    ...(pokeidleUser !== atual.pokeidleUser && { pokeidleUser }),
    ...(proxy !== "" && proxy !== atual.proxyUrl && { proxyUrl: proxy }),
    ...(valores.pokeidlePass !== "" && { pokeidlePass: valores.pokeidlePass }),
    ...(solverKey !== "" && { solverKey }),
  };
}

export function tokensPreenchidos(valores: ValoresConta): Tokens | null {
  const accessToken = valores.accessToken.trim();
  const refreshToken = valores.refreshToken.trim();
  return accessToken !== "" && refreshToken !== "" ? { accessToken, refreshToken } : null;
}

export type ResultadoTokens = { ok: true; tokens: Tokens } | { ok: false; erro: string };

const ASPAS_CONSOLE = /^(['`])([\s\S]*)\1$/;
const ASPAS_TOKEN = /^(['"`])([\s\S]*)\1$/;

function tentarObjetoTokens(texto: string): Record<string, unknown> | null {
  let atual: unknown = texto;
  for (let tentativa = 0; tentativa < 3 && typeof atual === "string"; tentativa++) {
    const bruto = atual.trim();
    const m = ASPAS_CONSOLE.exec(bruto);
    const candidato = m ? m[2].trim() : bruto;
    try {
      atual = JSON.parse(candidato);
    } catch {
      return null;
    }
  }
  return atual !== null && typeof atual === "object" && !Array.isArray(atual)
    ? (atual as Record<string, unknown>)
    : null;
}

export function extrairTokens(texto: string): ResultadoTokens {
  const inicial = texto.trim();
  if (inicial === "") return { ok: false, erro: "cole o token do pokeidle.io" };
  const objeto = tentarObjetoTokens(inicial);
  if (objeto) {
    const { accessToken, refreshToken } = objeto;
    if (typeof accessToken !== "string" || accessToken.trim() === "") {
      return { ok: false, erro: "accessToken ausente no JSON colado" };
    }
    if (typeof refreshToken !== "string" || refreshToken.trim() === "") {
      return { ok: false, erro: "refreshToken ausente no JSON colado" };
    }
    return { ok: true, tokens: { accessToken: accessToken.trim(), refreshToken: refreshToken.trim() } };
  }
  const semAspas = ASPAS_TOKEN.exec(inicial);
  const token = (semAspas ? semAspas[2] : inicial).trim();
  if (token === "") return { ok: false, erro: "cole o token do pokeidle.io" };
  return { ok: true, tokens: { accessToken: token, refreshToken: token } };
}
