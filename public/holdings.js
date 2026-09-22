/* 持仓总览前端:双 tab——① 币圈「持仓驾驶舱」(照用户参考图):总资产 KPI(可隐藏金额)、
   资产分布环图、总资产走势(1D/7D/30D/1Y,OKX K线×当前持仓回溯估算)、今日收益排行、
   快捷外链、统一持仓列表(全部/现货/合约/理财 + 搜索 + 隐藏小额 + 单字母币种徽标 + sparkline)。
   ② A股/港股「每日复盘」版式(参考任务配置.md,待改版)。
   配色:全站统一绿涨红跌(A股表 .pos/.neg 与币圈 .cup/.cdn 同语义)。
   顶层纯函数可 `node public/holdings.js` 自检;判定纯函数单测 npx jest test/holding.test.ts。 */

// ---------- 可 node 自检的纯函数(无 DOM) ----------
const BRAND = {
  BTC: '#f7931a', ETH: '#627eea', SOL: '#12aa76', USDT: '#26a17b', USDC: '#2775ca', BNB: '#f0b90b',
  XRP: '#4c5c6d', DOGE: '#c2a633', OKB: '#00b897', ADA: '#1c3f94', AVAX: '#d84142', DOT: '#c4367a',
  LINK: '#2a5ada', PENGU: '#3f7fd8', FLUID: '#2f6bff', XPL: '#c47a2e', MON: '#8b5cf6', ZK: '#555f6e',
};
// 单字母币种徽标色:品牌映射 → 未知币按名称哈希取暗色调(不引外部图片)
function coinBrand(sym) {
  if (BRAND[sym]) return { bg: BRAND[sym] };
  let h = 0;
  for (const ch of String(sym || '?')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return { bg: `hsl(${h} 42% 36%)` };
}
// 现货+理财+合约 统一行(kind/pnl/pct 折成同一字段,供排行与列表共用)
function cryEnrich(d) {
  const rows = [];
  for (const r of (d && d.spot) || []) rows.push(Object.assign({}, r, { kind: 'spot', pnl: r.value != null && r.chgPct != null ? (r.value * r.chgPct) / 100 : null, pct: r.chgPct }));
  for (const r of (d && d.earn) || []) rows.push(Object.assign({}, r, { kind: 'earn', pnl: r.value != null && r.chgPct != null ? (r.value * r.chgPct) / 100 : null, pct: r.chgPct }));
  for (const r of (d && d.fut) || []) rows.push(Object.assign({}, r, { kind: 'fut', value: r.mark != null && r.qty != null ? r.mark * r.qty : null, pnl: r.upnl, pct: r.roe })); // 合约行价值=名义(列表用);环图另按保证金
  return rows;
}
// 总资产口径(2026-09 与 App 对账修正):现货 ΣeqUsd 已含合约保证金冻结的 USDT(实测 frozen≈Σmargin),
// 不能再加 futMargin(旧版双计 +1.4 万U);合约浮盈不在 eqUsd 内,加回才与 App「总资产」一致。
function cryTotals(d) {
  const t = (d && d.totals) || {};
  const base24 = (t.spotUsd || 0) + (t.earnUsd || 0); // 占比/环图分母(现货+理财,合约浮盈另列)
  const all = base24 + (t.futUpnl || 0);
  const s = (d && d.spot) || [], e = (d && d.earn) || [];
  const usdt = s.filter(r => r.sym === 'USDT').reduce((a, r) => a + (r.value || 0), 0);
  const pnl = s.concat(e).reduce((a, r) => a + (r.value != null && r.chgPct != null ? (r.value * r.chgPct) / 100 : 0), 0);
  const yd = base24 - pnl; // 昨日口径基数(现值-今日盈亏)
  return { base24, all, usdt, spotEx: (t.spotUsd || 0) - usdt, pnl, pct: yd > 0 ? (pnl / yd) * 100 : null };
}
// 资产分布:按币聚合(现货+理财同名合并)取前 top,余币并「其他」桶;分母=现货+理财(合约保证金冻结在 USDT 内,不再单列防双计)
function donutBuckets(d, top) {
  const t = cryTotals(d);
  const m = {};
  for (const r of ((d && d.spot) || []).concat((d && d.earn) || [])) if (r.value) m[r.sym] = (m[r.sym] || 0) + r.value;
  const arr = Object.keys(m).map(s => ({ sym: s, v: m[s] })).sort((a, b) => b.v - a.v);
  const n = top || 4;
  const head = arr.slice(0, n).map(x => ({ sym: x.sym, v: x.v }));
  const rest = arr.slice(n).reduce((a, x) => a + x.v, 0);
  if (rest > 0) head.push({ sym: '其他', v: rest });
  return head.map(x => ({ sym: x.sym, pct: t.base24 > 0 ? (x.v / t.base24) * 100 : 0 }));
}
// 今日收益排行:现货+理财按折算 24h 盈亏取前 n(合约开仓以来浮盈不混入)
function rankRows(d, n) {
  return cryEnrich(d).filter(r => r.kind !== 'fut' && r.pnl != null).sort((a, b) => b.pnl - a.pnl).slice(0, n || 5);
}
// sparkline 点串:归一到 w×h(pad 3px),<2 点回 ''
function sparkPts(series, w, h) {
  if (!series || series.length < 2) return '';
  const ps = series.map(s => s[1]);
  const lo = Math.min(...ps), hi = Math.max(...ps), rg = hi - lo || Math.abs(hi) || 1;
  return series.map((s, i) => `${(3 + (w - 6) * (i / (series.length - 1))).toFixed(1)},${(h - 3 - (h - 6) * ((s[1] - lo) / rg)).toFixed(1)}`).join(' ');
}
function fmtTick(t, r) {
  const d = new Date(t);
  const p = x => String(x).padStart(2, '0');
  return r === '1d' ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${d.getMonth() + 1}/${d.getDate()}`;
}
// A股复盘表现价/涨跌货币前缀:腾讯 qt 原值——A股=人民币元、港股=港币(市场名含「港」),不标单位易被当成美元
function stkCur(m) {
  return /港|hk/i.test(String(m || '')) ? 'HK$' : '¥';
}

if (typeof window !== 'undefined') {
  const el = id => document.getElementById(id);
  function fmtQuoteTime(t) {
    const d = String(t || '').replace(/\D/g, '');
    return d.length >= 12 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)} ${d.slice(8, 10)}:${d.slice(10, 12)}` : (t || '—');
  }
  const cls = x => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');
  const sign = x => (x > 0 ? '+' : '') + Number(x).toFixed(2);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const usd = (x, d = 2) => x == null || !isFinite(x) ? '—' : CUR() + cny(Number(x)).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const signed = (x, suffix = '') => x == null || !isFinite(x) ? '<span class="na">—</span>' : (x >= 0 ? '+' : '') + cny(Number(x)).toLocaleString('en-US', { maximumFractionDigits: 2 }) + suffix;
  const pctf = x => x == null || !isFinite(x) ? '<span class="na">—</span>' : (x >= 0 ? '+' : '') + Number(x).toFixed(2) + '%';
  const num2 = (x, p = '') => x == null || !isFinite(Number(x)) ? '<span class="na">—</span>' : p + Number(x).toFixed(2); // p=货币前缀(空则裸数字)
  const qtyf = q => q == null || !isFinite(Number(q)) ? '<span class="na">—</span>' : Number(q).toLocaleString('en-US', { maximumFractionDigits: Math.abs(Number(q)) < 1 ? 6 : 2 });
  const px = x => x == null || !isFinite(Number(x)) ? '<span class="na">—</span>' : Number(x) < 1 ? '$' + Number(x).toFixed(4) : u(x);
  const rngTd = r => (r && r.hi != null ? `${r.lo.toLocaleString('en-US', { maximumFractionDigits: r.hi < 1 ? 4 : 2 })} ~ ${r.hi.toLocaleString('en-US', { maximumFractionDigits: r.hi < 1 ? 4 : 2 })}` : '<span class="na">—</span>');
  const rngBar = p => p == null ? '<span class="na">—</span>'
    : `<span class="rng ${p >= 66 ? 'hi' : p <= 33 ? 'lo' : ''}"><span class="track"><span class="dot" style="left:${Math.min(96, Math.max(4, p))}%"></span></span><b>${p.toFixed(0)}%</b></span>`;
  const ccol = x => (x >= 0 ? 'cup' : 'cdn'); // 币圈绿涨红跌

  async function get(url) {
    const res = await fetch(url).catch(() => null);
    if (!res) return null;
    if (res.status === 401) { location.href = 'login.html?back=holdings.html'; return null; }
    return res.json().catch(() => null);
  }

  // ---------- ① A股/港股(复盘版式,暂未改版) ----------
  let lastQ = [], lastA = null;

  const anaRow = a => !a.tech
    ? `<tr class="ana"><td colspan="9"><span class="na">✗ ${esc(a.error || '分析无数据')} · 简评稍后随缓存重试</span></td></tr>`
    : `<tr class="ana ${a.verdict.tone}"><td colspan="9">` +
      `<span class="vt">${esc(a.verdict.text)}</span>` +
      `<span class="facts">${[
        a.tech.maBull && '均线多头',
        a.tech.aboveMa20 ? '站上MA20' : (a.tech.ma20 != null ? 'MA20下方' : ''),
        a.tech.macdUp && 'MACD偏多',
        a.tech.newHigh60 && '60日新高',
        a.tech.rsi != null && `RSI ${a.tech.rsi.toFixed(0)}`,
        a.tech.vol5_60 != null && `量5/60 ${a.tech.vol5_60.toFixed(2)}×`,
        a.tech.chg20 != null && `20日 ${a.tech.chg20 >= 0 ? '+' : ''}${a.tech.chg20.toFixed(1)}%`,
        a.rs.dd != null && a.rs.dd >= 10 && `距高点 -${a.rs.dd.toFixed(0)}%`,
      ].filter(Boolean).join(' · ')}</span></td></tr>`;

  function drawTable() {
    const rows = lastA ? lastA.rows : lastQ.map(q => ({ code: q.code, name: q.name, market: q.market, price: q.price, chg: q.chg, chgPct: q.chgPct, time: q.time, pe: null, pb: null, pending: true }));
    el('tbl').innerHTML =
      `<thead><tr><th>名称</th><th>现价</th><th>涨跌</th><th>涨跌幅</th><th>PE</th><th>PB</th><th>120日区</th><th>逻辑</th><th>行情时间</th></tr></thead><tbody>` +
      rows.map(r => {
        const nm = `<td class="nm"><b>${esc(r.name)}</b><span class="cd">${esc(r.code)}</span><span class="mk">${esc(r.market)}</span></td>`;
        if (r.pending || (r.price == null && !r.error))
          return `<tr class="main">${nm}<td colspan="8" class="na">行情获取中…</td></tr>`;
        if (r.error && !r.tech)
          return `<tr class="main">${nm}<td class="err" colspan="8">✗ ${esc(r.error)}</td></tr>`;
        const tag = r.tech ? `<span class="tg ${r.tag}" title="${esc(r.tagWhy)}"><i></i>${r.tag === 'good' ? '利好' : r.tag === 'risk' ? '风险' : '无变化'}</span>` : '<span class="na">…</span>';
        const cur = stkCur(r.market);
        return `<tr class="main">${nm}<td>${num2(r.price, cur)}</td>
          <td class="${cls(r.chg)}">${r.chg == null ? '—' : cur + sign(r.chg)}</td>
          <td class="${cls(r.chgPct)}">${r.chgPct == null ? '—' : sign(r.chgPct) + '%'}</td>
          <td>${r.pe == null ? '<span class="na">—</span>' : r.pe.toFixed(1)}</td>
          <td>${r.pb == null ? '<span class="na">—</span>' : r.pb.toFixed(2)}</td>
          <td>${r.tech ? rngBar(r.rs.pos) : '<span class="na">…</span>'}</td>
          <td>${tag}</td><td class="na">${fmtQuoteTime(r.time)}</td></tr>` +
          (r.tech || r.error ? anaRow(r) : '');
      }).join('') + '</tbody>';

    const ov = lastA && lastA.overview;
    const st = el('status');
    const mk = el('mkline');
    if (ov) {
      const ix = ov.idx.map(i => `<span class="ix">${i.n} <b class="${cls(i.pct)}">${i.pct == null ? '—' : sign(i.pct) + '%'}</b></span>`).join('');
      mk.innerHTML = ix + `<span class="meta">持仓 <b class="pos">${ov.up}涨</b> <b class="neg">${ov.down}跌</b></span>` +
        `<span class="meta">技术面实质变化 <b>${ov.changed}</b> 只</span>`;
      st.textContent = `共 ${lastA.rows.length} 只 · 复盘=腾讯120日K+qt 规则生成(60s 缓存) · 页面时间 ${new Date().toLocaleTimeString('zh-CN')}`;
    } else if (lastQ.length) {
      const bad = lastQ.filter(r => !r.ok).length;
      st.textContent = `共 ${lastQ.length} 只 · ${bad ? bad + ' 只行情失败' : '行情正常'} · 复盘中… · 页面时间 ${new Date().toLocaleTimeString('zh-CN')}`;
    }
  }

  function drawFocusDigest() {
    const f = lastA && lastA.focus, d = lastA && lastA.digest;
    const fg = el('focus'), dg = el('digest'), dn = el('dnote');
    if (!f) { fg.innerHTML = ''; dg.innerHTML = ''; dn.textContent = ''; return; }
    const card = (color, title, list) =>
      `<div class="fcard ${color}"><h4>${title}</h4>` +
      (list.length ? list.map(x => `<div class="fitem"><b>${esc(x.name)}</b><i>${esc(x.why)}</i></div>`).join('') : '<div class="fnone">— 暂无</div>') + '</div>';
    fg.innerHTML =
      card('c-blue', '🎯 超跌不坏', f.oversold) + card('c-gold', '📉 历史低位估值', f.lowVal) +
      card('c-green', '🔧 改善未反映', f.improve) + card('c-red', '⚠️ 逻辑风险', f.risk);
    const dcard = (emoji, title, x, fb) =>
      `<div class="dcard"><i>${emoji} ${title}</i>` +
      (x ? `<b>${esc(x.name)}</b><p>${esc(x.why || fb)}</p>` : `<b class="na">无</b>`) + '</div>';
    dg.innerHTML = dcard('🟢', '最值得关注', d.best, '技术面强势') + dcard('🔴', '最需警惕', d.watch, '') + dcard('💰', '超跌最值得等待', d.wait, '');
    dn.textContent = '四类与总结为技术面代理判定(无免费逐票基本面/新闻源),不构成投资建议;PE/PB 来自腾讯行情。';
  }

  // ---------- ② 币圈驾驶舱 ----------
  let CRY = null, CRYR = [], SPARK = {}, HISTS = {}, R = '1d', LT = 'all', LQ = '', LMIN = false;
  // fx=OKX 快捷买币汇率(1 USDT≈? CNY,接口带回);UNIT=用户可切换的显示币种(¥/$,localStorage 记忆),接口取不到汇率时恒 $
  let FX = null;
  let UNIT = (() => { try { return localStorage.getItem('hold-unit') === 'USD' ? 'USD' : 'CNY'; } catch (e) { return 'CNY'; } })();
  const onCny = () => UNIT === 'CNY' && FX > 0;
  const CUR = () => (onCny() ? '¥' : '$');
  const cny = x => (onCny() ? x * FX : x);
  const u = (x, d = 2) => (x == null || !isFinite(Number(x)) ? '—' : '$' + Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })); // 固定 USDT,不随切换折人民币(列表成本/价格/价值列)

  const icSpan = sym => `<span class="ic" style="background:${coinBrand(sym).bg}">${esc(String(sym).slice(0, 1))}</span>`;
  const tradeUrl = r => r.kind === 'fut'
    ? `https://www.okx.com/zh-hans/trade-swap?instId=${encodeURIComponent(r.sym + '-USDT-SWAP')}`
    : r.kind === 'earn' ? 'https://www.okx.com/zh-hans/earn'
      : `https://www.okx.com/zh-hans/trade-spot?instId=${encodeURIComponent(r.sym + '-USDT')}`;

  function drawKpi() {
    const t = cryTotals(CRY), tt = CRY.totals || {};
    el('k-total').textContent = usd(t.all, 0);
    el('k-sub').innerHTML = `<span class="${ccol(t.pnl)}">${signed(t.pnl, ' ' + CUR())}</span><span class="${ccol(t.pnl)}" style="font-size:12px">${t.pct == null ? '' : pctf(t.pct) + ' 今日'}</span>`;
    const share = v => (t.base24 > 0 ? ((v / t.base24) * 100).toFixed(1) : '—') + '%'; // 前三列占 现货+理财 之和,合约浮盈另计不摊
    el('k-cols').innerHTML = [
      ['现货·持仓', usd(t.spotEx, 0), share(t.spotEx), `${(CRY.spot || []).filter(r => r.sym !== 'USDT').length} 币种 · 交易+资金`],
      ['活期理财', usd(tt.earnUsd || 0, 0), share(tt.earnUsd || 0), `${(CRY.earn || []).length} 项 · 累计 ≈${usd(tt.earnGnc, 2)}`],
      ['USDT 余额', usd(t.usdt, 0), share(t.usdt), `含合约保证金冻结 ≈${usd(tt.futMargin, 0)}`],
      ['合约浮盈', usd(tt.futUpnl, 0), '另计', `${(CRY.fut || []).length} 笔持仓 · 保证金已计入 USDT 余额,此列不重复计`, tt.futUpnl], // 第5项=按符号染色(负红正绿)
    ].map(c => `<div class="kc"><i>${c[0]}<em>${c[2]}</em></i><b class="money${c[4] != null ? ' ' + ccol(c[4]) : ''}">${c[1]}</b><span style="color:#42505f">${c[3]}</span></div>`).join('');
  }

  function drawDonut() {
    const bs = donutBuckets(CRY);
    let acc = 0;
    const stops = bs.map(b => {
      const a0 = acc, c = BRAND[b.sym] || '#7b8a9b';
      acc += b.pct;
      return `${c} ${a0.toFixed(2)}% ${acc.toFixed(2)}%`;
    });
    el('d-ring').style.background = stops.length ? `conic-gradient(${stops.join(',')})` : 'conic-gradient(#22303f 0 100%)';
    el('d-total').textContent = usd(cryTotals(CRY).all, 0);
    el('d-leg').innerHTML = bs.map(b => `<li><s style="background:${BRAND[b.sym] || '#7b8a9b'}"></s>${esc(b.sym)}<b>${b.pct.toFixed(1)}%</b></li>`).join('') || '<li class="na">暂无持仓</li>';
    const s = CRY.sentiment;
    el('d-fng').innerHTML = s ? `<span class="fng"><span class="g"><u style="left:${Math.min(100, Math.max(0, s.value))}%"></u></span><b style="color:${s.value >= 55 ? 'var(--up)' : s.value <= 45 ? 'var(--down)' : '#e8b34b'}">${s.value}</b><span class="na" style="font-size:11px">${esc(s.label || '')}</span></span>` : '<span class="na">—</span>';
  }

  function drawRank() {
    const rows = rankRows(CRY, 5);
    el('rk').innerHTML = rows.length
      ? rows.map((r, i) => `<div class="rrow"><span class="rn">${i + 1}</span>${icSpan(r.sym)}<b style="font-size:12.5px">${esc(r.sym)}</b>` +
        `<span class="rp2 ${ccol(r.pnl)} money">${signed(r.pnl, ' ' + CUR())}</span><span class="rpx">${pctf(r.pct)}</span></div>`).join('')
      : '<div class="none">暂无可折算的 24h 盈亏(行情字段缺失)</div>';
  }

  function drawList() {
    if (!CRY) return;
    let rows = CRYR.slice();
    if (LT !== 'all') rows = rows.filter(r => r.kind === LT);
    if (LQ) rows = rows.filter(r => String(r.sym || '').indexOf(LQ) >= 0);
    if (LMIN) rows = rows.filter(r => !r.value || r.value >= 10);
    rows.sort((a, b) => (b.value || 0) - (a.value || 0));
    const head = '<thead><tr><th>币种</th><th>持仓数量</th><th>平均成本(USDT)</th><th>当前价格(USDT)</th><th>当前价值(USDT)</th><th>今日盈亏</th><th>今日涨跌幅</th><th>走势 24h</th><th>操作</th></tr></thead>';
    const body = rows.map(r => {
      if (r.error) return `<tr><td class="nm">${icSpan(r.sym)}<b style="margin-left:8px">${esc(r.sym)}</b></td><td class="err" colspan="8">✗ ${esc(r.error)}</td></tr>`;
      const tag = r.kind === 'fut' ? `<span class="dir ${r.dir}">${r.dir === 'long' ? '多' : '空'}</span>`
        : r.kind === 'earn' ? '<span class="ktag">理财</span>'
          : r.acct === 'funding' ? '<span class="acct">资金</span>' : '';
      const sub = r.kind === 'fut' ? `永续 ${r.lev ? r.lev + '×' : ''}` : r.kind === 'earn' ? '活期理财' : r.acct === 'funding' ? '资金账户' : '交易账户';
      const cost = r.kind === 'fut' ? px(r.entry) : r.cost != null ? px(r.cost) : '<span class="na">—</span>';
      const price = r.kind === 'fut' ? px(r.mark) : px(r.price);
      const sp = sparkPts(SPARK[r.sym] || [], 84, 26);
      const spHtml = sp ? (() => { const ser = SPARK[r.sym]; return `<svg class="spark" width="84" height="26" viewBox="0 0 84 26"><polyline points="${sp}" fill="none" stroke="${ser[ser.length - 1][1] >= ser[0][1] ? 'var(--up)' : 'var(--down)'}" stroke-width="1.5"/></svg>`; })() : '<span class="na">—</span>';
      return `<tr><td class="nm"><span class="c1">${icSpan(r.sym)}<span><span class="t1">${esc(r.sym)}${tag}</span><span class="t2">${esc(sub)}</span></span></span></td>
        <td ${r.kind === 'fut' ? 'title="按 名义U÷标记价 折算币数"' : ''}>${qtyf(r.qty)}</td>
        <td>${cost}</td><td>${price}</td>
        <td class="money">${r.value != null ? u(r.value) : '—'}</td>
        <td class="${r.pnl == null ? 'na' : ccol(r.pnl)} money">${r.pnl == null ? '—' : signed(r.pnl, ' ' + CUR())}</td>
        <td class="${r.pct == null ? 'na' : ccol(r.pct)}" ${r.kind === 'fut' ? 'title="合约列为开仓以来 ROE"' : ''}>${pctf(r.pct)}</td>
        <td>${spHtml}</td>
        <td class="op"><a href="${tradeUrl(r)}" target="_blank" rel="noopener">${r.kind === 'fut' ? '交易' : r.kind === 'earn' ? '理财' : '交易'}</a></td></tr>`;
    }).join('');
    el('cry-list').innerHTML = head + '<tbody>' + (body || `<tr><td class="na" colspan="9" style="text-align:center;padding:22px">当前筛选无持仓</td></tr>`) + '</tbody>';
  }

  function drawTrend() {
    if (!CRY) return;
    const box = el('tr-svg');
    const pts = ((HISTS[R] || {}).points) || [];
    if (pts.length < 2) {
      el('tr-v').textContent = '—'; el('tr-p').textContent = '';
      box.innerHTML = '<span class="na">' + (HISTS[R] ? '走势数据不足(K线不可达或持仓为空)' : '走势加载中…') + '</span>';
      return;
    }
    const first = pts[0].v, last = pts[pts.length - 1].v, dp = first > 0 ? ((last - first) / first) * 100 : null;
    el('tr-v').textContent = usd(last, 0);
    el('tr-p').innerHTML = dp == null ? '' : `<span class="${ccol(dp)}">${pctf(dp)}</span>`;
    const W = Math.max(320, box.clientWidth || 640), H = 198, L = 48, RR = 14, TP = 26, B = 22;
    const vs = pts.map(p => p.v); let lo = Math.min(...vs), hi = Math.max(...vs);
    const pad = (hi - lo) * 0.14 || Math.abs(hi) * 0.02 || 1; lo -= pad; hi += pad;
    const X = i => L + ((W - L - RR) * i) / (pts.length - 1);
    const Y = v => TP + (H - TP - B) * (1 - (v - lo) / (hi - lo));
    const fk = v => { const y = cny(v); return CUR() + (Math.abs(y) >= 10000 ? (y / 1000).toFixed(0) + 'k' : Math.abs(y) >= 1000 ? (y / 1000).toFixed(1) + 'k' : y.toFixed(0)); };
    let g = '';
    for (let i = 0; i <= 3; i++) { const v = lo + ((hi - lo) * i) / 3; g += `<line x1="${L}" y1="${Y(v).toFixed(1)}" x2="${W - RR}" y2="${Y(v).toFixed(1)}" stroke="#131c28" stroke-width="1"/><text class="axl" x="${L - 8}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${fk(v)}</text>`; }
    for (let i = 0; i <= 4; i++) { const idx = Math.round((i * (pts.length - 1)) / 4); g += `<text class="axl" x="${X(idx).toFixed(1)}" y="${H - 6}" text-anchor="middle">${fmtTick(pts[idx].t, R)}</text>`; }
    const line = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
      `<defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2ee6a8" stop-opacity=".26"/><stop offset="1" stop-color="#2ee6a8" stop-opacity="0"/></linearGradient></defs>` +
      g +
      `<polygon points="${L},${H - B} ${line} ${(W - RR)},${H - B}" fill="url(#ga)"/>` +
      `<polyline points="${line}" fill="none" stroke="#2ee6a8" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
      `<circle cx="${X(pts.length - 1).toFixed(1)}" cy="${Y(last).toFixed(1)}" r="3.4" fill="#2ee6a8"/>` +
      `</svg><span class="tagchip money" style="left:${Math.min(Math.max(52, X(pts.length - 1)), W - 52)}px;top:${Y(last)}px">${usd(last, 0)}</span>`;
  }

  async function setHist(r) {
    R = r;
    document.querySelectorAll('#rp button').forEach(b => b.classList.toggle('on', b.dataset.r === r));
    if (!HISTS[r]) {
      const j = await get('/api/holding/crypto/history?r=' + r);
      HISTS[r] = j && j.success ? j.data : { points: [] };
    }
    if (r === '1d') { SPARK = HISTS[r].spark || {}; drawList(); drawRank(); }
    drawTrend();
  }

  function renderCrypto(d, errMsg) {
    CRY = d; CRYR = d ? cryEnrich(d) : [];
    FX = d && Number(d.fx) > 0 ? Number(d.fx) : null; // OKX 快捷买币汇率,取不到退回美元
    el('kt-cur').textContent = onCny() ? '总资产 (CNY)' : '总资产 (USDT)';
    document.querySelectorAll('#unitp button').forEach(b => b.classList.toggle('on', b.dataset.u === (FX > 0 ? UNIT : 'USD')));
    const src = el('cry-src');
    if (!d) {
      src.className = 'src'; src.innerHTML = '<i></i>不可用';
      ['k-cols', 'd-leg', 'rk'].forEach(i => (el(i).innerHTML = `<span class="err">✗ ${esc(errMsg || '币圈持仓接口不可用')}</span>`));
      el('k-subacct').innerHTML = '';
      el('k-total').textContent = '—'; el('k-sub').innerHTML = ''; el('d-total').textContent = '—';
      el('tr-svg').innerHTML = '<span class="na">—</span>'; el('cry-list').innerHTML = ''; el('d-fng').textContent = '—';
      return;
    }
    src.className = 'src' + (d.source === 'okx' ? ' live' : '');
    src.innerHTML = `<i></i>${d.source === 'okx' ? 'OKX 实时账户' : '手填台账'}` +
      (d.source === 'okx' ? '' : `<span title="${esc(d.liveError || '')}">(未配 key 或请求失败,悬停看原因)</span>`);
    el('cry-upt').textContent = '更新于 ' + new Date().toLocaleString('zh-CN', { hour12: false });
    el('cnote').textContent = (onCny() ? '金额按 OKX 快捷买币汇率折人民币(1 USDT≈¥' + FX.toFixed(2) + ',可点上方 ¥/$ 切换;列表成本/价格/价值列固定 USDT); ' : '') + '总资产=现货(交易账户权益,合约保证金以冻结 USDT 形式已含)+活期理财+资金账户+合约浮动盈亏,与 App 口径对齐;今日盈亏=现货+理财按 24h 涨跌折算(不含合约);走势=OKX 公共K线 × 当前持仓数量回溯估算,非历史真实净值;资金账户/理财币无买入成本记录,均价留空;合约行“今日涨跌幅”列为开仓以来 ROE;可折算价值 <1U 的尘埃币已由服务端统一剔除,小额 <$10 可再勾选隐藏。';
    // 子账号余额单列一行:独立账户资金,未计入上面的总资产(用户要求显式标注)
    const sub = d.sub;
    el('k-subacct').innerHTML = sub && sub.count
      ? `<div class="subbox"><span class="sublab">👥 子账号 (${sub.count} 个)</span>` +
        (sub.rows || []).map((r, i) => `<span class="subchip"><u style="background:${['#4f8cff', '#e8b34b', '#58d68d', '#c4367a'][i % 4]}"></u>${esc(r.name)}<b class="money">${usd(r.usd, 0)}</b></span>`).join('') +
        `<span class="subsum"><i>合计</i><b class="money">${usd(sub.usd, 0)}</b></span><span class="subtag">独立账户 · 未计入总资产</span></div>`
      : '';
    drawKpi(); drawDonut(); drawRank(); drawList();
    HISTS = {}; setHist('1d');
  }

  // 交互:tab / 搜索 / 隐藏小额 / 周期 / 眼睛 / 主切换
  document.querySelectorAll('#ltabs button').forEach(b => b.addEventListener('click', () => {
    LT = b.dataset.k;
    document.querySelectorAll('#ltabs button').forEach(x => x.classList.toggle('on', x === b));
    drawList();
  }));
  el('lq').addEventListener('input', e => { LQ = String(e.target.value || '').trim().toUpperCase(); drawList(); });
  el('lmin').addEventListener('change', e => { LMIN = e.target.checked; drawList(); });
  document.querySelectorAll('#rp button').forEach(b => b.addEventListener('click', () => setHist(b.dataset.r)));
  el('eye').addEventListener('click', () => { const on = el('cry').classList.toggle('mask'); el('eye').textContent = on ? '🙈' : '👁'; });
  document.querySelectorAll('#unitp button').forEach(b => b.addEventListener('click', () => {
    if (UNIT === b.dataset.u) return;
    UNIT = b.dataset.u;
    try { localStorage.setItem('hold-unit', UNIT); } catch (e) {}
    if (CRY) renderCrypto(CRY); // 数据已在手,只重渲染(1d 历史会再拉一次,服务端有缓存)
  }));
  function showTab(p) {
    el('pan-cry').hidden = p !== 'cry'; el('pan-stk').hidden = p !== 'stk';
    el('status').style.display = p === 'stk' ? '' : 'none';
    el('tab-cry').classList.toggle('on', p === 'cry'); el('tab-stk').classList.toggle('on', p === 'stk');
    if (p === 'cry') requestAnimationFrame(drawTrend); // 隐藏时 clientWidth=0,切回再量
  }
  el('tab-cry').addEventListener('click', () => showTab('cry'));
  el('tab-stk').addEventListener('click', () => showTab('stk'));
  showTab('cry');
  let rsTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(rsTimer); rsTimer = setTimeout(drawTrend, 150); });

  // force=刷新按钮:带 ?fresh=1 跳过服务端 60s 缓存拿实时数(否则点了也只是重放缓存,看着像"没反应")
  function loadAndRender(force) {
    const f = force ? '?fresh=1' : '';
    get('/api/holding/quotes' + f).then(j => { if (j) { lastQ = j.data || []; drawTable(); } });
    get('/api/holding/analysis' + f).then(j => { if (j && j.success) { lastA = j.data; drawTable(); drawFocusDigest(); } });
    get('/api/holding/crypto' + f).then(j => renderCrypto(j && j.success ? j.data : null, j && !j.success ? j.message : null));
  }
  document.getElementById('refresh').onclick = () => loadAndRender(true);
  window.addEventListener('apifresh', () => loadAndRender()); // SWR(nav.js v2):后台重取成功自动替换;force 走 ?fresh=1 新 URL 本就不吃 stale
  loadAndRender(); // 同 stock.js:块内自调用
}

// ---------- node 自检:npx 之外直接 `node public/holdings.js` ----------
if (typeof window === 'undefined') {
  const assert = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
  const d = {
    spot: [{ sym: 'USDT', qty: 100, value: 100, chgPct: 0 }, { sym: 'ETH', qty: 2, value: 50, chgPct: 20, price: 25, cost: 20, acct: 'trading' }],
    earn: [{ sym: 'OKB', qty: 1, value: 250, chgPct: -10, apy: 1 }],
    fut: [{ sym: 'BTC', qty: 0.5, mark: 100, entry: 80, dir: 'long', upnl: 10, roe: 25, margin: 50 }],
    totals: { spotUsd: 150, futUpnl: 10, futMargin: 50, earnUsd: 250, earnGnc: 1 },
  };
  const t = cryTotals(d);
  // all = 现货150+理财250+浮盈10 = 410(保证金 50 已冻结在 USDT 现货内,不加回);净值 60=50+10 仅展示
  assert(t.all === 410 && t.base24 === 400 && Math.abs(t.pnl + 15) < 1e-9 && t.usdt === 100 && t.spotEx === 50 && t.futNet === undefined, 'cryTotals');
  const b = donutBuckets(d);
  assert(Math.abs(b.reduce((a, x) => a + x.pct, 0) - 100) < 0.15, 'donut sum 100');
  assert(b[0].sym === 'OKB' && b[0].pct > 55, 'donut top OKB'); // 250/400=62.5%
  assert(b.length === 3 && !b.some(x => x.sym.indexOf('保证金') >= 0), 'donut no margin bucket');
  const rr = rankRows(d, 5);
  assert(rr.length === 3 && rr[0].sym === 'ETH' && rr[1].sym === 'USDT' && rr[2].sym === 'OKB', 'rank desc pnl (fut excluded)');
  const en = cryEnrich(d).filter(x => x.kind === 'fut')[0];
  assert(en.value === 50 && en.pnl === 10 && en.pct === 25, 'fut enrich 名义/浮盈/ROE');
  const sp = sparkPts([[0, 1], [1, 2], [2, 1.5]], 84, 26);
  assert(sp.split(' ').length === 3 && /^[\d., ]+$/.test(sp) && sparkPts([], 84, 26) === '', 'sparkPts');
  assert(coinBrand('BTC').bg === '#f7931a' && /^hsl/.test(coinBrand('QQQ').bg), 'coinBrand');
  assert(fmtTick(new Date(2026, 0, 2, 9, 5).getTime(), '1d') === '09:05' && fmtTick(new Date(2026, 0, 2).getTime(), '30d') === '1/2', 'fmtTick');
  assert(stkCur('A股·沪') === '¥' && stkCur('港股') === 'HK$' && stkCur('HK') === 'HK$' && stkCur() === '¥', 'stkCur 货币前缀');
  console.log('holdings.js selftest ok (' + [t, b, rr, sp].length + ' groups)');
}
