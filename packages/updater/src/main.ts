import Docker from "dockerode";
import { atualizar } from "./atualizar.js";
import { motorDockerode } from "./docker.js";

const targetTag = process.env.TARGET_TAG?.trim();
if (!targetTag) {
  console.error("[updater] TARGET_TAG não definida");
  process.exit(2);
}

try {
  await atualizar({ motor: motorDockerode(new Docker()), targetTag });
} catch (err) {
  console.error(`[updater] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
