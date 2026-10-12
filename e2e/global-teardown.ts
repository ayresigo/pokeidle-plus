import { derrubarAmbiente } from "./docker.ts";

export default function globalTeardown(): void {
  if (process.env.E2E_KEEP === "1") {
    console.log("e2e: E2E_KEEP=1, ambiente mantido (derrube com pnpm --filter e2e e2e:down)");
    return;
  }
  const removidos = derrubarAmbiente();
  console.log(`e2e: compose mpw-e2e derrubado; workers removidos: ${removidos.join(", ") || "nenhum"}`);
}
