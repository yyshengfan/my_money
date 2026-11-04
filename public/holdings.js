/* 持仓总览前端:只剩币圈「持仓驾驶舱」(照用户参考图)——总资产 KPI(可隐藏金额)、
   资产分布环图、总资产走势(1D/7D/30D/1Y,OKX K线×当前持仓回溯估算)、今日收益排行、
   快捷外链、统一持仓列表(全部/现货/合约/理财 + 搜索 + 隐藏小额 + 单字母币种徽标 + sparkline)。
   2026-10-28 用户要求:A股/港股「每日复盘」并入 A股雷达页「股票观察 · 持仓复盘」(stock.js,免登录),本页去 tab。
   配色:全站统一绿涨红跌(.pos/.neg 与币圈 .cup/.cdn 同语义)。
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
  for (const r of (d && d.fut) || []) {
    // 合约行今日盈亏/涨跌幅 = 该币 1日涨跌(pc.d1,服务端 OKX 日K)×名义,空头取反向(2026-10-12 用户抓包:
    //   旧版把「开仓以来 upnl/ROE」塞进今日两列,与右边 6 个真实日线列自相矛盾);浮盈/ROE 仍在行上,列 title 展示
    const v = r.mark != null && r.qty != null ? r.mark * r.qty : null;
    const d1 = r.pc && r.pc.d1 != null ? r.pc.d1 : null;
    const s = r.dir === 'short' ? -1 : 1;
    rows.push(Object.assign({}, r, { kind: 'fut', value: v, pnl: v != null && d1 != null ? +((v * d1 * s) / 100).toFixed(2) : r.pnl, pct: d1 != null ? +(d1 * s).toFixed(1) : r.pct })); // 价值=名义(列表用);环图另按保证金;无 pc(台账/演示)回退服务端带向浮盈
  }
  return rows;
}
// 总资产口径(2026-09-30 用户三改定稿,取代 09-24 版「+合约未实现盈亏」——实测 USDT eq=cash+upl、
//   totalEq=ΣeqUsd,即现货行的 eqUsd 权益值本身已摊入合约浮盈,再加 futUpnl 是双计):
//   总资产 = 全账户逐行权益 Σ(交易现货+资金+赚币/理财),「按币种维度、不管在哪个账户」不变。
//   行数据服务端已去重(质押 OKSOL/BETH 只计赚币行,mapOkxFund exclude)。
//   base24(环图/占比分母)= 现货+理财;台账兜底路径市值无浮盈摊入,视为略保守。走势服务端同口径。
function cryTotals(d) {
  const t = (d && d.totals) || {};
  const s = (d && d.spot) || [], e = (d && d.earn) || [];
  const sum = a => a.reduce((x, r) => x + (r.value || 0), 0);
  const usdt = s.filter(r => r.sym === 'USDT').reduce((x, r) => x + (r.value || 0), 0);
  const funding = sum(s.filter(r => r.acct === 'funding'));
  const spotV = t.spotUsd != null ? t.spotUsd : sum(s);
  const earnV = t.earnUsd != null ? t.earnUsd : sum(e);
  const base24 = spotV + earnV;
  const all = base24; // eqUsd 已含摊入浮盈,勿再加 futUpnl(09-30 用户抓包双计)
  const trade = spotV - funding; // 交易账户=非资金现货权益(冻结保证金 USDT、合约浮盈均已在 eqUsd 里)
  const pnl = s.concat(e).reduce((x, r) => x + (r.value != null && r.chgPct != null ? (r.value * r.chgPct) / 100 : 0), 0);
  const yd = base24 - pnl; // 昨日口径基数(现值-今日盈亏)
  return { base24, all, usdt, spotEx: spotV - usdt, trade, funding, earn: earnV, pnl, pct: yd > 0 ? (pnl / yd) * 100 : null };
}
// 总资产大字口径(2026-10-08 用户拍板照 App 双视图):三格相加 = 交易 + 资金(去重前原始 fundRaw) + 赚币;
//   质押币(fundDup)在资金/赚币各计一次,与 App 每格一致;持仓列表/排行/收益率仍单计。无 fundRaw(台账/演示)恒等旧口径。
function grandTotal(d) {
  const t = cryTotals(d);
  return t.trade + (d && d.fundRaw != null ? d.fundRaw : t.funding) + t.earn;
}
// 资产分布:按币聚合(现货+理财同名合并)取前 top,余币并「其他」桶;
//   分母=含质押双视图(fundDup 再计一次)的行合计,与大字总资产/grandTotal 同口径(2026-10-08)
function donutBuckets(d, top) {
  const m = {};
  for (const r of ((d && d.spot) || []).concat((d && d.earn) || [])) if (r.value) m[r.sym] = (m[r.sym] || 0) + r.value;
  for (const x of (d && d.fundDup) || []) if (x.value) m[x.sym] = (m[x.sym] || 0) + x.value;
  const arr = Object.keys(m).map(s => ({ sym: s, v: m[s] })).sort((a, b) => b.v - a.v);
  const tot = arr.reduce((a, x) => a + x.v, 0);
  const n = top || 4;
  const head = arr.slice(0, n).map(x => ({ sym: x.sym, v: x.v }));
  const rest = arr.slice(n).reduce((a, x) => a + x.v, 0);
  if (rest > 0) head.push({ sym: '其他', v: rest });
  return head.map(x => ({ sym: x.sym, pct: tot > 0 ? (x.v / tot) * 100 : 0 }));
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
if (typeof window !== 'undefined') {
  const el = id => document.getElementById(id);
  const cls = x => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');
  const pcell = (v, t) => (v == null || !isFinite(Number(v)) ? '<td class="na">—</td>' : `<td class="${cls(v)}"${t ? ` title="${t}"` : ''}>${(Number(v) > 0 ? '+' : '') + Number(v).toFixed(1)}%</td>`); // 区间涨跌列(服务端 periodChg;t=合约行开仓夹注)
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const usd = (x, d = 2) => x == null || !isFinite(x) ? '—' : CUR() + cny(Number(x)).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const signed = (x, suffix = '') => x == null || !isFinite(x) ? '<span class="na">—</span>' : (x >= 0 ? '+' : '') + cny(Number(x)).toLocaleString('en-US', { maximumFractionDigits: 2 }) + suffix;
  const pctf = x => x == null || !isFinite(x) ? '<span class="na">—</span>' : (x >= 0 ? '+' : '') + Number(x).toFixed(2) + '%';
  const qtyf = q => q == null || !isFinite(Number(q)) ? '<span class="na">—</span>' : Number(q).toLocaleString('en-US', { maximumFractionDigits: Math.abs(Number(q)) < 1 ? 6 : 2 });
  const px = x => x == null || !isFinite(Number(x)) ? '<span class="na">—</span>' : Number(x) < 1 ? '$' + Number(x).toFixed(4) : u(x);
  const ccol = x => (x >= 0 ? 'cup' : 'cdn'); // 币圈绿涨红跌

  async function get(url) {
    const res = await fetch(url).catch(() => null);
    if (!res) return null;
    if (res.status === 401) { location.href = 'login.html?back=holdings.html'; return null; }
    return res.json().catch(() => null);
  }

  // ---------- 币圈驾驶舱(2026-10-28 起 A股/港股复盘并入 stock 页「股票观察 · 持仓复盘」,本页只剩这一块) ----------
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
    const fundV = CRY.fundRaw != null ? CRY.fundRaw : t.funding; // 照 App 双视图(2026-10-08 用户拍板):资金格=去重前原始合计(含 OKSOL 质押)
    const totalV = t.trade + fundV + t.earn; // 总资产大字=三格相加;质押双视图在资金/赚币各计一次,与 App 一致(持仓列表/排行仍只列一次);台账/演示 fundV=去重值,恒等旧口径
    el('k-total').textContent = usd(totalV, 0);
    el('k-sub').innerHTML = `<span class="${ccol(t.pnl)}">${signed(t.pnl, ' ' + CUR())}</span><span class="${ccol(t.pnl)}" style="font-size:12px">${t.pct == null ? '' : pctf(t.pct) + ' 今日'}</span>`;
    const share = v => (totalV > 0 ? ((v / totalV) * 100).toFixed(1) : '—') + '%'; // 占比分母=三格相加总额,恒 100%
    el('k-cols').innerHTML = [
      ['交易账户', usd(t.trade, 0), share(t.trade), `${(CRY.spot || []).filter(r => r.acct !== 'funding').length} 币 · 含保证金 ${usd(tt.futMargin, 0)} · 浮盈 ${usd(tt.futUpnl, 0)} 已摊入权益`],
      ['资金账户', usd(fundV, 0), share(fundV), '可用余额 · 含质押(与赚币格同笔,总资产只计一次)'],
      ['赚币账户', usd(t.earn, 0), share(t.earn), `${(CRY.earn || []).length} 项 · 含质押/闪赚估算 · 累计利息 ≈${usd(tt.earnGnc, 2)}`],
      ['合约浮盈', usd(tt.futUpnl, 0), '已摊入', `${(CRY.fut || []).length} 笔持仓 · 已含在上方账户权益(eqUsd),此列仅查看`, tt.futUpnl], // 第5项=按符号染色(负红正绿)
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
    el('d-total').textContent = usd(grandTotal(CRY), 0); // 环图中心=三格相加总额(双视图口径),与大字一致
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
    const pcT = 'OKX 日K(北京0点日界)·现价 vs N自然日前收盘;稳定币/无对/上市不足显 —';
    const head = '<thead><tr><th>币种</th><th>持仓数量</th><th>平均成本(USDT)</th><th>当前价格(USDT)</th><th>当前价值(USDT)</th><th>今日盈亏</th><th>今日涨跌幅</th><th title="' + pcT + '">1日</th><th title="' + pcT + '">7日</th><th title="' + pcT + '">30日</th><th title="' + pcT + '">90日</th><th title="' + pcT + '">180日</th><th title="' + pcT + '">1年</th><th>走势 24h</th><th>操作</th></tr></thead>';
    const body = rows.map(r => {
      if (r.error) return `<tr><td class="nm">${icSpan(r.sym)}<b style="margin-left:8px">${esc(r.sym)}</b></td><td class="err" colspan="14">✗ ${esc(r.error)}</td></tr>`;
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
        <td class="${r.pnl == null ? 'na' : ccol(r.pnl)} money" ${r.kind === 'fut' ? `title="开仓以来浮盈 ${r.upnl == null ? '—' : r.upnl + 'U'}·ROE ${r.roe == null ? '—' : r.roe.toFixed(1) + '%'}(本列=1日涨跌×名义,空头反向)"` : ''}>${r.pnl == null ? '—' : signed(r.pnl, ' ' + CUR())}</td>
        <td class="${r.pct == null ? 'na' : ccol(r.pct)}" ${r.kind === 'fut' ? `title="开仓以来 ROE ${r.roe == null ? '—' : r.roe.toFixed(1) + '%'}(本列=该币1日涨跌,空头反向)"` : ''}>${pctf(r.pct)}</td>
        ${(() => { const tip = r.kind === 'fut' && r.openDay ? `开仓日 ${r.openDay}:超出持仓时长的档=合约总盈亏率(App 收益率口径,开仓 ROE);持满的档=该币区间涨跌` : (r.pc && r.pc.yld != null ? `无日K行情的档已回填${r.pc.yldSrc === 'earn' ? '理财累计利息收益率(利息÷持仓)' : '持仓收益率(现价 vs 成本均价)'}` : ''); return pcell(r.pc && r.pc.d1, tip) + pcell(r.pc && r.pc.d7, tip) + pcell(r.pc && r.pc.d30, tip) + pcell(r.pc && r.pc.d90, tip) + pcell(r.pc && r.pc.d180, tip) + pcell(r.pc && r.pc.d365, tip); })()}
        <td>${spHtml}</td>
        <td class="op"><a href="${tradeUrl(r)}" target="_blank" rel="noopener">${r.kind === 'fut' ? '交易' : r.kind === 'earn' ? '理财' : '交易'}</a></td></tr>`;
    }).join('');
    el('cry-list').innerHTML = head + '<tbody>' + (body || `<tr><td class="na" colspan="15" style="text-align:center;padding:22px">当前筛选无持仓</td></tr>`) + '</tbody>';
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
    src.innerHTML = `<i></i>${d.source === 'okx' ? 'OKX 实时账户' : d.source === 'demo' ? '演示数据' : '手填台账'}` +
      (d.source === 'ledger' ? `<span title="${esc(d.liveError || '')}">(未配 key 或请求失败,悬停看原因)</span>` : '');
    el('cry-upt').textContent = '更新于 ' + new Date().toLocaleString('zh-CN', { hour12: false });
    el('cnote').textContent = (onCny() ? '金额按 OKX 快捷买币汇率折人民币(1 USDT≈¥' + FX.toFixed(2) + ',可点上方 ¥/$ 切换;列表成本/价格/价值列固定 USDT); ' : '') + '总资产=交易+资金+赚币三格相加(照 App 双视图:质押 OKSOL 在资金/赚币两格各计一次,2026-10-08 用户拍板;持仓列表与排行仍只列一次);OKX 权益值(eqUsd)已含合约未实现盈亏与冻结保证金,不再另加(浮盈卡仅查看);今日盈亏=现货+理财按 24h 涨跌折算(不含合约);走势=OKX 公共K线 × 当前持仓数量回溯估算(闪赚等无明细行按现值计常量),非历史真实净值;资金账户/理财币无买入成本记录,均价留空;合约行“今日盈亏/涨跌幅”列=该币 1 日涨跌×名义(空头反向),开仓以来浮盈/ROE 见列悬停;合约行区间涨跌:超出持仓时长的档(含1年)显示合约总盈亏率(与 App 收益率同口径),持满的档为该币区间涨跌(2026-10-12 用户对照 App 定稿);非合约行该档无日K行情(稳定币/新上市等)时回填这笔资产总收益率——理财=累计利息÷持仓、现货=现价 vs 成本均价,无成本记录仍显 —(2026-10-12 用户拍板「按成本收益率填」);可折算价值 <1U 的尘埃币已由服务端统一剔除,小额 <$10 可再勾选隐藏。';
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
  let rsTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(rsTimer); rsTimer = setTimeout(drawTrend, 150); });

  // 2026-09-22 用户要求:本板块不走任何缓存(nav.js 对 /api/holding 已免读免写,服务端也实时直连),
  // 首帧无数据时显示「加载中」;?fresh=1 仅作手动刷新的扫描光带触发标记,服务端不再区分
  function loadAndRender(force) {
    const f = force ? '?fresh=1' : '';
    if (!CRY) el('cry-src').innerHTML = '<i></i>加载中…';
    get('/api/holding/crypto' + f).then(j => renderCrypto(j && j.success ? j.data : null, j && !j.success ? j.message : null));
  }
  // 板块 ⟳(持仓豁免缓存,panelFetch 也不写)
  window.panelRef = {
    'pan-cry': async () => { const j = await panelFetch('/api/holding/crypto'); renderCrypto(j && j.success ? j.data : null, j && !j.success ? j.message : null); },
  };
  document.getElementById('refresh').onclick = () => loadAndRender(true);
  loadAndRender(); // 同 stock.js:块内自调用
}

// ---------- node 自检:npx 之外直接 `node public/holdings.js` ----------
if (typeof window === 'undefined') {
  const assert = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
  const d = {
    spot: [{ sym: 'USDT', qty: 100, value: 100, chgPct: 0 }, { sym: 'ETH', qty: 2, value: 50, chgPct: 20, price: 25, cost: 20, acct: 'trading' }],
    earn: [{ sym: 'OKB', qty: 1, value: 250, chgPct: -10, apy: 1 }],
    fut: [{ sym: 'BTC', qty: 0.5, mark: 100, entry: 80, dir: 'long', upnl: 10, roe: 25, margin: 50, pc: { d1: -10 } },
      { sym: 'ETH', qty: 1, mark: 100, entry: 120, dir: 'short', upnl: 20, roe: 20, margin: 100, pc: { d1: -4 } },
      { sym: 'SOL', qty: 2, mark: 50, entry: 40, dir: 'short', upnl: 20, roe: 10, margin: 20, pnl: -20, pct: -10 }], // 台账路:无 pc 回退服务端带向 pnl/pct
    totals: { spotUsd: 150, futUpnl: 10, futMargin: 50, earnUsd: 250, earnGnc: 1 },
  };
  const t = cryTotals(d);
  // 逐币种全账户口径:现货150+理财250 = 400(eqUsd 已含浮盈,totals.futUpnl 不得再加);环图分母 base24=400
  assert(t.all === 400 && t.base24 === 400 && Math.abs(t.pnl + 15) < 1e-9 && t.usdt === 100 && t.spotEx === 50 && Math.abs(t.trade - 150) < 1e-9 && t.funding === 0, 'cryTotals 逐币种(浮盈不另加)');
  // 资金账户行(CP)并入现货Σ:总资产=150+40+250=440;交易格=现货非资金=150,资金/浮盈不重复计
  const d3 = JSON.parse(JSON.stringify(d));
  d3.spot.push({ sym: 'CP', acct: 'funding', qty: 83.87, value: 40, chgPct: -0.7 });
  d3.totals.spotUsd = 190;
  const t3 = cryTotals(d3);
  assert(t3.all === 440 && t3.funding === 40 && Math.abs(t3.trade - 150) < 1e-9 && t3.base24 === 440, 'cryTotals 含资金行');
  const b = donutBuckets(d);
  assert(Math.abs(b.reduce((a, x) => a + x.pct, 0) - 100) < 0.15, 'donut sum 100');
  // 双视图(2026-10-08):质押行在赚币已计,fundDup 再计一次 → 分母含双计、仍 100%;大字同口径
  const db = donutBuckets(Object.assign({}, d, { fundDup: [{ sym: 'SOL', value: 100 }] }));
  assert(Math.abs(db.reduce((a, x) => a + x.pct, 0) - 100) < 0.15, 'donut 双视图 sum 100');
  // d 基座:trade 150 + earn 250、无资金行(funding 0);fundRaw=100(=质押双计)→ 三格和 500=all+100
  assert(grandTotal(Object.assign({}, d, { fundRaw: 100 })) === 500 && grandTotal(d) === cryTotals(d).all, 'grandTotal 三格相加(含/不含 fundRaw)');
  assert(b[0].sym === 'OKB' && b[0].pct > 55, 'donut top OKB'); // 250/400=62.5%
  assert(b.length === 3 && !b.some(x => x.sym.indexOf('保证金') >= 0), 'donut no margin bucket');
  const rr = rankRows(d, 5);
  assert(rr.length === 3 && rr[0].sym === 'ETH' && rr[1].sym === 'USDT' && rr[2].sym === 'OKB', 'rank desc pnl (fut excluded)');
  const enf = cryEnrich(d).filter(x => x.kind === 'fut');
  assert(enf[0].value === 50 && enf[0].pnl === -5 && enf[0].pct === -10, 'fut 今日列=1日×名义(多头)');
  assert(enf[1].pct === 4 && enf[1].pnl === 4, 'fut 今日列空头反向');
  assert(enf[2].pct === -10 && enf[2].pnl === -20 && enf[2].upnl === 20, 'fut 无pc回退服务端带向pnl(浮盈仍留行上供title)');
  const sp = sparkPts([[0, 1], [1, 2], [2, 1.5]], 84, 26);
  assert(sp.split(' ').length === 3 && /^[\d., ]+$/.test(sp) && sparkPts([], 84, 26) === '', 'sparkPts');
  assert(coinBrand('BTC').bg === '#f7931a' && /^hsl/.test(coinBrand('QQQ').bg), 'coinBrand');
  assert(fmtTick(new Date(2026, 0, 2, 9, 5).getTime(), '1d') === '09:05' && fmtTick(new Date(2026, 0, 2).getTime(), '30d') === '1/2', 'fmtTick');
  console.log('holdings.js selftest ok (' + [t, b, rr, sp].length + ' groups)');
}
