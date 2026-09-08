// dashboard 聚合与渲染。浏览器里由 dashboard.html 调 loadAndRender();
// 聚合逻辑可 `node public/dashboard.js` 直接跑自检(逻辑改了这个文件就能验证)。

// 理财五个小类:期末额字段 / 增量字段 / 显示名 / 身份色(环形、堆叠、明细共用)
const FIN_CATS = [
  { amt: 'fund',        inc: 'fundIncrease',   label: '基金',   color: '#4f8cff' },
  { amt: 'bitAmount',   inc: 'bitIncrease',    label: '币',     color: '#ffc94d' },
  { amt: 'stockAmount', inc: 'stockIncrease',  label: '股票',   color: '#ff6b6b' },
  { amt: 'zfbAmount',   inc: 'zfbIncrease',    label: '支付宝', color: '#4dd6ff' },
  { amt: 'hkStock',     inc: 'hkStockIncrease',label: '港股',   color: '#58d68d' },
];

// 涨跌语义色:资产蓝 / 赚绿 / 亏红 / 中性灰
const C = { asset: '#4f8cff', up: '#58d68d', down: '#ff6b6b', neutral: '#cbd5e1' };
// 明细趋势/排行用的资产清单 = 理财五类 + 存款(收支表 periodical,期末值由 depEnd 对齐,不走 end_ 前缀)
const ASSET_CATS = [...FIN_CATS, { amt: 'periodical', label: '存款', color: C.neutral }];
const MONO = 'ui-monospace,"SF Mono",Menlo,monospace';

const n = v => v ?? 0; // null/undefined 视为 0(早期记录字段大量为 null)
const sumBy = (rows, f) => rows.reduce((a, r) => a + n(r[f]), 0);
const lastOf = (rows, f) => rows.length ? n(rows[rows.length - 1][f]) : 0;
const yuan = v => Math.round(n(v)).toLocaleString('zh-CN') + ' 元';
const wan = v => (v / 10000).toFixed(1) + ' 万';
const sign = v => v > 0 ? '+' : '';
const cls = v => v >= 0 ? 'pos' : 'neg';
// 变化率:负号用全角 −,基数为 0/空显示 —
const pctOf = (inc, base) => base ? (inc < 0 ? '−' : '+') + Math.abs(inc / base * 100).toFixed(1) + '%' : '—';

const GRAN_LABEL = { month: '月', quarter: '季度', half: '半年', year: '年' };
const GRAN_CN = { month: '本月', quarter: '本季', half: '本期', year: '本年' };
const GRAN_EVERY = { month: '每月', quarter: '每季', half: '每半年', year: '每年' };

// time 形如 "YYYY-MM-DD"。返回 [可排序前缀, 展示名]:
// 分组按前缀字典序排序保证时间正序(Map 插入序在切到年/季后会乱)
function periodKey(time, g) {
  const y = time.slice(0, 4);
  const m = +time.slice(5, 7);
  if (g === 'month')   return [`${y}-${time.slice(5, 7)}`, `${y}-${time.slice(5, 7)}`];
  if (g === 'quarter') return [`${y}-Q${Math.ceil(m / 3)}`, `${y}年第${Math.ceil(m / 3)}季度`];
  if (g === 'half')    return [`${y}-H${m <= 6 ? 1 : 2}`, `${y}年${m <= 6 ? '上' : '下'}半年`];
  return [y, `${y}年`];
}

// 全局时间窗:按末行时间往前推 months 个月截取明细(0/空=ALL)
function rangeRows(rows, months) {
  if (!months || !rows.length) return rows;
  const [y, m] = rows[rows.length - 1].time.split('-').map(Number);
  const s = new Date(y, m - months, 1);
  const from = `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-01`;
  return rows.filter(r => r.time >= from);
}

