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

// 固定大头三项归一:用户记账约定「缴纳为负、房租收入为正」→ 负数取绝对值、房租正数(收入)不计;老数据正数缴纳兼容
const FIXED_KS = ['outmoneyRent', 'outmoneyMortgage', 'outmoneySocialSecurity'];
// 本期支出显性四类 = 固定三项 + 其他(2026-09-30 用户拍板去掉信用卡;理财盈亏/转入不掺)
const PAY_KS = ['outmoneyRent', 'outmoneyMortgage', 'outmoneySocialSecurity', 'outmoneyOther'];
const payAmt = (k, v) => v == null ? 0 : (k === 'outmoneyRent' ? Math.max(0, -v) : Math.abs(v));
const payTotal = (rs, ks) => rs.reduce((a, r) => a + ks.reduce((s, k) => s + payAmt(k, r[k]), 0), 0);

const GRAN_LABEL = { month: '月', quarter: '季度', half: '半年', year: '年' };
const GRAN_CN = { month: '本月', quarter: '本季', half: '本期', year: '本年' };
const GRAN_EVERY = { month: '每月', quarter: '每季', half: '每半年', year: '每年' };

// 记一笔弹窗字段 = MoneyDTO 全量(src/dto/money.dto.ts)。end=期末快照字段(打开时预填上一条),
// src:'mon' 表示从收支表取预填(periodical),默认理财表;str=文本字段
const REC_FIELDS = [
  { k: 'salary', label: '工资' },
  { k: 'inmoney', label: '总进账' },
  { k: 'credit', label: '信用卡消费' },
  { k: 'periodical', label: '零钱(期末)', end: 'periodical', src: 'mon' },
  { k: 'fund', label: '基金(期末)', end: 'fund' },
  { k: 'bitAmount', label: '币(期末)', end: 'bitAmount' },
  { k: 'stockAmount', label: '股票(期末)', end: 'stockAmount' },
  { k: 'zfbAmount', label: '支付宝(期末)', end: 'zfbAmount' },
  { k: 'hkStock', label: '港股(期末)', end: 'hkStock' },
  // 充值/提取(2026-09-30 用户加):增量=本月−上月−充值,充值为正、提取为负,无则留空按 0
  { k: 'periodicalDeposit', label: '零钱充值±', h: '充值为正、提取为负;无则留空' },
  { k: 'fundDeposit', label: '基金充值±', h: '充值为正、提取为负;无则留空' },
  { k: 'bitDeposit', label: '币充值±', h: '充值为正、提取为负;无则留空' },
  { k: 'stockDeposit', label: '股票充值±', h: '充值为正、提取为负;无则留空' },
  { k: 'zfbDeposit', label: '支付宝充值±', h: '充值为正、提取为负;无则留空' },
  { k: 'hkStockDeposit', label: '港股充值±', h: '充值为正、提取为负;无则留空' },
  { k: 'outmoneyOther', label: '其他支出' },
  { k: 'outmoneyRent', label: '房租', h: '缴纳记负数,出租收入记正数' },
  { k: 'outmoneyMortgage', label: '房贷' },
  { k: 'outmoneySocialSecurity', label: '社保' },
  { k: 'comment', label: '备注', str: true },
];

// 表单读数 → MoneyDTO(数字空/非法按 0,与后端 required number 对齐)
function recPayload(get) {
  const o = {};
  for (const f of REC_FIELDS) o[f.k] = f.str ? String(get(f.k) ?? '').trim() : Number(get(f.k)) || 0;
  return o;
}

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
    // 收支(money 表用):期内进账/显性支出、存款期末与期内变化;
    // 本期支出=显性四类 sumOutmoneyPay(2026-09-30 用户拍板,余额倒推的 cons 不再上图;同日三改不含信用卡),
    // 总支出=净支出 outmoneyNet,生活支出 = 净支出 − 固定三项(「缴纳为负」归一,「其他」计入生活)
    sumInmoney: sumBy(rs, 'inmoney'),
    sumIncrement: sumBy(rs, 'increment'),
    sumOutmoneyPay: payTotal(rs, PAY_KS),
    sumOutmoneyNet: sumBy(rs, 'outmoneyNet'),
    sumOutmoneyFixed: payTotal(rs, FIXED_KS),
    endPeriodical: lastOf(rs, 'periodical'),
    sumPeriodicalIncrease: sumBy(rs, 'periodicalIncrease'),
  }));
}

