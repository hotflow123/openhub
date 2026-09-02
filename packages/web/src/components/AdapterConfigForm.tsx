import type { ReactNode } from "react";

export type AdapterConfigFieldType = "string" | "number" | "integer" | "boolean" | "enum";

export interface AdapterConfigField {
  type: AdapterConfigFieldType;
  path?: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
  secret?: boolean;
}

export interface AdapterConfigSchema {
  type: "object";
  properties: Record<string, AdapterConfigField>;
}

function safePath(fieldName: string, field: AdapterConfigField): string[] {
  const path = (field.path ?? fieldName).split(".").filter((segment) => /^[A-Za-z0-9_-]+$/.test(segment));
  return path.length > 0 ? path : [fieldName];
}

function readValue(source: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = source;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function writeValue(source: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const result = { ...source };
  let current = result;
  for (const segment of path.slice(0, -1)) {
    const child = current[segment];
    current[segment] = child && typeof child === "object" && !Array.isArray(child)
      ? { ...(child as Record<string, unknown>) }
      : {};
    current = current[segment] as Record<string, unknown>;
  }
  const last = path[path.length - 1];
  if (value === undefined || value === "") delete current[last];
  else current[last] = value;
  return result;
}

export function getAdapterConfigDefaults(schema: AdapterConfigSchema | null | undefined): Record<string, unknown> {
  let result: Record<string, unknown> = {};
  for (const [fieldName, field] of Object.entries(schema?.properties ?? {})) {
    if (field.default !== undefined) result = writeValue(result, safePath(fieldName, field), field.default);
  }
  return result;
}

export function applyAdapterConfigDefaults(
  schema: AdapterConfigSchema | null | undefined,
  value: Record<string, unknown>,
): Record<string, unknown> {
  return mergeRecords(getAdapterConfigDefaults(schema), value);
}

function mergeRecords(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    if (current && typeof current === "object" && !Array.isArray(current) && value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = mergeRecords(current as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export default function AdapterConfigForm({
  schema,
  value,
  onChange,
}: {
  schema: AdapterConfigSchema | null | undefined;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}) {
  const fields = Object.entries(schema?.properties ?? {});
  if (fields.length === 0) {
    return <div className="field-hint">此适配器没有额外配置项。</div>;
  }

  return (
    <div className="config-grid">
      {fields.map(([fieldName, field]) => {
        const path = safePath(fieldName, field);
        const current = readValue(value, path) ?? field.default;
        const update = (nextValue: unknown) => onChange(writeValue(value, path, nextValue));
        return (
          <div className="field" key={fieldName}>
            <label className="label">
              {fieldName}{field.required ? " *" : ""}
            </label>
            {renderField(fieldName, field, current, update)}
            {field.path && <small className="field-hint">保存路径：<code>{field.path}</code></small>}
          </div>
        );
      })}
    </div>
  );
}

function renderField(
  fieldName: string,
  field: AdapterConfigField,
  value: unknown,
  onChange: (value: unknown) => void,
): ReactNode {
  if (field.type === "boolean") {
    return (
      <label className="toggle-control">
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        启用
      </label>
    );
  }
  if (field.type === "enum") {
    return (
      <select className="input" value={value == null ? "" : String(value)} onChange={(event) => onChange(event.target.value)}>
        {!field.required && <option value="">使用默认值</option>}
        {(field.enum ?? []).map((option) => <option value={option} key={option}>{option}</option>)}
      </select>
    );
  }
  if (field.type === "number" || field.type === "integer") {
    return (
      <input
        className="input"
        type="number"
        step={field.type === "integer" ? 1 : "any"}
        value={value == null ? "" : String(value)}
        onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
      />
    );
  }
  return (
    <input
      className="input"
      type={field.secret ? "password" : "text"}
      placeholder={field.default == null ? `填写 ${fieldName}` : String(field.default)}
      value={value == null ? "" : String(value)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
