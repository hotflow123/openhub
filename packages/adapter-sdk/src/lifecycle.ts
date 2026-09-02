import type { AdapterContext, ArtifactRef, UsageFacts } from "./common";

export interface TaskSubmitResult {
  siteTaskId: string;
  initialStatus: "pending" | "processing";
  rawResult?: unknown;
}

export interface TaskQueryResult {
  status: "pending" | "processing" | "completed" | "failed" | "timeout";
  result?: unknown;
  error?: string;
  raw?: unknown;
}

export type TaskQueryMode = "per_task" | "batch" | "dynamic";

export interface TaskAdapterBase {
  submit(input: unknown, context: AdapterContext): Promise<TaskSubmitResult>;
  listArtifacts?(task: TaskQueryResult): ArtifactRef[];
  getArtifact?(artifact: ArtifactRef, context: AdapterContext): Promise<Response | ArrayBuffer>;
  extractUsage?(task: TaskQueryResult): UsageFacts | null;
}

export interface AsyncTaskAdapter extends TaskAdapterBase {
  queryMode: "per_task";
  query(taskId: string, context: AdapterContext): Promise<TaskQueryResult>;
}

export interface BatchTaskAdapter extends TaskAdapterBase {
  queryMode: "batch";
  queryMany(taskIds: string[], context: AdapterContext): Promise<TaskQueryResult[]>;
}

export interface DynamicTaskAdapter extends TaskAdapterBase {
  queryMode: "dynamic";
  dynamicQuery(input: unknown, context: AdapterContext): Promise<TaskQueryResult[]>;
}