// 裁掉开头连续的无数据组(2019–2021 的 null 平线段);中间/末尾保留
function trimLeading(groups) {
  const i = groups.findIndex(x => x.hasData);
  return i < 0 ? [] : groups.slice(i);
}

// 理财盈亏总和面板(2026-09-30 用户加)的窗口选择:月度分组数组 → 选中段。
// 3m/6m/12m=末 N 组;cur=本年(自然年);custom=[from,to] 闭区间(period 为 "YYYY-MM",字符串比较即可)
function psumSel(groups, w, from, to) {
  if (w === 'cur') { const y = String(new Date().getFullYear()); return groups.filter(g => g.period.startsWith(y + '-')); }
  if (w === 'custom') return groups.filter(g => (!from || g.period >= from) && (!to || g.period <= to));
  return groups.slice(-(PS_N[w] || 12));
}
const PS_N = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 };

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
// pw/pfrom/pto = 「理财盈亏总和」面板自带窗口(与全局时间窗/粒度无关,用户 2026-09-30 要求可自选)
const state = { r: 12, g: 'month', stack: false, cat: 'all', pw: '3m', pfrom: '', pto: '' };

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

  // 英雄区(2026-09-30 用户定稿):总资产=期末余额(零钱+理财−信用卡,收支表末笔;无账回退理财+存款)
  const heroEnd = monLast.endMoney != null ? monLast.endMoney : endTotalLast;
  // 本期变化 = 表里 increment(余额增长)期内求和;收支无账回退快照差额
  const incNow = monLast.sumIncrement ?? incLast;
  const balPrev = mon.length > 1 ? mon.at(-2).endMoney : endTotalPrev; // 百分比分母=上期期末余额
  const cum = trimLeading(groupBy(finance, 'year'));
  document.getElementById('hero-total').textContent = yuan(heroEnd);
  document.getElementById('dk-inc').textContent = `${GRAN_CN[state.g]}变化 ${pctOf(incNow, balPrev)}`;
  const di = document.getElementById('d-inc'); di.textContent = sign(incNow) + yuan(incNow); di.className = 'dv num ' + cls(incNow);
  // 理财起始时间从 2022 改本年(用户 2026-09-30):基期=上一年年末快照
  const cy = cum.at(-1), cyBase = cum.at(-2) || cy;
  const cumInc = cy.endMoney - cyBase.endMoney;
  document.getElementById('dk-cum').textContent = `理财本年(${cy.period}起) ${pctOf(cumInc, cyBase.endMoney)}`;
  const dc = document.getElementById('d-cum'); dc.textContent = sign(cumInc) + yuan(cumInc); dc.className = 'dv num ' + cls(cumInc);
  document.getElementById('k-cash').textContent = yuan(monLast.endPeriodical ?? 0);
  const net = monLast.sumInmoney - monLast.sumOutmoneyPay; // 净现金流 = 进账 − 显性支出(与流水页净结余同义)
  const life = monLast.sumOutmoneyNet - monLast.sumOutmoneyFixed; // 生活支出=净支出−房租/房贷/社保,「其他」计入
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

  // 理财盈亏变化(2026-09-30 用户改:剔掉存款增量,只画理财增量;同日加充值字段后新行增量=本月−上月−充值=纯盈亏,旧行无充值仍混转入);默认总量绿/红柱,"按小类堆叠"展开五类 + 合计线
  document.getElementById('delta-title').textContent = `理财${GRAN_EVERY[state.g].slice(1)}盈亏`;
  const deltaSeries = state.stack
    ? [...FIN_CATS.map(c => ({ name: c.label, type: 'bar', stack: 'd', barMaxWidth: 16, itemStyle: { color: c.color, borderRadius: 2 }, data: fin.map(x => x['sum_' + c.inc]) })),
       { name: '合计', type: 'line', symbol: 'none', lineStyle: { width: 1.5, color: C.neutral }, itemStyle: { color: C.neutral }, data: fin.map(x => x.sumIncrease) }]
    : [{ name: '期内盈亏', type: 'bar', barMaxWidth: 20, data: fin.map(x => x.sumIncrease).map(v => ({ value: v, itemStyle: { color: v >= 0 ? 'rgba(88,214,141,.9)' : 'rgba(255,107,107,.9)', borderRadius: v >= 0 ? [2, 2, 0, 0] : [0, 0, 2, 2] } })) }];
  chart('delta', { backgroundColor: 'transparent', animation: !REDUCE,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...TIP }, legend: LEG, grid: GRID,
    xAxis: { type: 'category', data: fin.map(x => x.period), ...AX, splitLine: { show: false } },
    yAxis: { ...wanAxis('变化(万)'), scale: false }, series: deltaSeries });

  // 收支:KPI 小票行 + 双轴图(进账/支出柱、余额线)
  document.getElementById('cash-strip').innerHTML = [
    ['本期进账', yuan(monLast.sumInmoney), 'pos', '本期各笔「进账 inmoney」求和(工资等实际到账时点记录,不分来源类别)'],
    ['本期支出', yuan(monLast.sumOutmoneyPay), 'neg', '显性四类求和 = 房租缴纳 + 房贷 + 社保 + 其他(2026-09-30 起不含信用卡);约定缴纳记负数→归一取绝对值,房租正数=收入不计;不掺理财盈亏与转入转出'],
    ['总支出', yuan(monLast.sumOutmoneyNet), 'neg', '净支出(outmoneyNet)求和 = 进账 + 理财盈亏 − 余额增长(createNew 公式);2026-09-30 起新行盈亏已扣充值、转入转出不再掺入,旧行仍混(未记充值);与「本期支出」之差是残差,不是单独盈亏数'],
    ['生活支出', yuan(life), 'neg', '= 总支出(净支出) − 房租/房贷/社保三项归一;「其他支出」计入生活,不扣信用卡;为负=三项与余额快照对不上,查当月记录'],
    ['净现金流', sign(net) + yuan(net), cls(net), '= 本期进账 − 本期支出(显性四类,不含信用卡);刷卡消费还掉时才会从余额走'],
    ['期末余额', yuan(monLast.endMoney), '', '本期最后一笔记账的余额 = 零钱 + 理财总额 − 信用卡未还;与「总资产」的差=本期信用卡'],
  ].map(([k, v, c, t]) => `<div class="cs"><span class="ck"${t ? ` title="${t}"` : ''}>${k}</span><span class="cv num ${c}">${v}</span></div>`).join('');
  chart('cashflow', { backgroundColor: 'transparent', animation: !REDUCE,
    tooltip: { trigger: 'axis', ...TIP }, legend: LEG, grid: GRID,
    xAxis: { type: 'category', data: mon.map(x => x.period), ...AX, splitLine: { show: false } },
    yAxis: [wanAxis('收支(万)'), { ...wanAxis('余额(万)'), splitLine: { show: false } }],
    series: [
      { name: '进账', type: 'bar', barMaxWidth: 12, itemStyle: { color: 'rgba(88,214,141,.85)', borderRadius: [2, 2, 0, 0] }, data: mon.map(x => x.sumInmoney) },
      { name: '显性支出', type: 'bar', barMaxWidth: 12, itemStyle: { color: 'rgba(255,107,107,.85)', borderRadius: [2, 2, 0, 0] }, data: mon.map(x => x.sumOutmoneyPay) },
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

  renderPsum();
}

// 理财盈亏总和(2026-09-30 用户加):按面板自带窗口对快照差额 sumIncrease 求和 + 五类拆解,
// 不受全局时间窗/粒度影响。口径注记:2026-09-30 充值字段上线后新行=纯盈亏,旧行未记充值仍混转入转出
function renderPsum() {
  const groups = groupBy(window.__DATA__.finance, 'month');
  const sel = psumSel(groups, state.pw, state.pfrom, state.pto);
  const sum = f => sel.reduce((a, g) => a + g[f], 0);
  const total = sum('sumIncrease');
  const tEl = document.getElementById('ps-total');
  tEl.textContent = sel.length ? sign(total) + yuan(total) : '—';
  tEl.className = 'ps-total num ' + cls(total);
  tEl.title = '所选区间内「理财盈亏 sumIncrease」逐月求和。2026-09-30 起新记录增量已扣充值/提取=纯盈亏;更早的旧行未记充值,增量仍混转入转出。为负=净赎回或亏损';
  document.getElementById('ps-cov').textContent = sel.length
    ? `${sel[0].period} → ${sel.at(-1).period} · ${sel.length} 个月`
    : '该区间没有记录';
  const cats = FIN_CATS.map(c => ({ label: c.label, color: c.color, v: sum('sum_' + c.inc) }));
  const maxAbs = Math.max(...cats.map(x => Math.abs(x.v)), 1);
  document.getElementById('ps-rows').innerHTML = cats.map(x =>
    `<div class="psrow ${cls(x.v)}"><span><span class="dot" style="background:${x.color}"></span>${x.label}</span>
     <span class="bar"><i style="width:${(Math.abs(x.v) / maxAbs * 100).toFixed(0)}%"></i></span>
     <span class="pv">${sign(x.v)}${yuan(x.v)}</span></div>`).join('');
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

// 拉 /money/list 写入 __DATA__ 与状态条(首载与记一笔保存后共用)
async function refreshData() {
  const res = await fetch('/money/list');
  if (res.status === 401) { location.href = 'login.html?back=dashboard.html'; return false; }
  const { data } = await res.json();
  window.__DATA__ = data;
  document.getElementById('status').textContent = `理财快照 ${data.finance.length} 条 · 收支记录 ${data.money.length} 条 · 数据截至 ${data.finance.at(-1)?.time ?? '-'}`;
  return true;
}

async function loadAndRender() {
  const status = document.getElementById('status');
  try {
    if (!(await refreshData())) return;

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

    // 理财盈亏总和:窗口 pills + 自定义起止月(2026-09-30)
    const psCustom = document.getElementById('ps-custom');
    bindPills('psum', 'w', v => {
      state.pw = v;
      psCustom.hidden = v !== 'custom';
      if (v === 'custom' && !state.pfrom) {
        const gs = groupBy(window.__DATA__.finance, 'month');
        state.pfrom = gs[0]?.period ?? ''; state.pto = gs.at(-1)?.period ?? '';
        document.getElementById('ps-from').value = state.pfrom;
        document.getElementById('ps-to').value = state.pto;
      }
      renderPsum();
    });
    document.getElementById('ps-from').addEventListener('change', e => { state.pfrom = e.target.value; renderPsum(); });
    document.getElementById('ps-to').addEventListener('change', e => { state.pto = e.target.value; renderPsum(); });
    // 确认钮:month 输入框在原生选择器里只有「定稿」才触发 change,补一个显式应用入口(2026-09-30 用户「选了没反应」)
    document.getElementById('ps-go').addEventListener('click', () => {
      state.pfrom = document.getElementById('ps-from').value;
      state.pto = document.getElementById('ps-to').value;
      renderPsum();
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

// ---------- 记一笔弹窗(仅浏览器;dashboard.js 在 body 末尾加载,DOM 已就绪) ----------
if (typeof window !== 'undefined' && document.getElementById('rec-mask')) {
  const mask = document.getElementById('rec-mask');
  const msg = document.getElementById('rec-msg');
  const MSG0 = '快照时间记为当月月末';
  document.getElementById('rec-grid').innerHTML = REC_FIELDS.map(f =>
    `<label${f.str ? ' class="full"' : ''}>${f.label}<input id="rec-${f.k}" type="${f.str ? 'text' : 'number'}" step="1" autocomplete="off"${f.h ? ` title="${f.h}"` : ''}></label>`).join('');
  const close = () => { mask.hidden = true; };
  const open = () => {
    // 期末快照字段预填上一条(理财表;periodical 取收支表),流水类留空按 0
    const fin = (window.__DATA__?.finance ?? []).at(-1), mon = (window.__DATA__?.money ?? []).at(-1);
    for (const f of REC_FIELDS) {
      const src = f.src === 'mon' ? mon : fin;
      document.getElementById('rec-' + f.k).value = f.end ? (src?.[f.end] ?? '') : '';
    }
    msg.textContent = MSG0; msg.className = '';
    mask.hidden = false;
    document.getElementById('rec-salary').focus();
  };
  document.getElementById('newbtn').addEventListener('click', open);
  document.getElementById('rec-x').addEventListener('click', close);
  document.getElementById('rec-cancel').addEventListener('click', close);
  // 2026-10-30 用户要求:弹窗只认「取消」和右上角 ✕,点遮罩/ESC 一律不关(填一半被误触清空太疼)
  document.getElementById('rec-save').addEventListener('click', async () => {
    const btn = document.getElementById('rec-save');
    btn.disabled = true; msg.className = ''; msg.textContent = '保存中…';
    try {
      const body = recPayload(k => document.getElementById('rec-' + k).value);
      const res = await fetch('/money/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.status === 401) { location.href = 'login.html?back=dashboard.html'; return; }
      const j = await res.json();
      if (!j.success) throw new Error(j.message || '保存失败'); // 演示账号只读等
      close();
      await refreshData(); renderAll();
    } catch (e) {
      msg.textContent = e.message; msg.className = 'bad';
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- 自检:node public/dashboard.js ----------
function selftest() {
  const rows = [
    { time: '2026-06-30', fund: 100, fundIncrease: 10, bitAmount: 200, bitIncrease: 20, stockAmount: 300, stockIncrease: null, zfbAmount: 400, zfbIncrease: 40, hkStock: 500, hkStockIncrease: 50, sumIncrease: 120, money: 1500, inmoney: 1000 },
    { time: '2026-07-15', fund: 110, fundIncrease: 10, bitAmount: 220, bitIncrease: 20, stockAmount: 330, stockIncrease: 30, zfbAmount: 440, zfbIncrease: 40, hkStock: 550, hkStockIncrease: 50, sumIncrease: 150, money: 1650, inmoney: 1000, increment: 250, credit: 5000, outmoneyOther: -300, outmoneyNet: 7580, outmoneyRent: -2000, outmoneyMortgage: 0, outmoneySocialSecurity: -500 },
    { time: '2026-07-31', fund: 120, fundIncrease: 10, bitAmount: 240, bitIncrease: 20, stockAmount: 360, stockIncrease: 30, zfbAmount: 480, zfbIncrease: 40, hkStock: 600, hkStockIncrease: 50, sumIncrease: 150, money: 1800, inmoney: 1000, outmoneyNet: 10800, outmoneyRent: 1500, outmoneyMortgage: -6000, outmoneySocialSecurity: -500 },
  ];
  const m = groupBy(rows, 'month');
  console.assert(m.length === 2, '月分组数=2');
  console.assert(m[1].sumOutmoneyNet === 18380, '总支出=净支出(outmoneyNet)期内求和 7580+10800');
  console.assert(m[1].sumOutmoneyFixed === 9000, '固定大头归一=房租缴纳2000+房贷6000+社保1000(房租正数=收入不计)');
  console.assert(m[1].sumOutmoneyNet - m[1].sumOutmoneyFixed === 9380, '生活支出=净支出−三项(其他支出计入生活)');
  console.assert(m[1].sumOutmoneyPay === 9300, '本期支出=显性四类(不含刷卡):其他归一300+固定三项归一9000');
  console.assert(m[1].sumIncrement === 250, '本期变化=表里 increment 期内求和(2026-09-30 用户改口径)');
  console.assert(m[0].sumOutmoneyNet === 0 && m[0].sumOutmoneyFixed === 0 && m[0].sumOutmoneyPay === 0, '缺字段 → 0 兜底');
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

  // psumSel(理财盈亏总和面板窗口):末N组 / 自定义闭区间 / 本年按自然年
  console.assert(psumSel(m, '3m').length === 2 && psumSel(m, '12m').length === 2, '末N组不足N时全取');
  console.assert(psumSel(m, '1m').length === 1 && psumSel(m, '1m')[0].period === '2026-07', '近1月=末1组');
  console.assert(psumSel(m, 'custom', '2026-07', '').length === 1 && psumSel(m, 'custom', '2026-07', '')[0].period === '2026-07', '自定义只设起始');
  console.assert(psumSel(m, 'custom', '2026-06', '2026-06').length === 1, '自定义闭区间');
  const cur = psumSel(m, 'cur');
  console.assert(cur.every(g => g.period.startsWith(String(new Date().getFullYear()) + '-')), '本年=当前自然年');

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
  // 记一笔:REC_FIELDS 必须与 MoneyDTO(src/dto/money.dto.ts)14 个键一一对应,防漂移
  const DTO_KEYS = 'salary inmoney credit periodical fund bitAmount stockAmount zfbAmount outmoneyOther outmoneyRent outmoneyMortgage outmoneySocialSecurity hkStock comment periodicalDeposit fundDeposit bitDeposit stockDeposit zfbDeposit hkStockDeposit'.split(' ');
  console.assert(DTO_KEYS.length === REC_FIELDS.length && DTO_KEYS.every(k => REC_FIELDS.some(f => f.k === k)), 'REC_FIELDS 覆盖 MoneyDTO 全字段');
  const p = recPayload(k => ({ fund: '12.5', comment: ' x ' })[k] ?? '');
  console.assert(p.fund === 12.5 && p.salary === 0 && p.bitAmount === 0 && p.comment === 'x' && Object.keys(p).length === 20, 'recPayload 数字兜底 0、备注去空格');

  console.log('selftest done');
}
if (typeof require !== 'undefined' && require.main === module) selftest();
