export type VideoParameterType =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "object"
  | "array";

export interface VideoParameterSpec {
  type: VideoParameterType;
  required?: boolean;
  enum?: Array<string | number | boolean>;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  properties?: Record<string, VideoParameterSpec>;
  requiredProperties?: string[];
  items?: VideoParameterSpec;
}

export interface VideoInputContract {
  version: 1;
  fields: Record<string, VideoParameterSpec>;
  required: string[];
}

export interface VideoContractEvidence {
  source: "runtime" | "provider_doc" | "manual" | "catalog";
  status: "unverified" | "candidate" | "partial" | "confirmed";
  reason: string;
}

export interface StoredVideoContract extends VideoContractEvidence {
  contract: VideoInputContract;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function matchesType(value: unknown, type: VideoParameterType): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "object") return isObject(value);
  return Array.isArray(value);
}

function validateValue(value: unknown, spec: VideoParameterSpec, path: string): string | null {
  if (!matchesType(value, spec.type)) return `${path} must be ${spec.type}`;
  if (spec.enum && !spec.enum.some((item) => Object.is(item, value))) {
    return `${path} must be one of ${spec.enum.join(", ")}`;
  }
  if (typeof value === "number") {
    if (spec.minimum !== undefined && value < spec.minimum) return `${path} must be >= ${spec.minimum}`;
    if (spec.maximum !== undefined && value > spec.maximum) return `${path} must be <= ${spec.maximum}`;
  }
  if (Array.isArray(value)) {
    if (spec.minItems !== undefined && value.length < spec.minItems) return `${path} must contain at least ${spec.minItems} items`;
    if (spec.maxItems !== undefined && value.length > spec.maxItems) return `${path} must contain at most ${spec.maxItems} items`;
    if (spec.items) {
      for (let index = 0; index < value.length; index++) {
        const error = validateValue(value[index], spec.items, `${path}[${index}]`);
        if (error) return error;
      }
    }
  }
  if (isObject(value) && spec.properties) {
    for (const name of spec.requiredProperties ?? []) {
      const child = value[name];
      if (child === undefined || child === null || child === "") return `${path}.${name} is required`;
    }
    for (const [name, childSpec] of Object.entries(spec.properties)) {
      if (value[name] !== undefined) {
        const error = validateValue(value[name], childSpec, `${path}.${name}`);
        if (error) return error;
      }
    }
  }
  return null;
}

export function validateVideoContractRequest(
  request: Record<string, unknown>,
  contract: VideoInputContract,
): string | null {
  for (const name of contract.required) {
    const value = request[name];
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
      return `Missing required video parameter: ${name}`;
    }
  }
  for (const [name, spec] of Object.entries(contract.fields)) {
    if (request[name] !== undefined) {
      const error = validateValue(request[name], spec, name);
      if (error) return error;
    }
  }
  return null;
}

export function parseStoredVideoContract(raw: string | null | undefined): StoredVideoContract | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isObject(value) || value.version !== 1 || !isObject(value.contract) || !isObject(value.contract.fields)) return null;
    if (!Array.isArray(value.contract.required)) return null;
    return value as unknown as StoredVideoContract;
  } catch {
    return null;
  }
}
