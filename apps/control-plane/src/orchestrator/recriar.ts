import type { TokensRenovados } from "../supervisor/supervisor.js";
import { LABEL_ACCOUNT, LABEL_MANAGED } from "./orchestrator.js";
import type { WorkerConfig, WorkerInspect } from "./types.js";

export function envComTokens(
  env: Record<string, string>,
  tokens: TokensRenovados | null,
): Record<string, string> {
  return tokens
    ? { ...env, ACCESS_TOKEN: tokens.accessToken, REFRESH_TOKEN: tokens.refreshToken }
    : env;
}

export function configDeRecriacao(
  accountId: string,
  inspecao: WorkerInspect,
  imageRef: string,
  tokens: TokensRenovados | null,
): WorkerConfig {
  const labels = { ...inspecao.labels };
  delete labels[LABEL_MANAGED];
  delete labels[LABEL_ACCOUNT];
  return { accountId, imageRef, env: envComTokens(inspecao.env, tokens), labels };
}
