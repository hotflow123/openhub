import Database from "better-sqlite3";

const db = new Database("F:/code/测试/packages/server/data/openhub.db");

const stmt = db.prepare("INSERT OR IGNORE INTO models (id, site_id, remote_id, name) VALUES (?, ?, ?, ?)");
stmt.run("m_test_gpt4o", "wODWwsobZRvFM_fQy3Bw8", "gpt-4o-mini", "gpt-4o-mini");

const rows = db.prepare("SELECT * FROM models").all();
console.log(JSON.stringify(rows, null, 2));