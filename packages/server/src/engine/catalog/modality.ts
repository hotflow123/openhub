export type CatalogModality = "llm" | "embedding" | "image" | "audio" | "video";

function parseList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function inferModalityFromCatalog(
  modalitiesIn: string | null,
  modalitiesOut: string | null,
): CatalogModality | null {
  const input = parseList(modalitiesIn);
  const output = parseList(modalitiesOut);
  const normalizedInput = input.map((value) => value.toLowerCase());
  const normalizedOutput = output.map((value) => value.toLowerCase());
  if ([...normalizedOutput, ...normalizedInput].includes("embedding")) return "embedding";
  if (normalizedOutput.includes("video")) return "video";
  if (normalizedOutput.includes("image")) return "image";
  if (normalizedOutput.includes("audio") || normalizedInput.includes("audio")) return "audio";
  if (normalizedOutput.includes("text")) return "llm";
  return null;
}
