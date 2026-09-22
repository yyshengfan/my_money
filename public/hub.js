/* 首页「投资雷达」:跨市场总览。只消费已有端点(A股 stock/market+opportunity,币圈 crypto/overview,登录 me)。
   四区:① Market Pulse(跨市场氛围)② A股/币圈核心行情 ③ 今日信号(纯派生事实)④ 机会与动量。
   与各雷达页同口径:温度公式抄 stock.js,恐慌贪婪抄 crypto.js。纯函数置顶层,可 node public/hub.js 自检。
   配色:全站统一绿涨红跌(A股/币圈同规则;其余色块:绿=暖/升,红=冷/跌)。 */

// ---------- 顶层纯函数(自检用) ----------

function pN(v) { // 数字安全取数:null/''/非数 → null(注意 Number('')===0)
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function sp(x) { return pN(x) == null ? '' : (x > 0 ? '+' : ''); } // 只补正号:负数由 toFixed() 自带负号,避免 '--'

// alternative.me 档位(与 crypto.js 一致):0-24 极度恐惧 … 75-100 极度贪婪
function fngLabel(v) { return v <= 24 ? '极度恐惧' : v <= 49 ? '恐惧' : v <= 74 ? '贪婪' : '极度贪婪'; }
function fngColor(v) { return v <= 24 ? 'var(--down)' : v <= 49 ? '#ff9f6b' : v <= 74 ? 'var(--up)' : '#2ecc71'; }

// 温度数值 → 热度色(热=红橙,冷=蓝绿;与涨跌色无关)
function heatColor(score) { return score >= 78 ? '#ff5d5d' : score >= 58 ? '#ffb454' : score >= 42 ? '#e8edf3' : score >= 25 ? '#7fd7ff' : '#58d68d'; }

// A股市场温度(公式抄 stock.js marketTemp:指数40/涨跌家数40/涨停跌停20,缺项剔除权重归一)
function aTemp(idxPct, ratio, zt, dt) {
  const have = [pN(idxPct) != null, pN(ratio) != null, pN(zt) != null && pN(dt) != null];
  if (!have.some(Boolean)) return null;
  const c = [
    have[0] ? clamp01((pN(idxPct) / 3 + 1) / 2) : null,
    have[1] ? clamp01((pN(ratio) - 0.2) / 0.6) : null,
    have[2] ? clamp01((pN(zt) - pN(dt)) / 60 + 0.5) : null,
  ];
  const W = [40, 40, 20];
  let s = 0, wsum = 0;
  for (let i = 0; i < 3; i++) if (c[i] != null) { s += c[i] * W[i]; wsum += W[i]; }
  const score = Math.round(100 * s / wsum);
  const label = score >= 78 ? '极强' : score >= 58 ? '偏强' : score >= 42 ? '中性' : score >= 25 ? '偏弱' : '极弱';
  return { score, label, color: heatColor(score) };
}

// Pulse 一句话氛围(纯启发式,非建议)。入参:a=A股温度|null;fng=恐慌贪婪数值|null;mcap=总市值24h%|null
function pulseTone(a, fng, mcap) {
  const parts = [];
  if (a) parts.push(a.score >= 58 ? 'h' : a.score >= 42 ? 'm' : 'c');
  if (fng != null) parts.push(fng >= 55 ? 'h' : fng >= 45 ? 'm' : 'c');
  else if (mcap != null) parts.push(mcap > 0 ? 'h' : mcap < -1 ? 'c' : 'm');
  if (!parts.length) return { dot: '⚪', txt: '数据暂不可用', hd: '两个市场都在等数据,稍后自动刷新' };
  const hs = parts.filter(x => x === 'h').length, cs = parts.filter(x => x === 'c').length;
  if (hs > cs) return { dot: '🟢', txt: '市场风险偏好回升', hd: '资金偏暖 · 进攻性机会更占优' };
  if (cs > hs) return { dot: '🔴', txt: '市场风险偏好收缩', hd: '资金偏冷 · 防御为主,等信号转暖' };
  return { dot: '🟡', txt: '市场涨跌互现', hd: '整体中性 · 结构性机会为主' };
}

// 今日财运档位(纯展示;score 为后端 /api/fortune 给的 50~100 整数,娱乐非建议)
function fortuneTier(s) {
  return s >= 95 ? { label: '财运爆棚', line: '大财临门,记得请客吃饭', color: '#ff5d5d' }
    : s >= 80 ? { label: '财运旺旺', line: '财势看涨,敢做敢当有进账', color: '#ffb454' }
    : s >= 65 ? { label: '小有进项', line: '小机会多留意,别贪大', color: '#ffd27f' }
    : { label: '细水长流', line: '财运平稳,先把主业干好', color: '#7fd7ff' };
}

// 宏观温度(纯启发式,非建议):纳指/利率/金/油四票判「对风险资产友好(+1)/不利(-1)/中性(0)」,
// 合计 ≥+2 → RISK ON,≤-2 → RISK OFF,其余 NEUTRAL;缺项(null)自动剔除,信号不足时倾向 NEUTRAL。
// 入参:ndxPct=纳指30日%、y10Bp=美债10Y 30日基点(回落为友好)、goldPct=金%(避险,走高为不利)、oilPct=油%(通胀压力,走高温为不利)
function macroRegime(ndxPct, y10Bp, goldPct, oilPct) {
  let sum = 0; const p = [];
  const vote = (s, txt) => { sum += s; p.push(txt); };
  if (ndxPct != null) { const s = ndxPct > 0.5 ? 1 : ndxPct < -0.5 ? -1 : 0; vote(s, s > 0 ? '纳指走强' : s < 0 ? '纳指走弱' : '纳指横盘'); }
  if (y10Bp != null) { const s = y10Bp < -5 ? 1 : y10Bp > 5 ? -1 : 0; vote(s, s > 0 ? '美债收益率回落' : s < 0 ? '美债收益率抬升' : '美债利率持稳'); }
  if (goldPct != null) { const s = goldPct < -2 ? 1 : goldPct > 2 ? -1 : 0; vote(s, s > 0 ? '黄金退潮' : s < 0 ? '避险买盘推升金价' : '黄金平稳'); }
  if (oilPct != null) { const s = oilPct < -3 ? 1 : oilPct > 3 ? -1 : 0; vote(s, s > 0 ? '原油回落(通胀降温)' : s < 0 ? '原油通胀压力' : '原油震荡'); }
  if (!p.length) return { dot: '⚪', txt: '宏观数据暂不可用', hd: '' };
  const on = sum >= 2, off = sum <= -2;
  return {
    sum, // THRR 温度计要原始票数
    dot: on ? '🟢' : off ? '🔴' : '🟡',
    txt: on ? 'RISK ON · 全球风险偏好偏积极' : off ? 'RISK OFF · 利率/避险双重压力,风险资产逆风' : 'NEUTRAL · 宏观信号分歧',
    hd: p.join(' · '),
  };
}

// THRR 合成市场温度:A股温度40 / 宏观票数30((sum+4)/8 映射到 0~1)/ 恐慌贪婪30;
// 缺项剔权重归一(与 aTemp 同套路),全缺 → null(页面画 0 环 + "等数据")。
function mktTemp(aScore, regSum, fng) {
  const c = [aScore == null ? null : clamp01(aScore / 100),
    regSum == null ? null : clamp01((regSum + 4) / 8),
    fng == null ? null : clamp01(fng / 100)];
  const W = [40, 30, 30];
  let s = 0, w = 0;
  for (let i = 0; i < 3; i++) if (c[i] != null) { s += c[i] * W[i]; w += W[i]; }
  if (!w) return null;
  const score = Math.round(100 * s / w);
  return { score, color: heatColor(score), label: score >= 78 ? '极热' : score >= 58 ? '偏热' : score >= 42 ? '中性' : score >= 25 ? '偏冷' : '极冷' };
}

// 背景呼吸档位:参与平均的 |涨跌%|,≥3 快呼吸 / ≥1.2 慢呼吸 / 否则静止(90%静止原则)
function volClass(vals) {
  const a = (vals || []).filter(v => v != null && Number.isFinite(v)).map(Math.abs);
  if (!a.length) return '';
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return m >= 3 ? 'vol-h' : m >= 1.2 ? 'vol-m' : '';
}

// GLOBAL EVENTS 纯函数(启发式,非建议):evAssets 按币种/关键词判事件波及资产与强度(≤4条);
// groupEvents 同币种同时段合并(CPI/FOMC 这类一次发布多条,时间轴不再刷屏);
// nextBig 最近一个 High;weekRisk 未来7日高/中计数判级;fmtLeft 倒计时文本。
const EV_ORD = ['BTC', 'NASDAQ', 'US10Y', 'GOLD', 'CRUDE', 'A股', 'EURUSD', 'USDJPY', 'GBPUSD'];
function evAssets(e) {
  const c = String(e.country || '').toUpperCase(), t = (e.en || '') + ' ' + (e.title || '');
  const lv = e.impact === 'H' ? 3 : 2, a = {};
  const add = (k, v) => (a[k] = Math.min(3, (a[k] || 0) + v));
  const cr = /BTC|ETH|CRYPTO|SEC\b|ETF|STABLECOIN|TOKEN|BLOCKCHAIN/.test(c + ' ' + t);
  if (cr) { add('BTC', 3); add('NASDAQ', 1); }
  if (c === 'USD' || c === 'ALL' || /FOMC|CPI|PCE|PPI|NFP|PAYROLL|GDP|ISM|JOBLESS|CLAIMS|RETAIL|POWELL|TREASURY/.test(t)) {
    add('NASDAQ', lv); add('US10Y', lv); add('GOLD', e.impact === 'H' ? 2 : 1);
    if (!cr) add('BTC', lv);
  }
  if (/CN|CNY|CHINA|LPR|PMI/.test(c + ' ' + t)) add('A股', lv);
  if (/OIL|CAD|WTI|OPEC|SAUDI/.test(c + ' ' + t)) add('CRUDE', lv);
  if (/JPY|BOJ|JAPAN/.test(c + ' ' + t)) { add('USDJPY', lv); add('NASDAQ', 1); }
  if (/EUR|ECB/.test(c + ' ' + t)) { add('EURUSD', lv); add('GOLD', 1); }
  if (/GBP|BOE/.test(c + ' ' + t)) add('GBPUSD', lv);
  return EV_ORD.filter(k => a[k]).slice(0, 4).map(k => ({ n: k, lv: a[k] }));
}
// 同币种、与组内最后一条相差 ≤40min 的事件并为一组(数据升序传入):主条=高危+关键指标词优先,资产取组内各条最大强度
function groupEvents(evts) {
  const gs = [];
  (evts || []).forEach(e => {
    const g = gs[gs.length - 1];
    if (g && g.country === e.country && e.ts - g.end <= 40 * 6e4) { g.items.push(e); g.end = e.ts; if (e.impact === 'H') g.impact = 'H'; }
    else gs.push({ ts: e.ts, end: e.ts, day: e.day, hh: e.hh, country: e.country, impact: e.impact, items: [e] });
  });
  const RE_KEY = /rate|decision|statement|cpi|ppi|gdp|claims|sales|employment/i;
  gs.forEach(g => {
    g.main = g.items.slice().sort((a, b) => ((b.impact === 'H') - (a.impact === 'H')) || ((RE_KEY.test(b.en || '') - RE_KEY.test(a.en || '')) || (a.title || '').length - (b.title || '').length))[0];
    g.title = g.main.title;
    const am = {};
    g.items.forEach(e => evAssets(e).forEach(x => { am[x.n] = Math.max(am[x.n] || 0, x.lv); }));
    g.assets = EV_ORD.filter(k => am[k]).slice(0, 4).map(k => ({ n: k, lv: am[k] }));
  });
  return gs;
}
function nextBig(evts, now) { return (evts || []).find(e => e.impact === 'H' && e.ts > now) || null; }
function weekRisk(evts, now) {
  const w = (evts || []).filter(e => e.ts > now && e.ts <= now + 7 * 864e5);
  const h = w.filter(e => e.impact === 'H').length, m = w.length - h;
  const dot = h >= 3 || (h >= 2 && m >= 3) ? '🔴' : h >= 1 ? '🟡' : '🟢';
  return { dot, txt: dot === '🔴' ? 'HIGH RISK' : dot === '🟡' ? 'ELEVATED' : 'LOW', h, m };
}
function fmtLeft(ms) {
  if (!(ms > 0)) return '正在发生';
  const p = n => String(n).padStart(2, '0');
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60);
  return d ? `${p(d)}天 ${p(hh)}时 ${p(mm)}分` : `${p(hh)}:${p(mm)}:${p(s % 60)}`;
}

