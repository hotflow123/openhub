#!/usr/bin/env tsx
import { db } from "../db/index.js";

async function main() {
  const sites = await db.query.sites.findMany();
  console.log(JSON.stringify(sites.map(s => ({ id: s.id, name: s.name, baseUrl: s.baseUrl })), null, 2));
}

main().catch(console.error);
