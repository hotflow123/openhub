import Database from 'better-sqlite3';

const db = new Database('./packages/server/db.sqlite');

console.log('=== 数据库表列表 ===');
const tables = db.prepare('SELECT name FROM sqlite_master WHERE type="table" ORDER BY name').all();
console.log(tables.map(t => t.name).join('\n'));

console.log('\n=== 目录表记录数 ===');
const catalogCount = db.prepare('SELECT COUNT(*) as count FROM model_catalog').get();
console.log(`model_catalog: ${catalogCount.count} 条`);

console.log('\n=== 目录别名表记录数 ===');
const aliasCount = db.prepare('SELECT COUNT(*) as count FROM model_catalog_alias').get();
console.log(`model_catalog_alias: ${aliasCount.count} 条`);

console.log('\n=== 站点模型实例表记录数 ===');
const modelsCount = db.prepare('SELECT COUNT(*) as count FROM models').get();
console.log(`models: ${modelsCount.count} 条`);

console.log('\n=== 变体表记录数 ===');
const variantsCount = db.prepare('SELECT COUNT(*) as count FROM variants').get();
console.log(`variants: ${variantsCount.count} 条`);

console.log('\n=== 站点表记录数 ===');
const sitesCount = db.prepare('SELECT COUNT(*) as count FROM sites').get();
console.log(`sites: ${sitesCount.count} 条`);

console.log('\n=== 目录同步记录 ===');
const syncRuns = db.prepare('SELECT * FROM catalog_sync_runs ORDER BY started_at DESC LIMIT 3').all();
console.log(syncRuns.length > 0 ? syncRuns : '无同步记录');

db.close();
