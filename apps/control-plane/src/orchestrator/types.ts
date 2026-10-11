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

export interface ContainerOrchestrator {
  createWorker(cfg: WorkerConfig): Promise<string>;
  startWorker(id: string): Promise<void>;
  stopWorker(id: string, timeoutSec: number): Promise<void>;
  removeWorker(id: string): Promise<void>;
  listWorkers(): Promise<WorkerStatus[]>;
  workerLogs(id: string, tail: number): Promise<string>;
  pullImage(ref: string): Promise<void>;
}
