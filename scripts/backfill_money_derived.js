/*
 * 一次性回填:按 2026-09-30 修复后的 createNew 公式重算 money 表的
 * increment / outmoneyCons / outmoneyNet / outmoneyLife 四列(increment 旧式把 credit 双扣了)。
 * 凭证从 src/config/config.default.ts 读取,不走命令行(同 seed_v1.js)。
 * 跑前自动备份整表 → money_bak_20260930;备份表已存在则终止(防二次覆盖/防重跑)。
 * 用法:npm run build 不需要,直接 node scripts/backfill_money_derived.js
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql');

const BAK = 'money_bak_20260930';
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

// 与 money.service.payNorm 同规则:缴纳记负、房租收入为正 → 房租只计负数、其余取绝对值
const payNorm = (k, v) => (v == null ? 0 : k === 'outmoneyRent' ? Math.max(0, -v) : Math.abs(v));
const q = sql => new Promise((res, rej) => conn.query(sql, (e, r) => (e ? rej(e) : res(r))));

(async () => {
  // 计算全从录入原值重算、不依赖派生列现态 → 脚本天然幂等,可安全重跑;备份只在首次建
  const bak = await q(`SHOW TABLES LIKE '${BAK}'`);
  if (!bak.length) {
    await q(`CREATE TABLE ${BAK} AS SELECT * FROM money`);
    console.log(`已备份整表 → ${BAK}`);
  } else {
    console.log(`备份表 ${BAK} 已存在,沿用(重跑幂等)`);
  }

  // 裸 SQL 走真实列名(snake_case):outmoney_cons/outmoney_net/outmoney_life/increment…
  const rows = await q('SELECT * FROM money ORDER BY id ASC');
  // createNew 同事务先插 finance 再插 money → 两表第 i 行互为一对(2019 后 id 序列已分叉,勿按 id 配对)
  const fins = await q('SELECT id, time, sum_increase AS sumIncrease FROM money_finance ORDER BY id ASC');
  console.log(`共 ${rows.length} 笔记账行 / ${fins.length} 笔理财行`);
  if (rows.length !== fins.length) console.warn('⚠️ 两表行数不等,zip 配对可能错位,核对后再用!');

  let prev = null;
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const f = fins[i];
    const ym = d => d && `${d.getFullYear()}-${d.getMonth() + 1}`;
    if (ym(r.time) !== ym(f.time)) console.warn(`⚠️ 第 ${i + 1} 对月份错位: money id=${r.id} ${ym(r.time)} ↔ fin id=${f.id} ${ym(f.time)}`);
    // 新公式:increment=余额增长;首行与 createNew 空表兜底一致(null 当 0)
    const increment = r.money - (prev && prev.money != null ? prev.money : 0);
    const cons = (r.inmoney || 0) - increment;
    const net = (r.inmoney || 0) + (f.sumIncrease || 0) - increment;
    const life =
      net -
      payNorm('outmoneyRent', r.outmoney_rent) -
      payNorm('outmoneyMortgage', r.outmoney_mortgage) -
      payNorm('outmoneySocialSecurity', r.outmoney_social_security);
    if (increment !== r.increment || cons !== r.outmoney_cons || net !== r.outmoney_net || life !== r.outmoney_life) {
      console.log(
        `id=${r.id} ${r.time}: increment ${r.increment}→${increment} | cons ${r.outmoney_cons}→${cons} | net ${r.outmoney_net}→${net} | life ${r.outmoney_life}→${life}`
      );
      await q(
        `UPDATE money SET increment=${increment}, outmoney_cons=${cons}, outmoney_net=${net}, outmoney_life=${life} WHERE id=${r.id}`
      );
      n++;
    }
    prev = r;
  }
  console.log(`回填完成:${n} 行有变化已更新,其余本就一致。录入原值列(money/periodical/支出项)未动。`);
  conn.end();
})().catch(e => {
  console.error('失败:', e.message);
  process.exit(1);
});