// 元/美元 → 大字价格:BTC 用千分位整,BTC以下两位
function fmtPrice(x) {
  const n = pN(x);
  if (n == null) return '—';
  return n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n >= 10 ? n.toFixed(2) : n.toFixed(4);
}
// 两市成交额:qt 的 f37 单位=万元;沪+深 → 亿/万亿文本
function turnoverTxt(shWan, szWan) {
  if (pN(shWan) == null || pN(szWan) == null) return '—';
  const yi = (pN(shWan) + pN(szWan)) / 10000;
  return yi >= 10000 ? (yi / 10000).toFixed(2) + '万亿' : Math.round(yi) + '亿';
}
function fmtUsdShort(x) { // 1.23T/456B/… (抄 crypto.js)
  const n = Number(x);
  if (!isFinite(n)) return '—';
  const u = [['T', 1e12], ['B', 1e9], ['M', 1e6]];
  for (const [s, m] of u) if (n >= m) return '$' + (n / m).toFixed(2) + s;
  return '$' + Math.round(n);
}
function fmtQuoteTime(t) {
  const s = String(t || '');
  const d = s.replace(/\D/g, '');
  if (d.length >= 12) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)} ${d.slice(8, 10)}:${d.slice(10, 12)}`;
  return s || '—';
}
function fmtClock(d) { // 'YYYY-MM-DD HH:MM:SS 星期X'(hero「时间」meta)
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} 星期${'日一二三四五六'[d.getDay()]}`;
}
// A股机会启发式评分(完整抄 stock.js oppScore:流入30+走势25+健康20+估值15;涨停剔除,过热封顶55带标)
function oppScore(r, indPct) {
  const p = pN(r.pct);
  if (p == null || p >= 9.8) return null;
  const mn = pN(r.mainNet);
  const g = mn == null ? null : mn / 1e8;
  const vr = pN(r.volRatio);
  const turn = pN(r.turn);
  let flow = 0;
  if (g != null) flow = g >= 3 ? 30 : g >= 1.5 ? 24 : g >= 0.8 ? 18 : g > 0 ? 6 : 0;
  let trend = 5;
  if (p >= 0 && p < 4) trend = 25 * p / 4;
  else if (p >= 4 && p < 7) trend = 18;
  else if (p >= 7 && p < 9.8) trend = 10;
  let health = 10, hot = p >= 8;
  if (vr != null) {
    if (vr <= 1) health = 6;
    else if (vr <= 3) health = 20;
    else if (vr <= 5) health = 12;
    else { health = 6; hot = true; }
  } else if (turn != null && turn <= 20) health = 12;
  if (turn != null && turn > 15) health = Math.min(health, 4);
  if (turn != null && turn >= 25) hot = true;
  const pe = pN(r.pe), pb = pN(r.pb);
  const low = (pe != null && pe > 0 && pe <= 20) || (pb != null && pb > 0 && pb <= 1.5);
  let score = flow + trend + health + (low ? 15 : 0);
  if (hot) score = Math.min(score, 55);
  const tags = [];
  if (hot) tags.push('已过热');
  if (low) tags.push('低估值');
  if (g != null && g >= 0.5) tags.push('主力流入');
  if (vr != null && vr > 1 && vr <= 3 && (turn == null || turn <= 12)) tags.push('温和放量');
  for (const drop of ['温和放量', '主力流入', '低估值'])
    while (tags.length > 3 && tags.includes(drop)) tags.splice(tags.indexOf(drop), 1);
  const parts = [];
  if (g != null) parts.push(`主力净流入 ${g >= 0 ? '+' : ''}${g.toFixed(1)}亿`);
  if (vr != null) parts.push(`量比 ${vr.toFixed(1)}`);
  if (low) parts.push(pe != null && pe > 0 ? `PE ${pe.toFixed(0)}` : `PB ${pb.toFixed(1)}`);
  return { score: Math.round(score), tags, reason: parts.join(' · ') || '免费口径暂无资金/量比数据', pct: p, ind: r.ind };
}

// 币圈 24h 动量:现货(币安+OKB)+市值兜底(chgPct 缺失的用 CoinGecko),按 24h 涨幅降序
function movers(spot, okx, dom) {
  const list = [];
  const push = r => { if (r && r.sym && pN(r.chgPct) != null) list.push({ sym: r.sym, chg: pN(r.chgPct), price: pN(r.price), cap: pN(r.cap) }); };
  if (spot && spot.ok) for (const r of spot.data || []) push(r);
  if (okx && okx.ok) for (const r of okx.data || []) push(r);
  if (dom && dom.ok) for (const r of dom.data || []) if (r && r.sym && !list.some(x => x.sym === r.sym) && pN(r.chgPct) != null)
    list.push({ sym: r.sym, chg: pN(r.chgPct), price: null, cap: pN(r.cap) });
  return list.sort((a, b) => b.chg - a.chg);
}

