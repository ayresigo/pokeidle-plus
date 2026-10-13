export const API_BASE = "/cp";

export type Papel = "admin" | "user";

export interface Session {
  authenticated: boolean;
  offline: boolean;
  username?: string;
  role?: Papel;
}

export interface Usuario {
  id: string;
  username: string;
  role: Papel;
  active: boolean;
  createdAt: string;
}

export interface NovoUsuario {
  username: string;
  password: string;
  role: Papel;
}

export interface UsuarioPatch {
  active?: boolean;
  role?: Papel;
  password?: string;
}

export interface Account {
  id: string;
  label: string;
  pokeidleUser: string;
  proxyUrl: string | null;
  huntSlug: string | null;
  createdAt: string;
}

export interface AccountInput {
  label: string;
  pokeidleUser: string;
  pokeidlePass: string;
  proxyUrl?: string;
  huntSlug?: string;
  solverKey?: string;
  accessToken?: string;
  refreshToken?: string;
}

export type AccountPatch = Partial<AccountInput>;

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export type FaseJogo = "booting" | "authenticating" | "in-game" | "needs-login" | "error";

export interface EstadoJogo {
  state: FaseJogo;
  lastAction: string | null;
  lastError: string | null;
}

export type DesiredState = "running" | "stopped" | "none";

export interface WorkerSnapshot {
  id: string;
  accountId: string;
  state: string;
  health: string;
  startedAt: string | null;
  restartCount: number;
  desired: DesiredState;
  backoffAtual: number;
  degraded: boolean;
  lastError: string | null;
  jogo: EstadoJogo | null;
}

export type UpdateState = "idle" | "checking" | "updating" | "update_failed" | "rolling_back";

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  latestChangelog: string | null;
  latestImageDigest: string | null;
  updateAvailable: boolean;
  autoUpdate: boolean;
  lastCheck: string | null;
  lastError: string | null;
  state: UpdateState;
  rollbackDisponivel: boolean;
  rollbackVersao: string | null;
}

export interface LogLine {
  line: string;
  ts: string;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface ApiFetchInit extends RequestInit {
  redirectOn401?: boolean;
}

export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

function redirecionarParaLogin(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;
  window.location.replace("/login");
}

async function lerMensagemDeErro(res: Response): Promise<string> {
  const texto = await res.text().catch(() => "");
  if (texto) {
    try {
      const corpo: unknown = JSON.parse(texto);
      if (
        corpo &&
        typeof corpo === "object" &&
        "error" in corpo &&
        typeof corpo.error === "string" &&
        corpo.error
      ) {
        return corpo.error;
      }
    } catch {}
  }
  return res.statusText || `erro ${res.status}`;
}

export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const { redirectOn401 = true, headers, ...resto } = init;
  const cabecalhos = new Headers(headers);
  if (resto.body !== undefined && resto.body !== null && !cabecalhos.has("content-type")) {
    cabecalhos.set("content-type", "application/json");
  }

  const res = await fetch(apiUrl(path), { cache: "no-store", ...resto, headers: cabecalhos });

  if (!res.ok) {
    const mensagem = await lerMensagemDeErro(res);
    if (res.status === 401 && redirectOn401) redirecionarParaLogin();
    throw new ApiError(res.status, mensagem);
  }

  if (res.status === 204) return undefined as T;
  const texto = await res.text();
  return (texto ? JSON.parse(texto) : undefined) as T;
}

export function getSession(): Promise<Session> {
  return apiFetch<Session>("/auth/session", { redirectOn401: false });
}

export function login(username: string, password: string): Promise<{ authenticated: true }> {
  return apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
    redirectOn401: false,
  });
}

export function logout(): Promise<void> {
  return apiFetch<void>("/auth/logout", { method: "POST", redirectOn401: false });
}
