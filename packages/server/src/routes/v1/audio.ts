import { Hono } from "hono";
import { authMiddleware, checkVariantAccess } from "../../middleware/auth";
import {
  forwardAudioSpeech,
  forwardAudioTranscription,
  RouterError,
} from "../router";
import type {
  AudioSpeechRequest,
  AudioTranscriptionRequest,
} from "../../engine/adapter";

const audio = new Hono();
audio.use("/v1/audio/*", authMiddleware);

function errorResponse(status: number, message: string, code?: string) {
  return new Response(
    JSON.stringify({ error: { message, type: "router_error", code } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function handleRouterError(err: unknown): Response {
  if (err instanceof RouterError) {
    return errorResponse(err.status, err.message, err.code);
  }
  const message = err instanceof Error ? err.message : String(err);
  return errorResponse(502, message, "upstream_error");
}

const FORMAT_CONTENT_TYPE: Record<string, string> = {
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/pcm",
};

/**
 * POST /v1/audio/speech
 * body: { model: <variant name>, input, voice, response_format?, speed? }
 * 响应：音频二进制
 */
audio.post("/v1/audio/speech", async (c) => {
  let body: AudioSpeechRequest;
  try {
    body = (await c.req.json()) as AudioSpeechRequest;
  } catch {
    return errorResponse(400, "Invalid JSON body", "invalid_json");
  }
  if (!body.model) return errorResponse(400, "Missing model (variant name)", "missing_model");
  if (!body.input) return errorResponse(400, "Missing input", "missing_input");
  if (!body.voice) return errorResponse(400, "Missing voice", "missing_voice");

  const access = checkVariantAccess(c, body.model);
  if (!access.ok) return errorResponse(access.status, (access.body as any).error.message, "variant_not_allowed");

  try {
    const buf = await forwardAudioSpeech(body.model, body);
    const format = body.response_format ?? "mp3";
    return new Response(buf, {
      status: 200,
      headers: { "Content-Type": FORMAT_CONTENT_TYPE[format] ?? "application/octet-stream" },
    });
  } catch (err) {
    return handleRouterError(err);
  }
});

/**
 * POST /v1/audio/transcriptions
 * multipart/form-data: model, file, language?, prompt?, response_format?, temperature?
 */
audio.post("/v1/audio/transcriptions", async (c) => {
  const ct = c.req.header("Content-Type") ?? "";
  if (!ct.includes("multipart/form-data")) {
    return errorResponse(400, "Content-Type must be multipart/form-data", "invalid_content_type");
  }

  const form = await c.req.parseBody();
  const model = String(form["model"] ?? "");
  if (!model) return errorResponse(400, "Missing model", "missing_model");
  const fileField = form["file"];
  if (!fileField) return errorResponse(400, "Missing file", "missing_file");

  const access = checkVariantAccess(c, model);
  if (!access.ok) return errorResponse(access.status, (access.body as any).error.message, "variant_not_allowed");

  const req: AudioTranscriptionRequest = {
    ...(form as Record<string, unknown>),
    model,
    file: fileField as Blob,
    language: form["language"] ? String(form["language"]) : undefined,
    prompt: form["prompt"] ? String(form["prompt"]) : undefined,
    response_format: form["response_format"]
      ? (String(form["response_format"]) as "json" | "text" | "srt" | "verbose_json" | "vtt")
      : undefined,
    temperature: form["temperature"] ? Number(form["temperature"]) : undefined,
  };

  try {
    const result = await forwardAudioTranscription(model, req);
    return c.json(result);
  } catch (err) {
    return handleRouterError(err);
  }
});

export default audio;