// 今日信号(全部是上面接口的派生事实;某输入缺则该信号不出现)
function buildSignals(o) {
  const { qmap, temp, limit, breadth, ov, moversTop } = o;
  const out = [];
  const lim = limit && limit.ok && limit.data;
  if (lim && pN(lim.zt) != null && pN(lim.dt) != null) {
    const d = pN(lim.zt) - pN(lim.dt);
    out.push({
      dot: d >= 30 ? '🟢' : d > 0 ? '🟡' : '🔴',
      lead: `A股 涨停 ${lim.zt} 家 · 跌停 ${lim.dt} 家`,
      sub: d > 0 ? '涨停领先,做多情绪偏暖' : '跌停占优,情绪偏冷',
      val: '', vcls: '', big: false,
    });
  }
  if (temp) out.push({
    dot: temp.score >= 58 ? '🟢' : temp.score >= 42 ? '🟡' : '🔴',
    lead: `A股市场温度 ${temp.label}`,
    sub: '指数 × 涨跌家数 × 涨跌停 的启发式合成(仅氛围读数)',
    val: String(temp.score), vcls: '', big: true,
  });
  const sh = qmap['sh000001'], szi = qmap['sz399106'];
  const tv = (sh && szi) ? turnoverTxt(sh.amountWan, szi.amountWan) : null;
  if (tv && tv !== '—') out.push({ dot: '🟡', lead: 'A股两市成交额', sub: '腾讯 qt 行情口径(f37)', val: tv, vcls: 'dim', big: false });
  if (breadth && breadth.ok && breadth.data && pN(breadth.data.ratio) != null) {
    const r = pN(breadth.data.ratio);
    out.push({ dot: r >= 0.55 ? '🟢' : r >= 0.45 ? '🟡' : '🔴', lead: 'A股 上涨家数占比', sub: '全市场个股 涨/(涨+跌)', val: (r * 100).toFixed(0) + '%', vcls: r >= 0.5 ? 'cup' : 'cdn', big: false });
  }
  const fngArr = ov && ov.fng && ov.fng.ok ? (ov.fng.data || []) : [];
  const fngLast = fngArr.length ? fngArr[fngArr.length - 1] : null;
  const fng = fngLast ? pN(fngLast.value) : null;
  if (fng != null) out.push({
    dot: fng >= 80 ? '🟡' : fng >= 55 ? '🟢' : fng >= 45 ? '🟡' : '🔴',
    lead: `币圈恐慌贪婪 ${fngLabel(fng)}`,
    sub: 'alternative.me 恐惧贪婪指数,情绪读数(过热≥80 反而警惕)',
    val: String(Math.round(fng)), vcls: '', big: true,
  });
  const g = ov && ov.global && ov.global.ok ? ov.global.data : null;
  if (g && pN(g.mcapChgPct) != null) {
    const m = pN(g.mcapChgPct);
    out.push({ dot: m >= 0 ? '🟢' : '🔴', lead: '加密总市值 24h', sub: 'CoinGecko 全市场(风险偏好方向)', val: `${sp(m)}${m.toFixed(2)}%`, vcls: m >= 0 ? 'cup' : 'cdn', big: false });
  }
  const top = moversTop && moversTop.length && moversTop[0];
  if (top && top.chg > 0.2) out.push({ dot: '🟢', lead: `${top.sym} 领涨跟踪池`, sub: 'BTC/ETH/SOL/BNB/OKB 24h 最强(现货行情)', val: `${sp(top.chg)}${top.chg.toFixed(2)}%`, vcls: 'cup', big: false });
  return out.slice(0, 5);
}

