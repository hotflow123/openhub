export type ParameterField = {
  type?: string;
  title?: string;
  name?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  step?: number;
  maxItems?: number;
  items?: ParameterField | Record<string, unknown>;
  properties?: Record<string, ParameterField | Record<string, unknown>>;
  required?: boolean | string[];
  examples?: unknown[];
  [key: string]: unknown;
};

export type TemplateModality = "image" | "video" | "audio";

export interface NormalizedParameterTemplate {
  sourceModelId: string;
  sourceCollection: string;
  sourceIndex: number;
  operation: string;
  modality: TemplateModality;
  provider: string | null;
  providerName: string | null;
  endpointHint: string | null;
  inputs: Record<string, ParameterField>;
  required: string[];
  provenance: {
    sourceCommit: string;
    file: string;
    collection: string;
    index: number;
  };
}

export interface OpenGenerativeAiSnapshot {
  source: "open-generative-ai";
  sourceCommit: string;
  sourceFileSha256: string;
  generatedAt: string;
  sourceLicense: string | null;
  records: NormalizedParameterTemplate[];
  snapshotSha256: string;
}
