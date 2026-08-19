import { db } from './packages/server/src/db/index.js';
import { models } from './packages/server/src/db/schema/index.js';
import { like } from 'drizzle-orm';

async function main() {
  const rows = await db.select().from(models).where(like(models.rawName, '%doubao%')).limit(5);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

main();
