export interface WorkerConfig {
  accountId: string;
  imageRef: string;
  env: Record<string, string>;
  labels?: Record<string, string>;
  cmd?: string[];
}

export interface WorkerStatus {
  id: string;
  accountId: string;
  state: string;
  health: string;
  startedAt: Date | null;
  restartCount: number;
}

export interface WorkerInspect {
  env: Record<string, string>;
  labels: Record<string, string>;
  image: string;
  imageRef: string;
}

export interface UpdaterConfig {
  imageRef: string;
  targetTag: string;
}

export type LogLineCallback = (line: string, ts: Date) => void;

export interface ResultadoOneShot {
  exitCode: number;
  stdout: string;
}

export interface ContainerOrchestrator {
  createWorker(cfg: WorkerConfig): Promise<string>;
  startWorker(id: string): Promise<void>;
  stopWorker(id: string, timeoutSec: number): Promise<void>;
  removeWorker(id: string): Promise<void>;
  listWorkers(): Promise<WorkerStatus[]>;
  workerLogs(id: string, tail: number): Promise<string>;
  followLogs(id: string, onLine: LogLineCallback): Promise<() => Promise<void>>;
  pullImage(ref: string): Promise<void>;
  inspectWorker(id: string): Promise<WorkerInspect>;
  createUpdater(cfg: UpdaterConfig): Promise<string>;
  createOneShot(image: string, cmd: string[]): Promise<string>;
  waitOneShot(id: string, timeoutMs: number): Promise<ResultadoOneShot>;
  removeOneShot(id: string): Promise<void>;
}
