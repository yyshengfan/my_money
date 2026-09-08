/*
 * users 种子/改密一次性工具(可重跑):同一用户名重复执行即更新密码。
 * 密码哈希复用 dist/service/auth.service 的 hashPassword(改过 auth.service 要先 npm run build)。
 * 用法:node scripts/seed_user.js <用户名> <密码>
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql');
const { hashPassword } = require('../dist/service/auth.service');

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('用法:node scripts/seed_user.js <用户名> <密码>');
  process.exit(1);
}

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
});

conn.query(
  'INSERT INTO app_users (username, pass_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE pass_hash = VALUES(pass_hash)',
  [username, hashPassword(password)],
  e => {
    if (e) {
      console.error('失败:', e.message);
      process.exit(1);
    }
    console.log(`用户 ${username} 已就绪`);
    conn.end();
  }
);
