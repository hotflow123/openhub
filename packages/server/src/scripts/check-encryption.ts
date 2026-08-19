import { db } from "../db/index.js";
import { sites } from "../db/schema/index.js";
import { readFileSync } from "fs";
import { resolve } from "path";

// 手动加载 .env 文件
const envPath = resolve(process.cwd(), ".env");
try {
  const envContent = readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach(line => {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  });
} catch (err) {
  console.warn("无法读取 .env 文件:", err);
}

async function main() {
  console.log("检查站点加密数据...\n");

  const allSites = await db.select().from(sites);

  for (const site of allSites) {
    console.log(`站点: ${site.name}`);
    console.log(`  ID: ${site.id}`);
    console.log(`  Base URL: ${site.baseUrl}`);
    console.log(`  完整站点数据:`, JSON.stringify(site, null, 2));
    console.log(`  MASTER_KEY 设置: ${process.env.OPENHUB_MASTER_KEY ? "已设置" : "未设置"}`);
    if (process.env.OPENHUB_MASTER_KEY) {
      console.log(`  MASTER_KEY 长度: ${process.env.OPENHUB_MASTER_KEY.length}`);
    }
    console.log();
  }
}

main().catch(console.error);
