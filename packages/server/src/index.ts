import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import api from "./routes/api";
import admin from "./routes/admin";
import { bootstrapAdapters } from "./engine/index";
import { initApp } from "./db/init";
import { startWorker } from "./engine/tasks/worker";
import { startCatalogSyncCron } from "./jobs/catalog-sync-cron.js";

bootstrapAdapters();

async function main() {
  try {
    await initApp();
    console.log("[openhub] schema verified");
  } catch (err) {
    console.error("[openhub] schema init failed:", err);
    process.exit(1);
  }

  const app = new Hono();

  app.use("*", logger());
  app.use("*", cors({ origin: "*", credentials: false }));

  app.get("/", (c) =>
    c.json({
      service: "openhub",
      version: "0.1.0",
      endpoints: {
        openai_compat: [
          "/v1/models",
          "/v1/chat/completions",
          "/v1/embeddings",
          "/v1/images/generations",
          "/v1/images/edits",
          "/v1/images/variations",
          "/v1/audio/speech",
          "/v1/audio/transcriptions",
        ],
        async: ["/v1/video/generations", "/v1/video/tasks", "/v1/video/tasks/:id"],
        admin: ["/admin/sites", "/admin/keys", "/admin/models", "/admin/variants", "/admin/catalog"],
      },
    }),
  );

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.route("/", api);
  app.route("/admin", admin);

  const port = Number(process.env.PORT ?? 3000);
  console.log(`[openhub] listening on http://localhost:${port}`);

  serve({ fetch: app.fetch, port });

  // Phase 3B: 启动异步任务 worker（轮询 + 回调）
  startWorker().catch((e) => console.error("[openhub] worker failed to start:", e));

  // Phase 2+: 生产环境启动 models.dev 目录定时同步
  startCatalogSyncCron();
}

main();
