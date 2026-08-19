/**
 * 插入一个 status='unknown' 的测试模型用于验证 wizard 流程
 */
import Database from "better-sqlite3";

const db = new Database("./data/openhub.db");

const modelId = `test_model_${Date.now()}`;
const siteId = process.argv[2] || "tr2DtiFCB8sZJwVJuY3lz";

db.prepare(`
  INSERT INTO models 
  (id, site_id, raw_name, display_name, modality, adapter_id, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
`).run(
  modelId,
  siteId,
  "mystery-model-v1",
  "Mystery Model v1",
  "unknown",
  "unknown",
  "unknown"
);

console.log(`Model inserted: ${modelId}`);
db.close();
