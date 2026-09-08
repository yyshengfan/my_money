'use strict';
/* 资金流水页逻辑:浏览器渲染 + node 自检双模式(同 dashboard.js) */

// 显性支出字段:只用账本里明确的支出项,不掺理财盈亏(outmoneyCons/Net/Life 含市值波动,勿用)
const OF = [
  ['信用卡', 'credit'],
  ['房租', 'outmoneyRent'],
  ['房贷', 'outmoneyMortgage'],
  ['社保', 'outmoneySocialSecurity'],
  ['其他', 'outmoneyOther'],
];
const fmt = v => Math.round(v).toLocaleString('zh-CN');
const outSum = r => OF.reduce((a, [, k]) => a + (r[k] || 0), 0);
const monthRows = (rows, m) => rows.filter(r => r.time.startsWith(m));

// 连续月份轴(首账月 → 末账月),空月也能翻到
function monthAxis(rows) {
  if (!rows.length) return [];
  const [y0, m0] = rows[0].time.slice(0, 7).split('-').map(Number);
  const [y1, m1] = rows[rows.length - 1].time.slice(0, 7).split('-').map(Number);
  const out = [];
  for (let t = y0 * 12 + m0 - 1; t <= y1 * 12 + m1 - 1; t++)
    out.push(`${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`);
  return out;
}

// 单月聚合:进账/显性支出求和,期末余额取末条
function monthAgg(rs) {
  return {
    in: rs.reduce((a, r) => a + (r.inmoney || 0), 0),
    out: rs.reduce((a, r) => a + outSum(r), 0),
    bal: rs.length ? rs[rs.length - 1].money : null,
    n: rs.length,
  };
}

// 上一个有账的月(环比基期,跳过空月);返回 null 表示无历史
function prevWithRows(rows, months, mi) {
  for (let j = mi - 1; j >= 0; j--) if (monthRows(rows, months[j]).length) return months[j];
  return null;
}

// 环比文案。kind: 'good-up' 涨绿跌红(余额/进账) | 'neutral' 恒中性灰(支出,降是好事)
function tipOf(cur, prev, plab, kind) {
  if (plab == null) return '<span style="color:var(--ink-2)">无历史对比</span>';
  const d = cur - prev, p = prev ? (d / Math.abs(prev) * 100) : null;
  const arrow = d > 0 ? '↑' : d < 0 ? '↓' : '→';
  const cls = kind === 'neutral' ? 'flat' : d >= 0 ? 'good' : 'bad';
  return `较 ${plab.slice(0, 4)}年${+plab.slice(5)}月 <b class="${cls}">${arrow} ${p == null ? '—' : Math.abs(p).toFixed(1) + '%'}</b>`;
}

