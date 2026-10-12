import { derrubarAmbiente } from "./docker.ts";

const removidos = derrubarAmbiente();
console.log(`compose mpw-e2e derrubado; workers removidos: ${removidos.join(", ") || "nenhum"}`);
