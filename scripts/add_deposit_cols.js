/*
 * 2026-09-30:给 money_finance 加五个 *_deposit、给 money 加 periodical_deposit
 * (充值为正、提取为负;增量=本月−上月−充值)。幂等:缺则 ADD、已有则 MODIFY 归位,可安全重跑。
 * 列序约定:deposit 紧跟本项的 *_increase(零钱同理跟 periodical),与实体字段顺序一致。
 * 凭证从 src/config/config.default.ts 读取(同 seed_v1.js,不走命令行)。
 * 用法:node scripts/add_deposit_cols.js
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql');

// [列名, 注释, 归位到哪个列之后]
const COLS = {
  money_finance: [
    ['fund_deposit', '基金充值(充值为正、提取为负)', 'fund_increase'],
    ['bit_deposit', '币充值(充值为正、提取为负)', 'bit_increase'],
    ['stock_deposit', '股票充值(充值为正、提取为负)', 'stock_increase'],
    ['zfb_deposit', '支付宝充值(充值为正、提取为负)', 'zfb_increase'],
    ['hk_stock_deposit', '港股充值(充值为正、提取为负)', 'hk_stock_increase'],
  ],
  money: [['periodical_deposit', '零钱充值(充值为正、提取为负)', 'periodical']],
};

const cfgSrc = fs
  .readFileSync(path.join(__dirname, '../src/config/config.default.ts'), 'utf8')
  .split('\n')
  .filter(l => !l.trim().startsWith('//'))
  .join('\n');
const pick = k => (cfgSrc.match(new RegExp(k + ":\\s*'([^']+)'")) || [])[1];
const conn = mysql.createConnection({
  host: pick('host'),
  port: Number(pick('port') || 3306),
  user: pick('username'),
  password: pick('password'),
  database: pick('database'),
});
const q = sql => new Promise((res, rej) => conn.query(sql, (e, r) => (e ? rej(e) : res(r))));

(async () => {
  for (const [table, cols] of Object.entries(COLS)) {
    const have = new Set((await q(`SHOW COLUMNS FROM \`${table}\``)).map(r => r.Field));
    for (const [name, comment, after] of cols) {
      const def = `\`${name}\` int DEFAULT NULL COMMENT '${comment}' AFTER \`${after}\``;
      if (have.has(name)) {
        await q(`ALTER TABLE \`${table}\` MODIFY COLUMN ${def}`); // 归位(已在位则原地不动)
        console.log(`${table}.${name} 已归位到 ${after} 之后`);
      } else {
        await q(`ALTER TABLE \`${table}\` ADD COLUMN ${def}`);
        console.log(`已加列 ${table}.${name}(在 ${after} 之后)`);
      }
    }
  }
  conn.end();
})().catch(e => {
  console.error('失败:', e.message);
  process.exit(1);
});