// 按粒度分组:增量字段求和、金额字段取期末(组内最后一条),按时间正序。
// hasData=组内是否有任何理财字段非 null(理财数据 2019 年前多为 null,仅对理财表有意义)
function groupBy(rows, g) {
  const map = new Map();
  for (const r of rows) {
    if (!r.time) continue; // 无时间的脏数据直接跳过
    const [k, label] = periodKey(r.time, g);
    if (!map.has(k)) map.set(k, { label, rs: [] });
    map.get(k).rs.push(r);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, { label, rs }]) => ({
    period: label,
    count: rs.length,
    hasData: rs.some(r => FIN_CATS.some(c => r[c.amt] != null || r[c.inc] != null)),
    // 各小类:期内增量、期末额
    ...Object.fromEntries(FIN_CATS.flatMap(c => [
      [`sum_${c.inc}`, sumBy(rs, c.inc)],
      [`end_${c.amt}`, lastOf(rs, c.amt)],
    ])),
    sumIncrease: sumBy(rs, 'sumIncrease'), // 总增量
    endMoney: lastOf(rs, 'money'),         // 期末总额(理财表=理财总额,收支表=余额)
    // 收支(money 表用):期内进账/总支出(负值)、存款(零钱)期末与期内变化
    sumInmoney: sumBy(rs, 'inmoney'),
    sumOutmoneyCons: sumBy(rs, 'outmoneyCons'),
    endPeriodical: lastOf(rs, 'periodical'),
    sumPeriodicalIncrease: sumBy(rs, 'periodicalIncrease'),
  }));
}

// 裁掉开头连续的无数据组(2019–2021 的 null 平线段);中间/末尾保留
function trimLeading(groups) {
  const i = groups.findIndex(x => x.hasData);
  return i < 0 ? [] : groups.slice(i);
}

// ---------- 渲染(仅浏览器环境) ----------
const charts = {}; // 按容器 id 复用实例,切粒度/时间窗只 setOption
function chart(id, opt) {
  if (!charts[id]) charts[id] = echarts.init(document.getElementById(id));
  charts[id].setOption(opt, { replaceMerge: ['series'] });
}
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => Object.values(charts).forEach(c => c.resize()));
}

// 深色公共配置:无轴线、虚线分割、等宽刻度、深底 tooltip
const AX = {
  axisLine: { show: false }, axisTick: { show: false },
  axisLabel: { color: '#8b98a5', fontFamily: MONO, fontSize: 11 },
  splitLine: { lineStyle: { color: 'rgba(255,255,255,.07)', type: 'dashed' } },
};
const TIP = { backgroundColor: '#171e28', borderColor: '#263140', borderWidth: 1, textStyle: { color: '#e6edf3', fontFamily: MONO, fontSize: 12 } };
const LEG = { top: 2, icon: 'round', itemWidth: 9, itemHeight: 9, itemGap: 16, textStyle: { color: '#8b98a5', fontSize: 12 } };
const GRID = { left: 70, right: 56, top: 34, bottom: 28 };
const grad = hex => ({ type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: hex + '30' }, { offset: 1, color: hex + '00' }] });
const wanAxis = name => ({ type: 'value', name, nameLocation: 'end', nameGap: 12, nameTextStyle: { color: '#8b98a5', fontSize: 10 }, scale: true, ...AX, axisLabel: { ...AX.axisLabel, formatter: v => v / 10000 } });

// 四组交互状态:时间窗(月数)/ 粒度 / 增量是否按小类堆叠 / 明细单选小类('all' 或 amt 字段名)
const state = { r: 12, g: 'month', stack: false, cat: 'all' };