// ---------- 浏览器渲染 ----------
if (typeof window !== 'undefined') {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = id => document.getElementById(id);
  function fmtIdxPx(x) { // 指数大数字:2 位小数(≥1000 也要保留小数)
    const n = pN(x); if (n == null) return '—';
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const chgArr = c => (c == null ? '待取' : c >= 0 ? `▲ +${c.toFixed(2)}%` : `▼ ${c.toFixed(2)}%`);
  // ② 通用大卡:名称+大字价+涨跌+面积走势(SVG viewBox 缩放,non-scaling-stroke 保线宽)
  function bigCard(nm, priceTxt, chg, pts, col) {
    const cls = chg == null ? 'dim' : chg >= 0 ? 'rna' : 'gna'; // 全站绿涨红跌,rna/gna 为旧名
    let area = '';
    if (pts && pts.length > 1) {
      const lo = Math.min(...pts), hi = Math.max(...pts), rg = hi - lo || 1;
      const XY = pts.map((c, i) => `${(i / (pts.length - 1) * 100).toFixed(1)},${(36 - (c - lo) / rg * 32).toFixed(1)}`).join(' ');
      area = `<svg viewBox="0 0 100 38" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,38 ${XY} 100,38" fill="${col}" opacity=".14"/><polyline points="${XY}" fill="none" stroke="${col}" stroke-width="1.4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
    }
    return `<div class="bigc"><span class="nm">${nm}</span><div class="pv">${priceTxt}</div>
      <span class="ch ${cls}">${chg == null ? '无行情' : chgArr(chg)}</span>${area}</div>`;
  }

  // ① 全球市场·宏观(2026-09-20 改版照参考图):8 KPI 磁贴 + 统计条 + 右 30 日归一多线走势
  // BTC=现货 24h、上证指数=腾讯 qt(2026-09-20 用户要求换掉原 ETH 格,与板块②同源);纳指/标普/黄金/原油/10Y/DXY/VIX=/api/macro chg24(末两个交易日环比);10Y 涨跌用 bp
  function renderGlobal(ov, m, sh, shK) {
    const spot = (ov.spot && ov.spot.binance && ov.spot.binance.ok && ov.spot.binance.data) || [];
    const by = {}; spot.forEach(r => { if (r && r.sym) by[r.sym] = r; });
    const md = k => (m[k] && m[k].ok && m[k].data) || null;
    const ndx = md('ndx'), spx = md('spx'), gold = md('gold'), oil = md('oil'), y10 = md('y10'), dxy = md('dxy'), vix = md('vix');
    const cls = c => (c == null ? 'dim' : c >= 0 ? 'cup' : 'cdn'); // 全球块:绿涨红跌
    const tile = (nm, v, chg, chTxt) => `<div class="gt"><span class="nm">${nm}</span><b>${v}</b><span class="ch ${cls(chg)}">${chTxt}</span></div>`;
    const mtxt = d => (d ? chgArr(pN(d.chg24.pct)) : '待取');
    const btcC = by.BTC ? pN(by.BTC.chgPct) : null;
    const shC = sh ? pN(sh.chgPct) : null; // 上证指数磁贴(原 ETH 位)
    $('gk-tiles').innerHTML = [
      tile('BTC', by.BTC && pN(by.BTC.price) != null ? '$' + fmtPrice(by.BTC.price) : '—', btcC, chgArr(btcC)),
      tile('上证指数', sh && pN(sh.price) != null ? fmtIdxPx(sh.price) : '—', shC, sh ? chgArr(shC) : '待取'),
      tile('纳指', ndx ? fmtIdxPx(ndx.last) : '—', ndx ? pN(ndx.chg24.pct) : null, mtxt(ndx)),
      tile('标普500', spx ? fmtIdxPx(spx.last) : '—', spx ? pN(spx.chg24.pct) : null, mtxt(spx)),
      tile('黄金', gold ? '$' + fmtIdxPx(gold.last) : '—', gold ? pN(gold.chg24.pct) : null, mtxt(gold)),
      tile('原油WTI', oil ? '$' + fmtIdxPx(oil.last) : '—', oil ? pN(oil.chg24.pct) : null, mtxt(oil)),
      tile('10Y美债', y10 ? y10.last.toFixed(2) + '%' : '—', y10 ? pN(y10.chg24.bp) : null,
        y10 ? (y10.chg24.bp >= 0 ? `▲ +${y10.chg24.bp}bp` : `▼ ${y10.chg24.bp}bp`) : '待取'),
      tile('美元指数', dxy ? fmtIdxPx(dxy.last) : '—', dxy ? pN(dxy.chg24.pct) : null, mtxt(dxy)),
    ].join('');
    // 统计条:全球总市值 / BTC.D(百分点差) / VIX / 市场情绪(FNG 渐变条+游标);合成温度环由 motionPass 灌
    const g = ov.global && ov.global.ok ? ov.global.data : null;
    const mcapChg = g ? pN(g.mcapChgPct) : null;
    $('gs-mcap').innerHTML = g && g.totalUsd != null
      ? `${fmtUsdShort(g.totalUsd)}<small class="${cls(mcapChg)}">${mcapChg != null ? sp(mcapChg) + mcapChg.toFixed(2) + '%' : ''}</small>` : '—';
    const dx = ov.domx && ov.domx.ok ? ov.domx.data : null;
    $('gs-dom').innerHTML = dx ? `${dx.btcD.toFixed(1)}%<small class="${cls(dx.btcD24)}">${sp(dx.btcD24)}${dx.btcD24.toFixed(2)}pt</small>` : '—';
    const vixC = vix ? pN(vix.chg24.pct) : null;
    $('gs-vix').innerHTML = vix ? `${vix.last.toFixed(2)}<small class="${cls(vixC)}">${vixC != null ? sp(vixC) + vixC.toFixed(2) + '%' : ''}</small>` : '—';
    const fngArr = (ov.fng && ov.fng.ok && ov.fng.data) || [];
    const fng = fngArr.length ? pN(fngArr[fngArr.length - 1].value) : null;
    $('gs-fng').textContent = fng != null ? `${fngLabel(fng)} · ${Math.round(fng)}` : '—';
    $('fng-pin').style.left = (fng != null ? clamp01(fng / 100) * 100 : 50) + '%';
    $('gmk-upd').textContent = `更新于 ${fmtClock(new Date())}`;
    // 30 日归一多线:BTC=币安日K、上证=新浪日K(板块②同源);纳指/金/油/10Y=macro series;同标尺(30日前=100)可横向比
    const spark = ov.spark && ov.spark.ok ? ov.spark.data : null;
    const pctOf = s => (s && s.length > 1 ? (s[s.length - 1].c / s[0].c - 1) * 100 : null);
    const CH = [
      // 2026-09-20 用户反馈旧色互相太近 → 六线拉开色相:橙/紫/蓝/黄/青绿/玫红;ETH 线按用户要求换成上证
      ['BTC', '#f7931a', spark && spark.btc, pctOf(spark && spark.btc)],
      ['上证', '#9d7bff', shK, pctOf(shK)],
      ['纳指', '#4da3ff', ndx && ndx.series, ndx ? pN(ndx.chg30.pct) : null],
      ['黄金', '#ffd24a', gold && gold.series, gold ? pN(gold.chg30.pct) : null],
      ['原油', '#34d8a0', oil && oil.series, oil ? pN(oil.chg30.pct) : null],
      ['10Y美债', '#ff7d94', y10 && y10.series, y10 ? pN(y10.chg30.bp) : null], // 收益率 30 日变化以 bp 计
    ];
    let lo = Infinity, hi = -Infinity;
    const norm = CH.map(([nm, col, s, chg]) => {
      if (!s || s.length < 2) return null;
      const v = s.map(d => d.c / s[0].c * 100);
      v.forEach(x => { if (x < lo) lo = x; if (x > hi) hi = x; });
      return { nm, col, v, chg };
    });
    if (!Number.isFinite(lo)) { lo = 97; hi = 103; }
    if (hi - lo < 2) { const c = (hi + lo) / 2; lo = c - 1; hi = c + 1; } // 全平线也要有呼吸空间
    const Y = y => 37 - (y - lo) / (hi - lo) * 33;
    $('gk-chart').innerHTML = `<line x1="0" y1="${Y(100).toFixed(1)}" x2="100" y2="${Y(100).toFixed(1)}" stroke="#243044" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>` +
      norm.filter(Boolean).map(o => {
        const pts = o.v.map((y, i) => `${(i / (o.v.length - 1) * 100).toFixed(1)},${Y(y).toFixed(1)}`).join(' ');
        // 2026-09-20 用户要求:鼠标悬停识别是哪条线 → 透明宽描边 .hit 当热区,<title> 原生提示 + CSS 高亮本线/压暗其余
        const tip = `${o.nm} · 近30日 ${o.chg == null ? '—' : o.nm === '10Y美债' ? (o.chg > 0 ? '+' : '') + o.chg + 'bp' : sp(o.chg) + o.chg.toFixed(1) + '%'}`;
        return `<g class="lg"><title>${esc(tip)}</title><polyline class="hit" points="${pts}" vector-effect="non-scaling-stroke"/><polyline class="ln" points="${pts}" stroke="${o.col}" vector-effect="non-scaling-stroke"/></g>`;
      }).join('');
    $('gk-legend').innerHTML = CH.map(([nm, col, , chg]) => {
      const txt = chg == null ? '—' : nm === '10Y美债' ? (chg > 0 ? '+' : '') + chg + 'bp' : sp(chg) + chg.toFixed(1) + '%';
      return `<span><i style="background:${col}"></i>${nm}<b>${txt}</b></span>`;
    }).join('');
  }


  // ② A股:上证大卡(新浪日K面积)+ 深成/创业板/恒指/恒生科技次级带 + 成交额/涨跌家数 + 热门板块 chips
  function renderAsh(d, qmap, P) {
    const sh = qmap['sh000001'], szi = qmap['sz399106'];
    const k = (d.shK && d.shK.ok && d.shK.data) || null;
    const pts = k && k.length > 1 ? k.map(x => x.c) : null;
    const shC = sh ? pN(sh.chgPct) : null;
    let html = `<div class="bigrow">${bigCard('上证指数', sh ? fmtIdxPx(sh.price) : '—', shC, pts, shC == null ? '#7fd7ff' : shC >= 0 ? 'var(--up)' : 'var(--down)')}</div>`;
    html += `<div class="minis">` + [['sz399001', '深证成指'], ['sz399006', '创业板指'], ['hkHSI', '恒指'], ['hkHSTECH', '恒生科技']].map(([c, nm]) => {
      const r = qmap[c], u = r ? r.chgPct >= 0 : true;
      return `<div class="mini"><span class="nm">${nm}</span><b>${r ? fmtIdxPx(r.price) : '—'}</b><span class="ch ${r ? (u ? 'rna' : 'gna') : 'dim'}">${r ? chgArr(pN(r.chgPct)) : '无行情'}</span></div>`;
    }).join('') + `</div>`;
    // 成交额:主渲染=腾讯 qt 当日今值;「较昨日」等 moneyflow 二传(东财时通时断,不阻主渲染)
    const A = P && P.amt;
    const aChg = A && A.prev && A.today ? (A.today / A.prev - 1) * 100 : null;
    let kv = `<div class="kv"><span class="k">两市成交额</span><span class="v">${(sh && szi) ? turnoverTxt(sh.amountWan, szi.amountWan) : '—'}${A ? `<small class="${aChg == null ? 'dim' : aChg >= 0 ? 'rna' : 'gna'}">${aChg == null ? '· 较昨日待取' : '· 较昨日 ' + sp(aChg) + aChg.toFixed(1) + '%'}</small>` : ''}</span></div>`;
    const br = (d.breadth && d.breadth.ok && d.breadth.data) || null;
    if (br && pN(br.up) != null && pN(br.down) != null) {
      const upN = pN(br.up), dnN = pN(br.down), tt = upN + dnN;
      kv += `<div class="kv"><span class="k">涨 · 跌家数</span><span class="v"><span class="rna">${upN.toLocaleString('zh-CN')}</span> · <span class="gna">${dnN.toLocaleString('zh-CN')}</span></span><div class="udbar"><s style="width:${tt ? (dnN / tt * 100).toFixed(1) : 50}%"></s></div></div>`;
    }
    html += `<div class="kvs">${kv}</div>`;
    html += `<div><span class="lbl">热门板块(当日涨幅榜)</span><div class="chips">` +
      (P && P.boards && P.boards.length
        ? P.boards.slice(0, 4).map(r0 => { const c = pN(r0.pct); return `<span class="chip"><span class="nm">${esc(r0.name)}</span><span class="v ${c == null ? 'dim' : c >= 0 ? 'rna' : 'gna'}">${c == null ? '—' : sp(c) + c.toFixed(1) + '%'}</span></span>`; }).join('')
        : '<span class="chip"><span class="nm dim">板块数据待取(东财限流自愈)</span></span>') + `</div></div>`;
    $('ash-box').innerHTML = html;
  }


  // ② 币圈:BTC/ETH 大卡(币安日K面积)+ CMC100/CD20 次级带 + 总市值/BTC.D + 热门币种 chips
  function renderCry(ov) {
    const spot = (ov.spot && ov.spot.binance && ov.spot.binance.ok && ov.spot.binance.data) || [];
    const by = {}; spot.forEach(r => { if (r && r.sym) by[r.sym] = r; });
    const spark = ov.spark && ov.spark.ok ? ov.spark.data : null;
    const card = sym => {
      const r = by[sym], c = r ? pN(r.chgPct) : null;
      const s = spark && spark[sym.toLowerCase()];
      return bigCard(sym, r && pN(r.price) != null ? '$' + fmtPrice(r.price) : '—', c,
        s && s.length > 1 ? s.map(x => x.c) : null, c == null ? '#7fd7ff' : c >= 0 ? 'var(--up)' : 'var(--down)');
    };
    let html = `<div class="bigrow">${card('BTC')}${card('ETH')}</div>`;
    html += `<div class="minis">` + [['cmc100', 'CMC100'], ['cd20', 'CD20']].map(([bk, nm]) => {
      const bb = ov.bench && ov.bench[bk], dd = bb && bb.ok ? bb.data : null, c = dd ? pN(dd.chgPct) : null;
      return `<div class="mini"><span class="nm">${nm}</span><b>${dd ? fmtIdxPx(dd.value) : '—'}</b><span class="ch ${c == null ? 'dim' : c >= 0 ? 'cup' : 'cdn'}">${dd ? chgArr(c) : '待取'}</span></div>`;
    }).join('') + `</div>`;
    const g = ov.global && ov.global.ok ? ov.global.data : null;
    const mcapChg = g ? pN(g.mcapChgPct) : null;
    const dx = ov.domx && ov.domx.ok ? ov.domx.data : null;
    html += `<div class="kvs">
      <div class="kv"><span class="k">全球总市值</span><span class="v">${g && g.totalUsd != null ? fmtUsdShort(g.totalUsd) : '—'}${g ? `<small class="${mcapChg == null ? 'dim' : mcapChg >= 0 ? 'cup' : 'cdn'}">${mcapChg == null ? '' : '· 24h ' + sp(mcapChg) + mcapChg.toFixed(1) + '%'}</small>` : ''}</span></div>
      <div class="kv"><span class="k">BTC.D 币市占比</span><span class="v">${dx ? dx.btcD.toFixed(1) + '%' : '—'}${dx ? `<small class="${dx.btcD24 >= 0 ? 'cup' : 'cdn'}">· 24h ${sp(dx.btcD24)}${dx.btcD24.toFixed(2)}pt</small>` : ''}</span></div>
    </div>`;
    const mv = movers(ov.spot && ov.spot.binance, ov.spot && ov.spot.okx, ov.dom).filter(x => x.sym !== 'BTC' && x.sym !== 'ETH').slice(0, 4);
    html += `<div><span class="lbl">热门币种(24h 涨幅榜)</span><div class="chips">` +
      (mv.length ? mv.map(x => `<span class="chip"><span class="nm">${esc(x.sym)}</span><span class="v ${x.chg >= 0 ? 'cup' : 'cdn'}">${sp(x.chg)}${x.chg.toFixed(1)}%</span></span>`).join('')
        : '<span class="chip"><span class="nm dim">行情待取</span></span>') + `</div></div>`;
    $('cry-box').innerHTML = html;
  }


  function renderOppA(jo) {
    const el = $('oppA');
    const em = (jo && jo.data && jo.data.em) || { ok: false, error: '接口不可达' };
    const mx = (jo && jo.data && jo.data.mx) || null;
    const useMx = !(em && em.ok) && mx && mx.ok; // 东财限流 → 妙想 MX 兜底
    const cands = (em && em.ok) ? (em.data.cands || []) : useMx ? (mx.data.cands || []) : null;
    if (cands === null) { el.innerHTML = `<div class="opprow"><span class="nm dim">✗ A股全A行情暂不可用(东财限流,妙想兜底亦未就绪,稍后自动恢复)</span></div>`; return; }
    const ranked = cands.map(r => ({ r, s: oppScore(r, undefined) }))
      .filter(x => x.s).sort((a, b) => b.s.score - a.s.score || (b.s.pct || 0) - (a.s.pct || 0)).slice(0, 3);
    const hint = useMx ? `<div class="opprow"><span class="nm dim">东财不可用,当前为妙想 MX 兜底(字段可能不全)。</span></div>` : '';
    if (!ranked.length) {
      const n = cands.length;
      el.innerHTML = hint + `<div class="opprow"><span class="nm dim">${n ? '候选均属涨停/过热或无资金,启发式无可用(涨停已剔除,避免追高)' : useMx ? '妙想兜底未返回可用候选' : '暂无符合启发式的标的(可能非交易时段)'}</span></div>`;
      return;
    }
    el.innerHTML = hint + ranked.map(({ r, s }, i) => {
      const p = s.pct, up = p >= 0, cls = up ? 'rna' : 'gna';
      return `<div class="opprow"><span class="rk">${String(i + 1).padStart(2, '0')}</span>
        <div><span class="nm">${esc(r.name)}<span class="sc ${s.score >= 65 ? 'hi' : ''}">${s.score}</span></span>
          <span class="why">${esc(s.reason)}${r.ind ? ` · ${esc(r.ind)}` : ''}</span></div>
        <span class="v ${cls}">${p != null ? `${sp(p)}${p.toFixed(1)}%` : '—'}</span></div>`;
    }).join('');
  }

  function renderOppC(ov) {
    const el = $('oppC');
    const spot = ov.spot && ov.spot.binance, okx = ov.spot && ov.spot.okx, dom = ov.dom;
    const top = movers(spot, okx, dom).slice(0, 3);
    if (!top.length) { el.innerHTML = `<div class="opprow"><span class="nm dim">✗ 币圈行情暂不可用</span></div>`; return; }
    el.innerHTML = top.map((m, i) => {
      const up = m.chg >= 0, cls = up ? 'cup' : 'cdn';
      const extra = m.price != null ? '$' + fmtPrice(m.price) : (m.cap != null ? fmtUsdShort(m.cap) + ' 市值' : '');
      return `<div class="opprow"><span class="rk">${String(i + 1).padStart(2, '0')}</span>
        <div><span class="nm">${esc(m.sym)}${m.sym === top[0].sym ? '<span class="sc">领涨</span>' : ''}</span>
          <span class="why">${extra ? '24h · 现价 ' + esc(extra) : 'CoinGecko 市值口径 24h'}</span></div>
        <span class="v ${cls}">${sp(m.chg)}${m.chg.toFixed(2)}%</span></div>`;
    }).join('');
  }

  // GLOBAL EVENTS:竖轴时间轴(日期分组头 + 影响色节点,LOW 后端已滤)+ NEXT 倒计时进度条 + 本周风险堆叠条
  let evTimer = 0;
  let evAnchored = false; // 首帧定位锚点只滚一次
  function renderEvents(env) {
    const list = $('ev-list'), cov = $('ev-cov');
    if (!list) return;
    const bars = xs => xs.map(x => `<span class="ab${x.lv === 3 ? ' l3' : ''}">${esc(x.n)}<u><s style="width:${Math.round(x.lv / 3 * 100)}%"></s></u></span>`).join('');
    if (!env || env.ok !== true) {
      const er = env && env.error;
      list.innerHTML = `<div class="note"${er ? ` title="${esc(String(er).slice(0, 120))}"` : ''}>事件源暂不可用,稍后自动重试</div>`;
      cov.textContent = '—';
      return;
    }
    const d = env.data || {}, evts = d.events || [], now = Date.now();
    cov.textContent = d.coveredDays || '—';
    const cn = new Date(now + 8 * 36e5); // 北京「今天/明天」用 UTC 方法读偏移后的值,无 DST 坑
    const pad = n => String(n).padStart(2, '0');
    const today = pad(cn.getUTCMonth() + 1) + '-' + pad(cn.getUTCDate());
    const tm = new Date(now + 8 * 36e5 + 864e5);
    const tmr = pad(tm.getUTCMonth() + 1) + '-' + pad(tm.getUTCDate());
    const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const wdOf = day => WD[new Date(Date.UTC(cn.getUTCFullYear(), +day.slice(0, 2) - 1, +day.slice(3, 5))).getUTCDay()]; // 跨年30天窗口内周几误差1天,可接受
    let lastDay = '', lastSec = ''; // 分区(已发生/今天/未来两周)×日期头两级层次,以时间为单位
    
    const groups = groupEvents(evts); // 一次发布多条(CPI 五项、FOMC 四连)并成一行,副行列出其余
    list.innerHTML = groups.length ? groups.map(g => {
      const e = g.main, en = e.title === e.en ? '' : e.en; // 手动行(中文原题)不重复
      const oth = g.items.filter(x => x !== e);
      const past = (g.end || g.ts) < now; // 已过去(近一周回看用,置灰)
      let hd = '';
      const sec = past ? 'p' : g.day === today ? 't' : 'f';
      if (sec !== lastSec) {
        lastSec = sec;
        hd += `<div class="evsec ${sec}">${sec === 'p' ? '● 已发生 · 近 7 天' : sec === 't' ? '● 今天 · 待发生' : '● 未来两周'}</div>`;
      }
      if (g.day !== lastDay) {
        lastDay = g.day;
        const tag = g.day === today ? ' · 今天' : g.day === tmr ? ' · 明天' : past ? ' · 已过去' : '';
        hd += `<div class="evday${past ? ' past' : ''}"><b>${esc(g.day)}</b>${tag}<i>${wdOf(g.day)}</i></div>`;
      }
      return `${hd}<div class="evt${past ? ' past' : ''} ${g.impact === 'H' ? 'h' : 'm'}"><span class="dot"></span><div class="dt">${esc(g.hh)}<i>${esc(g.country || '')}</i></div><div class="bd">
        <div class="ti">${esc(e.title)}${g.items.some(x => x.kind === 'crypto') ? '<span class="cb">CRYPTO</span>' : ''}</div>
        ${en ? `<div class="en">${esc(en)}</div>` : ''}
        ${oth.length ? `<div class="gg">同场 ${oth.length} 项:${oth.map(x => `${esc(x.hh)} ${esc(x.title)}`).join(' · ')}</div>` : ''}
        ${e.forecast || e.previous ? `<div class="fp">预期 <b>${esc(e.forecast || '—')}</b> · 前值 <b>${esc(e.previous || '—')}</b></div>` : ''}
        ${g.assets.length ? `<div class="aas">${bars(g.assets)}</div>` : ''}</div></div>`;
    }).join('') : '<div class="note">近三周无高/中级事件(台账逐周自动补充)</div>';
    if (!evAnchored) { // 首帧滚到最近一条未来事件(过去的在上滑区);仅一次,不打扰用户手滑
      evAnchored = true;
      const a0 = list.querySelector('.evt:not(.past)');
      if (a0) list.scrollTop += a0.getBoundingClientRect().top - list.getBoundingClientRect().top - 4;
    }
    const nb = nextBig(groups, now);
    const pw = nb ? Math.max(4, Math.min(100, Math.round(100 - (nb.ts - now) / (7 * 864e5) * 100))) : 0; // 进度=越近越满,窗7天
    $('ev-next').innerHTML = '<div class="ct">NEXT BIG EVENT</div>' + (nb
      ? `<div class="nt">${esc(nb.title)}</div><div class="ne">${esc(nb.day)} ${esc(nb.hh)} 北京 · ${esc(nb.country || '')}</div>
         <div class="cd" id="ev-cd">${fmtLeft(nb.ts - now)}</div><div class="np"><s style="width:${pw}%"></s></div><div class="im">🔴 HIGH IMPACT</div>
         ${nb.assets.length ? `<div class="aas">${bars(nb.assets)}</div>` : ''}`
      : '<div class="note">近期无高危事件</div>');
    const r = weekRisk(groups, now), t = r.h + r.m;
    $('ev-risk').innerHTML = `<div class="ct">THIS WEEK · MARKET RISK</div><div class="wk">${r.dot} ${r.txt}</div>
      <div class="rnums"><span class="rh"><b>${r.h}</b> 高影响</span><span class="rm"><b>${r.m}</b> 中型</span></div>
      <div class="rbar">${t ? `<i style="width:${r.h / t * 100}%;background:#b5484d"></i><i style="width:${r.m / t * 100}%;background:#a37a3b"></i>` : '<i style="width:100%"></i>'}</div>
      <div class="wl">${d.degraded ? '<span style="color:#ffd25e">⚠ 上游不可用,当前为本地台账</span>' : '未来 7 天窗口内高/中级占比'}</div>`;
    clearInterval(evTimer);
    if (nb) evTimer = setInterval(() => { // 只刷倒计时一行
      const el = $('ev-cd');
      if (!el) clearInterval(evTimer);
      else el.textContent = fmtLeft(nb.ts - Date.now());
    }, 1000);
  }

  function renderSignals(sigs) {
    const el = $('signals');
    if (!sigs.length) { el.innerHTML = '<div class="note">信号不足(多个数据源暂不可用,稍后自动刷新)</div>'; return; }
    el.innerHTML = sigs.map(s => `<div class="sig"><span class="dot">${s.dot}</span>
      <div class="lead">${esc(s.lead)}</div>
      <div class="sub">${esc(s.sub)}</div>
      ${s.val ? `<div class="val ${s.vcls || ''}">${esc(s.val)}</div>` : ''}</div>`).join('');
  }

  function loadAndRender() {
    const get = u => fetch(u).then(r => r.json()).catch(() => null);
    // #who 登录态由公共 nav.js 渲染,这里只拉行情
    Promise.all([
      get('/api/stock/market'), get('/api/stock/opportunity'), get('/api/crypto/overview'), get('/api/macro'), get('/api/events'),
    ]).then(([jm, jo, jc, jmr, jev]) => {
      const d = (jm && jm.data) || {};
      d.crypto = (jc && jc.data) || {};
      const m = (jmr && jmr.data) || {};
      const qmap = {}; const qs = (d.qt && d.qt.ok && d.qt.data) || [];
      qs.forEach(r => { if (r && r.ok) qmap[r.code] = r; });
      ((d.hk && d.hk.ok && d.hk.data) || []).forEach(r => { if (r && r.ok) qmap[r.code] = r; }); // 港股指数并入 A股面板次级带
      const sh = qmap['sh000001'];
      const br = (d.breadth && d.breadth.ok && d.breadth.data) || null;
      const temp = aTemp(sh ? sh.chgPct : null,
        (br && pN(br.ratio)) != null ? pN(br.ratio) : null,
        d.limit && d.limit.ok && d.limit.data ? d.limit.data.zt : null,
        d.limit && d.limit.ok && d.limit.data ? d.limit.data.dt : null);
      const ov = d.crypto;
      renderGlobal(ov, m, sh, (d.shK && d.shK.ok && d.shK.data) || null); // 上证磁贴/走势线(换掉原 ETH)
      const P = {}; // 二传补丁:两市成交额「较昨日」/ 热门板块(东财时通时断,主渲染完成后异步补,勿并进主链)
      const renderAshP = () => renderAsh(d, qmap, P);
      renderAshP();
      renderCry(ov);
      renderEvents(jev && jev.data);
      const spot = ov.spot && ov.spot.binance, okx = ov.spot && ov.spot.okx, dom = ov.dom;
      renderSignals(buildSignals({ qmap, temp, limit: d.limit, breadth: d.breadth, ov, moversTop: movers(spot, okx, dom) }));
      renderOppA(jo);
      renderOppC(ov);
      d.__temp = temp ? temp.score : null;
      try { motionPass(d, m); } catch (e) { /* 动效异常永不拖累数据渲染 */ }
      get('/api/stock/moneyflow').then(j => { const a = j && j.data && j.data.em && j.data.em.ok ? j.data.em.data.amt : null; if (a) { P.amt = a; renderAshP(); } });
      get('/api/stock/boards').then(j => { const rows = j && j.data && j.data.em && j.data.em.ok ? j.data.em.data : null; if (rows && rows.length) { P.boards = rows; renderAshP(); } });
      const asOf = qs.map(r => r.time).find(t => t);
      $('status').textContent = `免费源 · A股缓存60s / 币圈30s / 宏观15min / 事件1h · 行情时间 ${fmtQuoteTime(asOf) || '—'} · 刷新于 ${new Date().toLocaleTimeString('zh-CN')} · 绿涨红跌`;
    }).catch(() => { $('status').textContent = '部分数据源暂不可用,点击页内刷新可重试'; });
    $('footnote').textContent = '口径说明:首页只消费各雷达页同一批免费接口。「市场温度」「恐慌贪婪」与「今日信号/机会评分」均为启发式读数,不含基本面与逐笔数据,非投资建议;进入 A股/币圈 雷达可见完整分项与数据边界。板块①八项行情:BTC=币安现货 24h;上证指数=腾讯行情/新浪日K(与板块②同源,A股时段口径);纳指/标普500=新浪美股指数(.NDX/.INX)、黄金/原油=新浪期货(XAU/CL)、10Y=美国财政部官方日线、美元指数/VIX=雅虎指数日线(均为最近已发布交易日,24h涨跌=末两个交易日环比);30日走势归一「30日前=100」仅供横向比较,BTC 日线取币安 vision、上证取新浪日K。板块②:A股指数行情=腾讯 qt(恒指/恒生科技为腾讯恒生系列,港股时段更新),上证走势=新浪日K;成交额「较昨日」与热门板块来自东财,限流冷却时稍后二传补齐(属自愈非 bug)。BTC.D=CMC 全球指标(24h 变化为百分点差,标 pt);CMC100 取 CoinMarketCap 官方免key指数端点、CD20 为 CoinDesk 20(CNBC 行情,雅虎 ^CDI20 兜底),两者是指数点位、非币种报价。事件雷达:源为 ForexFactory 当周公开 feed + 本地台账逐周攒(冷启动只显本周属预期),标题机翻,「影响资产/本周风险」为关键词启发式,均为娱乐参考、不构成任何操作依据。';
  }


  // SWR(nav.js v2):后台重取成功 → apifresh → 自动重渲替换;手动刷新置 __apibust 无视本地缓存直连
  document.getElementById('refresh') && (document.getElementById('refresh').onclick = () => { window.__apibust = Date.now(); loadAndRender(); });
  window.addEventListener('apifresh', loadAndRender);

  // ===== THRR Motion System:渲染完成后唯一接触点(motionPass),异常由调用方吞掉不影响数据渲染 =====
  const LAST = {}; // key=「行名|节点class」→ 上次文本;diff 才动(90%静止)
  const MMT = { jump: false }; // 本轮是否有涨跌值 ≥2pt 的跳变 → 全页一次性微闪
  const VSEL = '#gk-tiles .gt,.gstats .gs,#ash-box .bigc,#ash-box .mini,#ash-box .kv,#ash-box .chip,#cry-box .bigc,#cry-box .mini,#cry-box .kv,#cry-box .chip,#oppA .opprow,#oppC .opprow,#signals .sig'; // 行名取 .nm/.k,数值取 b/.v/.pv/.ch(类名沿用,自检逻辑不改)
  const FLOW = '#oppA,#oppC'; // 能量流只走机会/动量行(万亿/点位等文本会误判方向)
  function parseP(s) { const n = parseFloat(String(s).replace(/[^\d.+-]/g, '')); return Number.isFinite(n) ? n : null; }
  function tickScan() {
    document.querySelectorAll(VSEL).forEach(row => {
      const nm = ((row.querySelector('.nm,.k,.lead') || {}).textContent || '').trim();
      row.querySelectorAll('b,.v,.pv,.ch,.c30,.val,em').forEach(el => {
        const k = nm + '|' + el.className, v = (el.textContent || '').trim(), old = LAST[k];
        if (old !== undefined && old !== v) {
          el.classList.add('tk'); setTimeout(() => el.classList.remove('tk'), 700); // ① data-tick
          if (row.matches(FLOW)) flowFire(row, v); // ⑤ energy-flow
          if (el.classList.contains('ch') || el.classList.contains('c30')) {
            const a = parseP(old), b = parseP(v);
            if (a != null && b != null && Math.abs(b - a) >= 2) MMT.jump = true;
            if (row.matches('.opprow,.bigc') && b != null && Math.abs(b) >= 5) anomFire(row); // ⑥ signal-pulse
          } else if (row.matches('.opprow') && el.classList.contains('v')) {
            const b = parseP(v);
            if (b != null && Math.abs(b) >= 5) anomFire(row);
          }
        }
        LAST[k] = v;
      });
    });
  }
  function flowFire(row, v) { // 方向=变化值符号,速度=幅度;3 个来回后自清
    const n = parseP(v); if (n == null) return;
    row.classList.remove('f-up', 'f-dn'); void row.offsetWidth;
    row.classList.add(n > 0 ? 'f-up' : 'f-dn');
    row.style.animationDuration = (Math.abs(n) >= 5 ? 1.6 : Math.abs(n) >= 2 ? 2 : 2.8) + 's';
    setTimeout(() => { row.classList.remove('f-up', 'f-dn'); row.style.animationDuration = ''; }, 9000);
  }
  function anomFire(row) { // |涨跌|≥5% 的新数据 → 双脉冲 + 一次性徽标
    row.classList.remove('anom'); void row.offsetWidth; row.classList.add('anom');
    setTimeout(() => row.classList.remove('anom'), 2600);
    if (row.querySelector('.mm')) return;
    const b = document.createElement('span'); b.className = 'mm'; b.textContent = 'MOMENTUM DETECTED';
    (row.querySelector('.nm') || row).appendChild(b);
    setTimeout(() => b.remove(), 6000);
  }
  function restart(id, cls, ms) { // innerHTML 重建后重放一次性 CSS 动画(② radar / ③ glow)
    const el = $(id); if (!el) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }
  function motionPass(d, jmr) {
    MMT.jump = false;
    tickScan();
    restart('signals', 'scan', 1900);
    restart('ev-list', 'glow', 2100);
    // ④ 市场温度环:A股温度40 + 宏观票数30 + 恐慌贪婪30(mktTemp 纯函数,自检覆盖)
    const ov = d.crypto || {};
    const g = (ov.global && ov.global.ok && ov.global.data) || null;
    const fngArr = (ov.fng && ov.fng.ok && ov.fng.data) || [];
    const fng = fngArr.length ? pN(fngArr[fngArr.length - 1].value) : null;
    const gg = k => (jmr[k] && jmr[k].ok && jmr[k].data.chg30) || {};
    const reg = macroRegime(gg('ndx').pct, gg('y10').bp, gg('gold').pct, gg('oil').pct);
    const mt = mktTemp(d.__temp, reg.sum == null ? null : reg.sum, fng);
    const ring = $('mkt-temp');
    if (ring) ring.innerHTML = mt
      // 标签用短写 市场温度 —— 长词 TEMPERATURE 在 stats 行窄格里撑爆盒子(2026-09-20 用户抓包)
      ? `<span class="tring" style="--p:${mt.score};--c:${mt.color}"></span>市场温度 · ${mt.label}<b>${mt.score}</b>`
      : '<span class="tring"></span>市场温度 · 等数据<b>—</b>';
    // ⑧ 背景呼吸档位 + ≥2pt 跳变的一次性微闪
    const qs = (d.qt && d.qt.ok && d.qt.data) || [];
    const sh = qs.find(r => r && r.code === 'sh000001');
    const spot = (ov.spot && ov.spot.binance && ov.spot.binance.ok && ov.spot.binance.data) || [];
    const btcR = spot.find(r => r && r.sym === 'BTC');
    document.body.classList.remove('vol-h', 'vol-m', 'flash');
    const vc = volClass([sh ? pN(sh.chgPct) : null, btcR ? pN(btcR.chgPct) : null, g ? pN(g.mcapChgPct) : null]);
    if (vc) document.body.classList.add(vc);
    if (MMT.jump) { void document.body.offsetWidth; document.body.classList.add('flash'); setTimeout(() => document.body.classList.remove('flash'), 1700); }
  }
  // ⑦ 鼠标光斑:hover 设备才绑;main 上一个委托 pointermove + rAF 节流,只写 --mx/--my
  if (window.matchMedia && matchMedia('(hover:hover)').matches) {
    const mmain = document.querySelector('main');
    if (mmain) {
      let mraf = 0, mlast = null;
      mmain.addEventListener('pointermove', e => {
        const p = e.target.closest('.panel'); if (!p) return;
        mlast = [p, e.clientX, e.clientY];
        if (!mraf) mraf = requestAnimationFrame(() => {
          mraf = 0;
          const r = mlast[0].getBoundingClientRect();
          mlast[0].style.setProperty('--mx', (mlast[1] - r.left) + 'px');
          mlast[0].style.setProperty('--my', (mlast[2] - r.top) + 'px');
        });
      }, { passive: true });
    }
  }

  // 今日财运:点顶栏按钮弹层 → GET /api/fortune(后端随机 50~100)→ 环形灌分 + 档位文案(娱乐)
  (function fortuneWidget() {
    const btn = $('fortune-btn'), mask = $('fort');
    if (!btn || !mask) return;
    let raf = 0;
    const roll = () => {
      $('fort-lbl').textContent = '正在读取财运…'; $('fort-line').textContent = '';
      fetch('/api/fortune').then(r => r.json()).then(d => {
        const s = Math.max(50, Math.min(100, Math.round(+d.score) || 50));
        const t = fortuneTier(s), ring = $('fort-ring'), num = $('fort-num');
        ring.style.setProperty('--c', t.color);
        const t0 = performance.now(), D = 900;
        cancelAnimationFrame(raf);
        const step = now => { // easeOutCubic 计数,50 → s
          const k = Math.min(1, (now - t0) / D);
          const v = Math.round(50 + (s - 50) * (1 - Math.pow(1 - k, 3)));
          ring.style.setProperty('--p', v); num.textContent = v;
          if (k < 1) raf = requestAnimationFrame(step);
          else { $('fort-lbl').textContent = `${t.label} · ${s} 分`; $('fort-line').textContent = t.line; }
        };
        raf = requestAnimationFrame(step);
      }).catch(() => { $('fort-lbl').textContent = '财运气读取失败,稍后再试'; });
    };
    btn.onclick = () => { mask.hidden = false; roll(); };
    $('fort-again').onclick = roll;
    $('fort-close').onclick = () => { mask.hidden = true; };
    mask.onclick = e => { if (e.target === mask) mask.hidden = true; };
  })();

  loadAndRender(); // 块内定义并自调用
}

// ---------- 自检(node public/hub.js) ----------
function selftest() {
  const A = (c, m) => console.assert(c, m);
  A(pN('') === null && pN('-') === null && pN(3) === 3, 'pN 占位符');
  A(sp(-3.05) + (-3.05).toFixed(1) === '-3.0' && sp(1.2) + (1.2).toFixed(1) === '+1.2' && sp(0) === '', '负号由 toFixed 自带,不出现 --');
  A(fngLabel(12) === '极度恐惧' && fngLabel(30) === '恐惧' && fngLabel(60) === '贪婪' && fngLabel(88) === '极度贪婪', 'FNG 档位');
  const t = aTemp(0.5, 0.55, 10, 3);
  A(t && t.score > 42 && t.score < 78, '正常日应中性偏强');
  A(aTemp(-2, 0.3, 2, 60) && aTemp(-2, 0.3, 2, 60).score < 42, '普跌应偏弱');
  A(aTemp(null, null, null, null) === null, '全缺 → null');
  const idxOnly = aTemp(0.5, null, null, null);
  A(idxOnly != null, '只给指数也能出温度');
  A(aTemp(2, 0.7, 60, 5).score >= 58, '普涨大涨应偏强+');
  A(aTemp(1, 0.6, 20, 5).label === '偏强', '强日 label');
  A(turnoverTxt(88852161, 103665671) === '1.93万亿', '两市成交额万亿');
  A(turnoverTxt(null, 1) === '—', '缺一市场 → —');
  A(fmtPrice(63452.3) === '63,452' && fmtPrice(143.45) === '143.45' && fmtPrice(0.01234) === '0.0123', '大字价格');
  const pulse = pulseTone(aTemp(1, 0.6, 40, 5), 66, 1.5);
  A(pulse.dot === '🟢' && pulse.txt === '市场风险偏好回升', '双强 → 回升');
  A(pulseTone(aTemp(-2, 0.3, 2, 60), 22, -3).dot === '🔴', '双冷 → 收缩');
  A(pulseTone(null, null, null).txt === '数据暂不可用', '全缺兜底');
  A(pulseTone(aTemp(0, 0.5, 5, 5), 48, 0.2).dot === '🟡', '中性');
  A(fortuneTier(50).label === '细水长流' && fortuneTier(65).label === '小有进项' && fortuneTier(80).label === '财运旺旺' && fortuneTier(100).label === '财运爆棚', '财运档位边界');
  const rg1 = macroRegime(1.8, -12, 3.7, -4.3);
  A(rg1.dot === '🟢' && rg1.hd.includes('纳指走强'), '宏观典型 Risk-On 3票');
  A(macroRegime(-2, 15, 4, 5).dot === '🔴', '股债金油全不利 → Risk-Off');
  A(macroRegime(1.8, null, null, null).dot === '🟡', '单项不足 → NEUTRAL');
  A(macroRegime(null, null, null, null).dot === '⚪', '全缺');
  const T0 = Date.parse('2030-01-01T00:00:00Z');
  const fev = [
    { ts: Date.parse('2030-01-05T00:00:00Z'), impact: 'H', country: 'USD', en: 'FOMC Rate Decision', title: 'FOMC利率决议' },
    { ts: Date.parse('2030-01-06T00:00:00Z'), impact: 'M', country: 'EUR', en: 'ECB Interest Rate', title: '欧央行利率' },
  ];
  const fa = evAssets(fev[0]);
  A(fa.some(x => x.n === 'US10Y' && x.lv === 3) && fa.some(x => x.n === 'BTC') && fa.length <= 4, '美High事件 → 利率/币3格');
  A(evAssets(fev[1]).some(x => x.n === 'EURUSD' && x.lv === 2), 'EUR中级 → 直盘2格');
  A(nextBig(fev, T0) === fev[0], 'nextBig 取最近 High');
  A(weekRisk(fev, T0).dot === '🟡' && weekRisk(fev, T0).h === 1, '1高危 → ELEVATED');
  A(weekRisk([], Date.now()).dot === '🟢', '无事件 → LOW');
  const cpi5 = ['CPI m/m', 'Core CPI y/y', 'Median CPI y/y', 'Trimmed CPI y/y', 'Common CPI y/y'].map((en, i) => ({ ts: T0 + 1e6 + i * 6e4, impact: i ? 'M' : 'H', country: 'USD', en, title: '物价指数变体' + i }));
  const g3 = groupEvents(cpi5.concat([
    { ts: T0 + 864e5, impact: 'H', country: 'USD', en: 'FOMC Rate Decision', title: '联邦基金利率' },
    { ts: T0 + 864e5 + 18e5, impact: 'H', country: 'USD', en: 'FOMC Press Conference', title: 'FOMC新闻发布会' },
    { ts: T0 + 864e5 + 90 * 6e4, impact: 'H', country: 'USD', en: 'Unemployment Claims', title: '失业金申请人数' },
  ]));
  A(g3.length === 3 && g3[0].items.length === 5 && g3[1].items.length === 2, '同币40分钟窗合并:5条CPI→1、FOMC两条→1、隔60分钟不并');
  A(g3[0].main.en === 'CPI m/m' && g3[1].main.en === 'FOMC Rate Decision', '主条=高危+关键指标词优先(短题兜底)');
  A(g3[1].assets.some(x => x.n === 'NASDAQ' && x.lv === 3), '组内资产取最大强度');
  A(groupEvents([]).length === 0 && groupEvents(null).length === 0, '空输入 → 空组');
  A(fmtLeft(90 * 1000) === '00:01:30', '<1h 走时:分:秒');
  A(fmtLeft((90061) * 1000) === '01天 01时 01分', '≥1d 走天时分');
  A(fmtLeft(-5) === '正在发生', '过期 → 正在发生');

  const indPct = new Map([['半导体', 2.3], ['银行', -0.4]]);
  const s1 = oppScore({ pct: 3.2, mainNet: 2.1e8, turn: 5, volRatio: 1.8, pe: 12, pb: 1.4, ind: '半导体' }, indPct);
  A(s1 && s1.score === 79, '满分标的 79 分');
  A(oppScore({ pct: 10.1, mainNet: 3e8, turn: 3, volRatio: 1.5, pe: 15, pb: 1, ind: 'x' }, indPct) === null, '涨停剔除');
  A(oppScore({ pct: 8.6, mainNet: 5e8, turn: 8, volRatio: 1.6, pe: 10, pb: 1, ind: 'y' }, indPct).score <= 55, '过热封顶');

  const spot = { ok: true, data: [{ sym: 'BTC', chgPct: 0.5, price: 63000 }, { sym: 'SOL', chgPct: 3.2, price: 140 }, { sym: 'ETH', chgPct: -1, price: 2500 }] };
  const dom = { ok: true, data: [{ sym: 'OKB', chgPct: 2.1, cap: 4e9 }] };
  const m = movers(spot, null, dom);
  A(m[0].sym === 'SOL' && m[1].sym === 'OKB' && m[2].sym === 'BTC', '动量排序 + 市值兜底');
  const sigs = buildSignals({
    qmap: { sh000001: { amountWan: 88852161 }, sz399106: { amountWan: 103665671 } },
    temp: aTemp(0.5, 0.55, 10, 3), limit: { ok: true, data: { zt: 40, dt: 3 } },
    breadth: { ok: false }, ov: { fng: { ok: true, data: [{ value: 62 }] }, global: { ok: true, data: { mcapChgPct: 1.2 } } },
    moversTop: m,
  });
  A(sigs.length >= 3 && sigs[0].lead.includes('涨停'), '信号派生');
  A(buildSignals({ qmap: {}, temp: null, limit: null, breadth: null, ov: {}, moversTop: [] }).length === 0, '全缺 → 0 信号');
  // THRR 动效纯函数:合成温度 + 波动档位 + macroRegime 票数暴露
  A(macroRegime(1.8, -12, 3.7, -4.3).sum === 2, 'macroRegime 暴露票数合计');
  A(macroRegime(null, null, null, null).sum === undefined, 'macroRegime 全缺无 sum(消费侧按 null)');
  const mt1 = mktTemp(60, 2, 66);
  A(mt1.score >= 55 && mt1.score <= 70 && !!mt1.color && !!mt1.label, '合成温度典型偏热');
  A(mktTemp(null, null, null) === null, '合成温度全缺 → null');
  A(mktTemp(40, null, null).score === 40, '单项时权重归一');
  A(Math.abs(mktTemp(100, 4, 100).score - 100) <= 1, '全热 ≈100');
  A(Math.abs(mktTemp(0, -4, 0).score) <= 1, '全冷 ≈0');
  A(volClass([4, -3.5, 2]) === 'vol-h' && volClass([1.5, 1]) === 'vol-m' && volClass([0.3, 0.5]) === '' && volClass([]) === '', '波动三档');
  A(volClass([null, undefined, 2]) === 'vol-m', 'volClass 忽略空值');
  console.log('hub.js selftest OK');
}
if (typeof require !== 'undefined' && require.main === module) selftest();
