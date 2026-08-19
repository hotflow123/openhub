/**
 * 临时脚本：手动插入缺失的目录模型
 */
import Database from "better-sqlite3";

const db = new Database("./data/openhub.db");

const models = [
  {
    id: "openai/text-embedding-3-small",
    lab_id: "openai",
    lab_name: "OpenAI",
    name: "text-embedding-3-small",
    family: "text-embedding",
    modalities_in: '["text"]',
    modalities_out: '["text"]',
    reasoning: 0,
    tool_call: 0,
    structured_output: 0,
    raw_payload: JSON.stringify({ id: "openai/text-embedding-3-small" }),
    source_url: "openhub:builtin",
  },
  {
    id: "openai/tts-1",
    lab_id: "openai",
    lab_name: "OpenAI",
    name: "TTS 1",
    family: "tts",
    modalities_in: '["text"]',
    modalities_out: '["audio"]',
    reasoning: 0,
    tool_call: 0,
    structured_output: 0,
    raw_payload: JSON.stringify({ id: "openai/tts-1" }),
    source_url: "openhub:builtin",
  },
];

const stmt = db.prepare(`
  INSERT OR IGNORE INTO model_catalog 
  (id, lab_id, lab_name, name, family, modalities_in, modalities_out, reasoning, tool_call, structured_output, raw_payload, source_url, fetched_at, created_at, updated_at)
  VALUES (@id, @lab_id, @lab_name, @name, @family, @modalities_in, @modalities_out, @reasoning, @tool_call, @structured_output, @raw_payload, @source_url, datetime('now'), datetime('now'), datetime('now'))
`);

for (const model of models) {
  stmt.run(model);
  console.log(`Inserted: ${model.id}`);
}

db.close();
console.log("Done.");