function renderAll() {
  const { finance, money } = window.__DATA__;
  const fin = trimLeading(groupBy(rangeRows(finance, state.r), state.g));
  const mon = groupBy(rangeRows(money, state.r), state.g);
  if (!fin.length) { document.getElementById('status').textContent = '所选范围内没有理财数据'; return; }
  const last = fin.at(-1), prev = fin.at(-2) || last;
  const monLast = mon.at(-1) || last;

  // 存款(收支表 periodical)按同期 label 对到理财分组上:期末值缺失沿用上期,增量缺失记 0
  const depEnd = (() => { const m = new Map(mon.map(x => [x.period, x.endPeriodical])); let c = 0; return fin.map(x => { const v = m.get(x.period); if (v != null) c = v; return c; }); })();
  const depInc = (() => { const m = new Map(mon.map(x => [x.period, x.sumPeriodicalIncrease])); return fin.map(x => m.get(x.period) ?? 0); })();
  // 总资产 = 理财总额 + 存款(逐期);环比基期取上一组,只有一组时同值
  const totals = fin.map((x, i) => x.endMoney + depEnd[i]);
  const endTotalLast = totals.at(-1), endTotalPrev = totals.at(-2) ?? endTotalLast;
  const incLast = last.sumIncrease + depInc.at(-1);

  // 英雄区:总资产(理财+存款) + 本期变化(环比上期总额)+ 理财入行以来(全量年度分组首末对比)
  const cum = trimLeading(groupBy(finance, 'year'));
  document.getElementById('hero-total').textContent = yuan(endTotalLast);
  document.getElementById('dk-inc').textContent = `${GRAN_CN[state.g]}变化 ${pctOf(incLast, endTotalPrev)}`;
  const di = document.getElementById('d-inc'); di.textContent = sign(incLast) + yuan(incLast); di.className = 'dv num ' + cls(incLast);
  const cumInc = cum.at(-1).endMoney - cum[0].endMoney;
  document.getElementById('dk-cum').textContent = `理财入行以来(${cum[0].period}起) ${pctOf(cumInc, cum[0].endMoney)}`;
  const dc = document.getElementById('d-cum'); dc.textContent = sign(cumInc) + yuan(cumInc); dc.className = 'dv num ' + cls(cumInc);
  document.getElementById('k-cash').textContent = yuan(monLast.endPeriodical ?? 0);
  const net = monLast.sumInmoney + monLast.sumOutmoneyCons;
  const kn = document.getElementById('k-net'); kn.textContent = sign(net) + yuan(net); kn.className = 'dv num ' + cls(net);

  // 环形图 + 占比列表:理财五类 + 存款,分母 = 期末总资产(与英雄区一致)
  const depEndLast = depEnd.at(-1), totalEnd = endTotalLast;
  const ALLOC = [...FIN_CATS.map(c => ({ label: c.label, color: c.color, v: last['end_' + c.amt] })),
    { label: '存款', color: C.neutral, v: depEndLast }];
  chart('donut', { backgroundColor: 'transparent', animation: !REDUCE,
    tooltip: { ...TIP, trigger: 'item', formatter: p => `${p.name} ${yuan(p.value)} · ${p.percent}%` },
    series: [{ type: 'pie', radius: ['62%', '86%'], center: ['50%', '50%'],
      itemStyle: { borderColor: '#10151c', borderWidth: 2, borderRadius: 4 },
      label: { show: false }, labelLine: { show: false },
      data: ALLOC.map(a => ({ name: a.label, value: a.v, itemStyle: { color: a.color } })) }] });
  document.getElementById('alloc-list').innerHTML = ALLOC.map(a =>
    `<div class="arow"><span><span class="dot" style="background:${a.color}"></span>${a.label}</span><span class="amt">${wan(a.v)}</span><span class="pct">${totalEnd ? (a.v / totalEnd * 100).toFixed(1) + '%' : '—'}</span></div>`).join('');

  // 财富增长趋势:资产线(蓝,辉光+渐变)+ 期内变化柱(绿/红)双轴
  chart('trend', { backgroundColor: 'transparent', animation: !REDUCE,
    tooltip: { trigger: 'axis', ...TIP }, legend: LEG, grid: GRID,
    xAxis: { type: 'category', data: fin.map(x => x.period), ...AX, splitLine: { show: false } },
    yAxis: [wanAxis('资产(万)'), { ...wanAxis('增量(万)'), axisLabel: { ...AX.axisLabel, formatter: v => v / 10000 }, splitLine: { show: false } }],
    series: [
      { name: '期末总资产', type: 'line', symbol: 'none', lineStyle: { width: 2.5, color: C.asset, shadowBlur: 10, shadowColor: C.asset + '55' }, itemStyle: { color: C.asset }, areaStyle: { color: grad(C.asset) }, data: totals },
      { name: '期内变化', type: 'bar', yAxisIndex: 1, barMaxWidth: 16, itemStyle: { borderRadius: 2, color: p => p.data >= 0 ? 'rgba(88,214,141,.75)' : 'rgba(255,107,107,.75)' }, data: fin.map((x, i) => x.sumIncrease + depInc[i]) },
    ] });

  // 本期表现排行:增量排序,±%=增量/期初额(期末额−增量);存款按增量(存/取)一并参与
  const mv = [...FIN_CATS.map(c => { const inc = last['sum_' + c.inc]; return { label: c.label, inc, base: last['end_' + c.amt] - inc }; }),
    { label: '存款', inc: depInc.at(-1), base: depEnd.at(-1) - depInc.at(-1) }]
    .filter(x => x.base > 0 || x.inc !== 0).sort((a, b) => b.inc - a.inc);
  document.getElementById('rank-title').textContent = `本期表现 · ${last.period}`;
  const maxAbs = Math.max(...mv.map(x => Math.abs(x.inc)), 1);
  document.getElementById('rank').innerHTML = mv.map(x => {
    const w = Math.abs(x.inc) / maxAbs * 48, up = x.inc >= 0;
    return `<div class="rrow"><span class="rl">${x.label}</span>
      <span class="bar"><i style="${up ? `left:50%;width:${w}%` : `right:50%;width:${w}%`};background:${up ? 'var(--up)' : 'var(--down)'};opacity:.8"></i></span>
      <span class="rv ${cls(x.inc)}">${sign(x.inc)}${Math.abs(x.inc) < 1e4 ? Math.round(x.inc).toLocaleString('zh-CN') : wan(x.inc)}</span>
      <span class="rp ${cls(x.inc)}">${pctOf(x.inc, x.base)}</span></div>`;
  }).join('');

  // 资产变化:默认总量绿/红柱;"按小类堆叠"展开五类 + 合计线
  document.getElementById('delta-title').textContent = `${GRAN_EVERY[state.g]}资产变化`;
  const deltaSeries = state.stack
    ? [...FIN_CATS.map(c => ({ name: c.label, type: 'bar', stack: 'd', barMaxWidth: 16, itemStyle: { color: c.color, borderRadius: 2 }, data: fin.map(x => x['sum_' + c.inc]) })),
       { name: '存款', type: 'bar', stack: 'd', barMaxWidth: 16, itemStyle: { color: 'rgba(203,213,225,.6)', borderRadius: 2 }, data: depInc },
       { name: '合计', type: 'line', symbol: 'none', lineStyle: { width: 1.5, color: C.neutral }, itemStyle: { color: C.neutral }, data: fin.map((x, i) => x.sumIncrease + depInc[i]) }]
    : [{ name: '期内变化', type: 'bar', barMaxWidth: 20, data: fin.map((x, i) => x.sumIncrease + depInc[i]).map(v => ({ value: v, itemStyle: { color: v >= 0 ? 'rgba(88,214,141,.9)' : 'rgba(255,107,107,.9)', borderRadius: v >= 0 ? [2, 2, 0, 0] : [0, 0, 2, 2] } })) }];
  chart('delta', { backgroundColor: 'transparent', animation: !REDUCE,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...TIP }, legend: LEG, grid: GRID,
    xAxis: { type: 'category', data: fin.map(x => x.period), ...AX, splitLine: { show: false } },
    yAxis: { ...wanAxis('变化(万)'), scale: false }, series: deltaSeries });

  // 收支:KPI 小票行 + 双轴图(进账/支出柱、余额线)
  document.getElementById('cash-strip').innerHTML = [
    ['本期进账', yuan(monLast.sumInmoney), 'pos'],
    ['本期支出', yuan(monLast.sumOutmoneyCons), 'neg'],
    ['净现金流', sign(net) + yuan(net), cls(net)],
    ['期末余额', yuan(monLast.endMoney), ''],
  ].map(([k, v, c]) => `<div class="cs"><span class="ck">${k}</span><span class="cv num ${c}">${v}</span></div>`).join('');
  chart('cashflow', { backgroundColor: 'transparent', animation: !REDUCE,
    tooltip: { trigger: 'axis', ...TIP }, legend: LEG, grid: GRID,
    xAxis: { type: 'category', data: mon.map(x => x.period), ...AX, splitLine: { show: false } },
    yAxis: [wanAxis('收支(万)'), { ...wanAxis('余额(万)'), splitLine: { show: false } }],
    series: [
      { name: '进账', type: 'bar', barMaxWidth: 12, itemStyle: { color: 'rgba(88,214,141,.85)', borderRadius: [2, 2, 0, 0] }, data: mon.map(x => x.sumInmoney) },
      { name: '支出', type: 'bar', barMaxWidth: 12, itemStyle: { color: 'rgba(255,107,107,.85)', borderRadius: [0, 0, 2, 2] }, data: mon.map(x => x.sumOutmoneyCons) },
      { name: '期末余额', type: 'line', yAxisIndex: 1, symbol: 'none', lineStyle: { width: 2, color: C.asset, shadowBlur: 8, shadowColor: C.asset + '55' }, itemStyle: { color: C.asset }, data: mon.map(x => x.endMoney) },
    ] });

  // 各小类明细:单选一个的小类加面积;chips 即图例(线色与圆点一致,不再放 ECharts 图例)。含存款线
  const show = state.cat === 'all' ? ASSET_CATS : ASSET_CATS.filter(c => c.amt === state.cat);
  const catData = c => c.amt === 'periodical' ? depEnd : fin.map(x => x['end_' + c.amt]);
  chart('catdetail', { backgroundColor: 'transparent', animation: !REDUCE,
    tooltip: { trigger: 'axis', ...TIP }, grid: GRID,
    xAxis: { type: 'category', data: fin.map(x => x.period), ...AX, splitLine: { show: false } },
    yAxis: wanAxis('资产(万)'),
    series: show.map(c => ({ name: c.label, type: 'line', symbol: 'none', lineStyle: { width: show.length > 1 ? 1.5 : 2.5, color: c.color, shadowBlur: 6, shadowColor: c.color + '44' }, itemStyle: { color: c.color }, areaStyle: show.length > 1 ? undefined : { color: grad(c.color) }, data: catData(c) })) });
}
const REDUCE = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- 交互绑定与取数 ----------
function bindPills(elid, attr, cb) {
  document.getElementById(elid).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll(`#${elid} button`).forEach(x => x.classList.toggle('on', x === b));
    cb(b.dataset[attr]);
  });
}

