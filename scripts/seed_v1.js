/*
 * 四板块 v1 建表落库一次性工具:执行 data/mysql.sql 中「四板块 v1」段(users/holding,可重跑)。
 * 凭证从 src/config/config.default.ts 读取,不走命令行。
 * 用法:node scripts/seed_v1.js
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql');

const cfgSrc = fs
  .readFileSync(path.join(__dirname, '../src/config/config.default.ts'), 'utf8')
  .split('\n')
  .filter(l => !l.trim().startsWith('//')) // 跳过注释掉的备用配置行
  .join('\n');
const pick = k => (cfgSrc.match(new RegExp(k + ":\\s*'([^']+)'")) || [])[1];

const conn = mysql.createConnection({
  host: pick('host'),
  port: Number(pick('port') || 3306),
  user: pick('username'),
  password: pick('password'),
  database: pick('database'),
  multipleStatements: true,
});

const sql = fs.readFileSync(path.join(__dirname, '../data/mysql.sql'), 'utf8');
const seg = sql.slice(sql.indexOf('-- ===== 四板块 v1'));
if (!seg) {
  console.error('data/mysql.sql 里找不到「四板块 v1」段');
  process.exit(1);
}

conn.query(seg, e => {
  if (e) {
    console.error('执行失败:', e.message);
    process.exit(1);
  }
  conn.query('SELECT COUNT(*) c FROM holding', (e2, r) => {
    if (e2) {
      console.error(e2.message);
      process.exit(1);
    }
    console.log(`建表完成;holding 现有 ${r[0].c} 行`);
    conn.end();
  });
});
