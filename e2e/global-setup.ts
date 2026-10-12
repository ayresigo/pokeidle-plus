import { compose, construirImagens, derrubarAmbiente, verificarPreCondicoes } from "./docker.ts";
import { ADMIN, URL_CENTRAL } from "./ambiente.ts";

async function conferirSeedAdmin(): Promise<void> {
  const resposta = await fetch(`${URL_CENTRAL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ADMIN),
  });
  if (!resposta.ok) throw new Error(`login do admin seedado falhou: HTTP ${resposta.status}`);
}

export default async function globalSetup(): Promise<void> {
  verificarPreCondicoes();
  derrubarAmbiente();
  if (process.env.E2E_SKIP_BUILD !== "1") {
    console.log("e2e: construindo imagens :e2e");
    await construirImagens();
  }
  try {
    console.log("e2e: subindo compose mpw-e2e");
    compose(["up", "-d", "--wait", "--wait-timeout", "240"]);
    await conferirSeedAdmin();
  } catch (erro) {
    if (process.env.E2E_KEEP !== "1") derrubarAmbiente();
    throw erro;
  }
}