async function loadAndRender() {
  const status = document.getElementById('status');
  try {
    const res = await fetch('/money/list');
    if (res.status === 401) { location.href = 'login.html?back=dashboard.html'; return; }
    const { data } = await res.json();
    window.__DATA__ = data;
    status.textContent = `理财快照 ${data.finance.length} 条 · 收支记录 ${data.money.length} 条 · 数据截至 ${data.finance.at(-1)?.time ?? '-'}`;

    // chips(小类单选,圆点即图例)
    document.getElementById('cats').innerHTML = `<button data-c="all" class="on">全部</button>` +
      ASSET_CATS.map(c => `<button data-c="${c.amt}"><span class="cdot" style="background:${c.color}"></span>${c.label}</button>`).join('');
    document.getElementById('cats').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      document.querySelectorAll('#cats button').forEach(x => x.classList.toggle('on', x === b));
      state.cat = b.dataset.c; renderAll();
    });

    bindPills('range', 'r', v => { state.r = +v; renderAll(); });
    bindPills('gran', 'g', v => { state.g = v; renderAll(); });
    document.getElementById('stackbtn').addEventListener('click', e => {
      state.stack = !state.stack;
      e.target.classList.toggle('on', state.stack);
      e.target.setAttribute('aria-pressed', state.stack);
      renderAll();
    });

    // URL 预设:?r=3|6|12|36|0 &g=month|quarter|half|year
    const q = new URLSearchParams(location.search);
    const clickPill = (id, attr, val) => { const b = document.querySelector(`#${id} button[data-${attr}="${val}"]`); if (b) b.click(); };
    if (q.get('r') !== null && [3, 6, 12, 36, 0].includes(+q.get('r'))) clickPill('range', 'r', +q.get('r'));
    if (GRAN_LABEL[q.get('g')]) clickPill('gran', 'g', q.get('g'));
    renderAll();
  } catch (e) {
    status.textContent = '加载失败:' + e.message;
  }
}