if (typeof window !== 'undefined') {
  const MONO = 'ui-monospace,"SF Mono",Menlo,monospace';
  const AX = { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#8b98a5', fontFamily: MONO, fontSize: 11 }, splitLine: { lineStyle: { color: '#161d27' } } };
  const TIP = { backgroundColor: '#10151c', borderColor: '#1c2530', textStyle: { color: '#e6edf3', fontFamily: MONO, fontSize: 12 } };
  let ROWS = [], months = [], AGGS = [], mi = 0, chart = null;

  async function loadAndRender() {
    const st = document.getElementById('status');
    try {
      const res = await fetch('/money/list');
      if (res.status === 401) { location.href = 'login.html?back=cashflow.html'; return; }
      const j = await res.json();
      if (!j.success) throw new Error(j.message || '接口返回失败');
      ROWS = j.data.money.slice().sort((a, b) => (a.time < b.time ? -1 : 1));
    } catch (e) {
      st.textContent = `加载失败:${e.message}(dev server 起了吗?)`;
      return;
    }
    months = monthAxis(ROWS);
    AGGS = months.map(x => monthAgg(monthRows(ROWS, x)));
    if (!months.length) { st.textContent = '收支表为空,先记一笔账'; return; }
    mi = months.length - 1;
    const qi = months.indexOf(new URLSearchParams(location.search).get('m')); // ?m=2026-08 直达
    if (qi >= 0) mi = qi;
    st.textContent = `与「我的财富」同一数据源 /money/list · 共 ${ROWS.length} 笔记账`;
    chart = echarts.init(document.getElementById('trend'));
    document.getElementById('prev').onclick = () => { if (mi > 0) { mi--; render(); } };
    document.getElementById('next').onclick = () => { if (mi < months.length - 1) { mi++; render(); } };
    window.addEventListener('resize', () => chart.resize());
    render();
  }
  loadAndRender(); // 块内自调用:新版 Chrome 不把块内 function 声明提升为全局

  function render() {
    const m = months[mi], rs = monthRows(ROWS, m);
    const agg = monthAgg(rs);
    document.getElementById('mtitle').textContent = `${m.slice(0, 4)}年${+m.slice(5)}月`;
    document.getElementById('prev').disabled = mi === 0;
    document.getElementById('next').disabled = mi === months.length - 1;
    document.getElementById('asof').textContent = rs.length ? `数据截至 ${rs[rs.length - 1].time}` : '';

    const plab = prevWithRows(ROWS, months, mi);
    const pAgg = plab ? monthAgg(monthRows(ROWS, plab)) : null;

    document.getElementById('v-bal').innerHTML = fmt(agg.bal ?? 0) + '<small>元</small>';
    document.getElementById('v-in').innerHTML = fmt(agg.in) + '<small>元</small>';
    document.getElementById('v-out').innerHTML = fmt(agg.out) + '<small>元</small>';
    document.getElementById('v-net').innerHTML = (agg.in - agg.out >= 0 ? '+' : '') + fmt(agg.in - agg.out) + '<small>元</small>';
    document.getElementById('d-bal').innerHTML = pAgg ? tipOf(agg.bal ?? 0, pAgg.bal ?? 0, plab, 'good-up') : '<span style="color:var(--ink-2)">本月未记账,余额沿用上期</span>';
    document.getElementById('d-in').innerHTML = tipOf(agg.in, pAgg ? pAgg.in : 0, plab, 'good-up');
    document.getElementById('d-out').innerHTML = tipOf(agg.out, pAgg ? pAgg.out : 0, plab, 'neutral');

    // 支出构成
    const vals = OF.map(([, k]) => rs.reduce((a, r) => a + (r[k] || 0), 0));
    const maxOf = Math.max(...vals, 1);
    document.getElementById('bars').innerHTML = OF.map(([lab], i) =>
      `<div class="b ${vals[i] ? '' : 'zero'}"><span>${lab}</span><span class="t"><i style="width:${vals[i] / maxOf * 100}%"></i></span><span class="val">${vals[i] ? fmt(vals[i]) : '—'}</span></div>`).join('');
    document.getElementById('b-tot').textContent = fmt(agg.out) + ' 元';

    // 当月流水表
    document.getElementById('thint').textContent = rs.length ? `${rs.length} 笔记账` : '本月没有记账';
    document.getElementById('tbl').innerHTML =
      `<tr><th>日期</th><th>进账</th>${OF.map(([l]) => `<th>${l}</th>`).join('')}<th>期末余额</th><th style="text-align:left">备注</th></tr>` +
      (rs.length ? rs.map(r => `<tr><td class="date">${r.time}</td><td style="color:var(--up)">${r.inmoney ? fmt(r.inmoney) : '—'}</td>` +
        OF.map(([, k]) => `<td>${r[k] ? fmt(r[k]) : '—'}</td>`).join('') +
        `<td class="money">${fmt(r.money)}</td><td class="cmt" title="${r.comment || ''}">${r.comment || '—'}</td></tr>`).join('')
        : '<tr><td colspan="9" class="empty">这个月没有账可看</td></tr>');

    // 近 12 个月走势(截止所选月):空月柱留 null,余额沿用窗口前最后已知值
    const lo = Math.max(0, mi - 11), win = months.slice(lo, mi + 1);
    let carry = null;
    for (let i = 0; i < lo; i++) if (AGGS[i].n) carry = AGGS[i].bal;
    const data = win.map((x, k) => {
      const a = AGGS[lo + k];
      if (a.n) carry = a.bal;
      return { m: x, in: a.n ? a.in : null, out: a.n ? a.out : null, bal: carry };
    });
    chart.setOption({
      tooltip: { trigger: 'axis', ...TIP },
      legend: { top: 2, right: 14, icon: 'round', itemWidth: 9, itemHeight: 9, textStyle: { color: '#8b98a5', fontSize: 12 } },
      grid: { left: 58, right: 58, top: 44, bottom: 24 },
      xAxis: { type: 'category', data: data.map(x => x.m.slice(2)), ...AX, splitLine: { show: false } },
      yAxis: [
        { type: 'value', name: '收支(万)', nameLocation: 'end', nameGap: 10, nameTextStyle: { color: '#8b98a5', fontSize: 10 }, ...AX, axisLabel: { ...AX.axisLabel, formatter: v => v / 10000 } },
        { type: 'value', name: '余额(万)', nameLocation: 'end', nameGap: 10, nameTextStyle: { color: '#8b98a5', fontSize: 10 }, scale: true, axisLabel: { ...AX.axisLabel, formatter: v => v / 10000 }, splitLine: { show: false } },
      ],
      series: [
        { name: '进账', type: 'bar', barMaxWidth: 12, itemStyle: { color: 'rgba(88,214,141,.75)', borderRadius: [2, 2, 0, 0] }, data: data.map(x => x.in) },
        { name: '显性支出', type: 'bar', barMaxWidth: 12, itemStyle: { color: 'rgba(255,107,107,.75)', borderRadius: [2, 2, 0, 0] }, data: data.map(x => x.out) },
        { name: '期末余额', type: 'line', yAxisIndex: 1, symbol: 'none', lineStyle: { width: 2, color: '#4f8cff', shadowColor: 'rgba(79,140,255,.4)', shadowBlur: 8 }, itemStyle: { color: '#4f8cff' }, data: data.map(x => x.bal) },
      ],
    }, { replaceMerge: ['series', 'xAxis', 'yAxis'] });
    document.getElementById('trend-title').textContent = win.length > 1 ? `${win[0].slice(2).replace('-', '/')} – ${win[win.length - 1].slice(2).replace('-', '/')} 走势` : '当月走势';
  }
  window.loadAndRender = loadAndRender;
}

// —— node public/cashflow.js 自检 ——
function selftest() {
  const rows = [
    { time: '2026-06-30', inmoney: 100, credit: 30, outmoneyRent: null, outmoneyMortgage: 20, outmoneySocialSecurity: 0, outmoneyOther: 5, money: 900 },
    { time: '2026-08-10', inmoney: 200, credit: 40, outmoneyRent: 10, outmoneyMortgage: 0, outmoneySocialSecurity: 0, outmoneyOther: 0, money: 1100 },
    { time: '2026-08-20', inmoney: 50, credit: 0, outmoneyRent: 0, outmoneyMortgage: 0, outmoneySocialSecurity: 0, outmoneyOther: 0, money: 1150 },
  ];
  console.assert(outSum(rows[0]) === 55, '显性支出=null/缺字段按 0,合计 30+20+5=55');
  const ms = monthAxis(rows);
  console.assert(ms.join(',') === '2026-06,2026-07,2026-08', '连续月轴补上空月');
  const a = monthAgg(monthRows(rows, '2026-08'));
  console.assert(a.in === 250 && a.bal === 1150 && a.n === 2, '8月:进账求和、余额取末条');
  console.assert(monthAgg(monthRows(rows, '2026-07')).bal === null, '空月无余额');
  console.assert(prevWithRows(rows, ms, 1) === '2026-06', '7月(空)的环比基期回退到 6 月');
  console.assert(prevWithRows(rows, ms, 0) === null, '首月无历史');
  console.assert(tipOf(50, 100, '2026-06', 'good-up').includes('bad'), '进账下降=红');
  console.assert(tipOf(50, 100, '2026-06', 'neutral').includes('flat'), '支出下降=中性灰');
  console.assert(tipOf(1, 1, null, 'good-up').includes('无历史对比'), '无基期文案');
  console.assert(tipOf(100, 0, '2026-06', 'neutral').includes('—'), '基期为 0 → 百分比缺省');
  console.log('selftest done');
}
if (typeof require !== 'undefined' && require.main === module) selftest();
