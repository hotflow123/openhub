import { db } from "../db/index.js";
import { sites } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { decrypt, getMasterKey } from "../lib/crypto.js";
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
  console.log("✓ .env 文件已加载");
} catch (err) {
  console.warn("⚠ 无法读取 .env 文件:", err);
}

console.log(`OPENHUB_MASTER_KEY: ${process.env.OPENHUB_MASTER_KEY ? '已设置 (长度: ' + process.env.OPENHUB_MASTER_KEY.length + ')' : '未设置'}\n`);

async function main() {
  const [site] = await db
    .select()
    .from(sites)
    .where(eq(sites.name, "openaa"))
    .limit(1);

  if (!site) {
    console.error("❌ 找不到站点 'openaa'");
    process.exit(1);
  }

  console.log("站点信息:");
  console.log(`  名称: ${site.name}`);
  console.log(`  ID: ${site.id}`);
  console.log(`  Base URL: ${site.baseUrl}`);
  console.log(`  apiKeyEnc: ${site.apiKeyEnc?.substring(0, 20)}...`);
  console.log(`  apiKeyIv: ${site.apiKeyIv}\n`);

  try {
    const masterKey = getMasterKey();
    const decrypted = await decrypt(site.apiKeyEnc!, site.apiKeyIv!, masterKey);
    console.log("✓ 解密成功!");
    console.log(`  解密后的 API key (前10字符): ${decrypted.substring(0, 10)}...`);
    console.log(`  解密后的 API key 长度: ${decrypted.length}`);
  } catch (err: any) {
    console.error("❌ 解密失败:");
    console.error(`  错误: ${err.message}`);
    console.error(`  原因: 可能是 OPENHUB_MASTER_KEY 与加密时使用的密钥不匹配`);
  }

  process.exit(0);
}

main();