// ---------- 自检:node public/dashboard.js ----------
function selftest() {
  const rows = [
    { time: '2026-06-30', fund: 100, fundIncrease: 10, bitAmount: 200, bitIncrease: 20, stockAmount: 300, stockIncrease: null, zfbAmount: 400, zfbIncrease: 40, hkStock: 500, hkStockIncrease: 50, sumIncrease: 120, money: 1500, inmoney: 1000, outmoneyCons: 800 },
    { time: '2026-07-15', fund: 110, fundIncrease: 10, bitAmount: 220, bitIncrease: 20, stockAmount: 330, stockIncrease: 30, zfbAmount: 440, zfbIncrease: 40, hkStock: 550, hkStockIncrease: 50, sumIncrease: 150, money: 1650, inmoney: 1000, outmoneyCons: 900 },
    { time: '2026-07-31', fund: 120, fundIncrease: 10, bitAmount: 240, bitIncrease: 20, stockAmount: 360, stockIncrease: 30, zfbAmount: 480, zfbIncrease: 40, hkStock: 600, hkStockIncrease: 50, sumIncrease: 150, money: 1800, inmoney: 1000, outmoneyCons: 900 },
  ];
  const m = groupBy(rows, 'month');
  console.assert(m.length === 2, '月分组数=2');
  console.assert(m[1].endPeriodical === 0 && m[1].sumPeriodicalIncrease === 0, '无存款字段 → 0 兜底');
  const dp = groupBy([
    { time: '2026-06-15', periodical: 90, periodicalIncrease: 10 },
    { time: '2026-06-30', periodical: 100, periodicalIncrease: -5 },
    { time: '2026-07-31', periodical: null, periodicalIncrease: null },
  ], 'month');
  console.assert(dp[0].endPeriodical === 100 && dp[0].sumPeriodicalIncrease === 5, '存款期末=组内末条,增量求和 10+(−5)');
  console.assert(dp[1].endPeriodical === 0, '存款 null → 0');
  console.assert(m[1].sumIncrease === 300, '7月总增量=两条之和(150+150)');
  console.assert(m[1].endMoney === 1800, '7月期末=最后一条');
  console.assert(m[1].sum_stockIncrease === 60, '30+30=60');
  console.assert(m[0].sum_stockIncrease === 0, 'null 视为 0');
  console.assert(m[1].end_stockAmount === 360, '期末额取最后一条');
  console.assert(m[1].sumInmoney === 2000, '进账求和');
  console.assert(m[1].hasData === true, '有理财字段 → hasData');
  const q = groupBy(rows, 'quarter');
  console.assert(q.length === 2 && q[0].period === '2026年第2季度' && q[1].period === '2026年第3季度', '季度 label 且时间正序');
  const h = groupBy(rows, 'half');
  console.assert(h[0].period === '2026年上半年' && h[1].period === '2026年下半年', '半年 label(6月上,7月下)');
  const y = groupBy(rows, 'year');
  console.assert(y[0].period === '2026年' && y[0].count === 3, '年度分组含 3 条');

  // rangeRows:末行 2026-07-31。12 个月窗口覆盖全部;1 个月只剩 7 月两条;0=ALL
  console.assert(rangeRows(rows, 12).length === 3 && rangeRows(rows, 0).length === 3, '窗口覆盖全部');
  console.assert(rangeRows(rows, 1).length === 2 && rangeRows(rows, 1)[0].time === '2026-07-15', '1 个月窗口=2026-07');
  console.assert(rangeRows(rows, 2).length === 3, '2 个月窗口含 6 月');
  console.assert(pctOf(-100, 1000) === '−10.0%' && pctOf(100, 1000) === '+10.0%' && pctOf(5, 0) === '—', 'pctOf 符号与空基数');

  // trimLeading:前导全 null 组裁掉,中间/末尾保留
  const t = groupBy([
    { time: '2019-06-30' }, { time: '2019-07-31' },
    { time: '2021-11-30', fund: 10, fundIncrease: 1 },
    { time: '2021-12-31' },
    { time: '2022-01-31', fund: 20, fundIncrease: 10 },
  ], 'month');
  const cut = trimLeading(t);
  console.assert(cut.length === 3 && cut[0].period === '2021-11', '前导两段被裁');
  console.assert(cut[1].period === '2021-12' && cut[1].hasData === false, '中间空组保留');
  console.assert(trimLeading(t.filter(x => !x.hasData)).length === 0, '全空 → 空数组');
  console.log('selftest done');
}
if (typeof require !== 'undefined' && require.main === module) selftest();
