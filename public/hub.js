/* 首页「投资雷达」:跨市场总览。只消费已有端点(A股 stock/market+opportunity,币圈 crypto/overview,登录 me)。
   四区:① Market Pulse(跨市场氛围)② A股/币圈核心行情 ③ 今日信号(纯派生事实)④ 机会与动量。
   与各雷达页同口径:温度公式抄 stock.js,恐慌贪婪抄 crypto.js。纯函数置顶层,可 node public/hub.js 自检。
   配色:A股列红涨绿跌,币圈列绿涨红跌,各按本市场习惯(总览其余色块:绿=暖/升,红=冷/跌)。 */

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
  return { score, tags, reason: parts.join(' · ') || '免费口径暂无资金/量比数据', pct: p, ind: r.ind };
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
  const PULSE_COL = { A股: '#4f8cff', BTC: '#f7931a', ETH: '#8ea3ff', SOL: '#58d68d' };

  function renderGauge(holder, { name, val, color, note }) {
    const pv = Math.max(0, Math.min(100, val));
    holder.innerHTML = `<div class="gauge"><div class="ring" style="--p:${Math.max(pv, 2)};--c:${color}">
        <b>${Math.round(pv)}</b><i>${esc(name)}</i></div>
      <div class="gl"><span class="t" style="color:${color}">${esc(note)}</span><span class="s">${esc(name)}读数 · 启发式</span></div></div>`;
  }

  function renderPulse(d) {
    const qmap = {}; const qs = (d.qt && d.qt.ok && d.qt.data) || [];
    qs.forEach(r => { if (r && r.ok) qmap[r.code] = r; });
    const sh = qmap['sh000001'];
    const temp = aTemp(sh ? sh.chgPct : null,
      (d.breadth && d.breadth.ok && d.breadth.data && pN(d.breadth.data.ratio)) || null,
      d.limit && d.limit.ok && d.limit.data ? d.limit.data.zt : null,
      d.limit && d.limit.ok && d.limit.data ? d.limit.data.dt : null);
    const ov = d.crypto || {};
    const fngArr = (ov.fng && ov.fng.ok && ov.fng.data) || [];
    const fLast = fngArr.length ? fngArr[fngArr.length - 1] : null;
    const fng = fLast ? pN(fLast.value) : null;
    const g = (ov.global && ov.global.ok && ov.global.data) || null;
    const mcap = g ? pN(g.mcapChgPct) : null;
    const tone = pulseTone(temp, fng, mcap);
    const subA = temp ? `A股 ${temp.label} 温度${temp.score}` : 'A股 数据待取';
    const subC = fng != null
      ? `币圈 ${fngLabel(fng)} ${Math.round(fng)}${mcap != null ? ` · 市值 24h ${sp(mcap)}${mcap.toFixed(1)}%` : ''}`
      : mcap != null ? `币圈 市值 24h ${sp(mcap)}${mcap.toFixed(1)}%` : '币圈 数据待取';
    $('pulse-hl').innerHTML = `<span class="hd">${tone.dot} ${esc(tone.txt)}</span>
      <small>${esc(tone.hd)} · ${esc(subA)} · ${esc(subC)}</small>`;
    const holder = $('pulse-g'); holder.innerHTML = '';
    if (temp) renderGauge(holder, { name: 'A股温度', val: temp.score, color: temp.color, note: `A股 ${temp.label}` });
    if (fng != null) renderGauge(holder, { name: '恐慌贪婪', val: fng, color: fngColor(fng), note: fngLabel(fng) });
    else if (mcap != null) renderGauge(holder, { name: '市值24h', val: 50 + mcap, color: mcap >= 0 ? 'var(--up)' : 'var(--down)', note: mcap >= 0 ? '市值回升' : '市值回落' });
    if (!holder.innerHTML) holder.innerHTML = '<div class="note">等数据…</div>';
    return { qmap, temp };
  }

  function renderAIndex(qmap) {
    const want = [['sh000001', '上证指数'], ['sz399001', '深证成指'], ['sz399006', '创业板指']];
    $('ashare-idx').innerHTML = want.map(([code]) => {
      const r = qmap[code];
      if (!r) return `<div class="qrow"><span class="nm">${esc(code)}</span><span class="dim">无行情</span></div>`;
      const up = r.chgPct >= 0, cls = up ? 'rna' : 'gna'; // A股:红涨绿跌
      return `<div class="qrow"><span class="nm">${esc(r.name)}</span>
        <span class="pv">${fmtPrice(r.price)}</span>
        <span class="ch ${cls}">${up ? '▲' : '▼'} ${sp(r.chgPct)}${pN(r.chgPct).toFixed(2)}%</span></div>`;
    }).join('');
  }
  function renderAStrip(d, qmap) {
    const lim = (d.limit && d.limit.ok && d.limit.data) || null;
    const sh = qmap['sh000001'], szi = qmap['sz399106'];
    const sb = (k, v, cls = '') => `<div class="sb"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
    $('ashare-strip').innerHTML =
      sb('涨停', lim ? pN(lim.zt).toLocaleString('zh-CN') : '—', 'rna') +
      sb('跌停', lim ? pN(lim.dt).toLocaleString('zh-CN') : '—', 'gna') +
      sb('两市成交额', (sh && szi) ? turnoverTxt(sh.amountWan, szi.amountWan) : '—');
  }

  function renderCIdx(ov) {
    const want = ['BTC', 'ETH', 'SOL'];
    const spot = (ov.spot && ov.spot.binance && ov.spot.binance.ok && ov.spot.binance.data) || [];
    const by = {}; spot.forEach(r => { if (r && r.sym) by[r.sym] = r; });
    const dom = (ov.dom && ov.dom.ok && ov.dom.data) || [];
    const byCap = {}; dom.forEach(r => { if (r && r.sym) byCap[r.sym] = r; });
    $('crypto-idx').innerHTML = want.map(sym => {
      const r = by[sym] || byCap[sym];
      if (!r) return `<div class="qrow"><span class="nm"><span class="sym">●</span>${sym}</span><span class="dim">无行情</span></div>`;
      const chg = pN(r.chgPct), up = chg >= 0, cls = up ? 'cup' : 'cdn'; // 币圈:绿涨红跌
      const price = pN(r.price) != null ? fmtPrice(r.price) : byCap[sym] ? fmtUsdShort(pN(byCap[sym].cap)) + ' 市值' : '—';
      return `<div class="qrow"><span class="nm"><span class="sym" style="color:${PULSE_COL[sym] || 'var(--ink-2)'}">●</span>${sym}</span>
        <span class="pv">${price}</span>
        <span class="ch ${cls}">${chg != null ? (up ? '▲' : '▼') + ' ' + sp(chg) + chg.toFixed(2) + '%' : '—'}</span></div>`;
    }).join('');
    // strip:总市值 / 市值24h / 恐慌贪婪 / 资金费率+多空比(fut 徽标,BTC)
    const g = (ov.global && ov.global.ok && ov.global.data) || null;
    const fngArr = (ov.fng && ov.fng.ok && ov.fng.data) || [];
    const fng = fngArr.length ? pN(fngArr[fngArr.length - 1].value) : null;
    const fut = (ov.fut && ov.fut.binance && ov.fut.binance.ok && ov.fut.binance.data) || [];
    const bt = fut.find(x => x && x.sym === 'BTC') || {};
    const fr = pN(bt.fundingRate), lsr = pN(bt.longShortRatio);
    const frTxt = fr != null ? `${(fr * 100).toFixed(3)}%` : '—';
    const sb = (k, v, cls = '') => `<div class="sb"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
    $('crypto-strip').innerHTML =
      sb('总市值', g && g.totalUsd != null ? fmtUsdShort(g.totalUsd) : '—') +
      sb('市值 24h', g && pN(g.mcapChgPct) != null ? `${sp(pN(g.mcapChgPct))}${pN(g.mcapChgPct).toFixed(1)}%` : '—', (g && pN(g.mcapChgPct) >= 0) ? 'cup' : (g ? 'cdn' : '')) +
      sb('恐慌贪婪', fng != null ? `${Math.round(fng)} ${fngLabel(fng)}` : '—', fng != null ? `style=color:${fngColor(fng)}` : '') +
      sb('BTC 资金费率', frTxt, fr != null ? (fr >= 0 ? 'cup' : 'cdn') : '') +
      sb('BTC 多空比', lsr != null ? lsr.toFixed(2) : '—', lsr != null ? (lsr >= 1 ? 'cup' : 'cdn') : '');
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
      get('/api/stock/market'), get('/api/stock/opportunity'), get('/api/crypto/overview'),
    ]).then(([jm, jo, jc]) => {
      const d = (jm && jm.data) || {};
      d.crypto = (jc && jc.data) || {};
      const { qmap, temp } = renderPulse(d);
      renderAIndex(qmap);
      renderAStrip(d, qmap);
      renderCIdx(d.crypto);
      // 今日信号需跨 market+crypto 的派生事实
      const qs = (d.qt && d.qt.ok && d.qt.data) || [];
      const qq = {}; qs.forEach(r => { if (r && r.ok) qq[r.code] = r; });
      const ov = d.crypto;
      const spot = ov.spot && ov.spot.binance, okx = ov.spot && ov.spot.okx, dom = ov.dom;
      renderSignals(buildSignals({ qmap: qq, temp, limit: d.limit, breadth: d.breadth, ov, moversTop: movers(spot, okx, dom) }));
      renderOppA(jo);
      renderOppC(ov);
      const asOf = qs.map(r => r.time).find(t => t);
      $('status').textContent = `免费源 · A股缓存60s / 币圈30s · 行情时间 ${fmtQuoteTime(asOf) || '—'} · 刷新于 ${new Date().toLocaleTimeString('zh-CN')} · A股红涨绿跌 / 币圈绿涨红跌`;
    }).catch(() => { $('status').textContent = '部分数据源暂不可用,点击页内刷新可重试'; });
    $('footnote').textContent = '口径说明:首页只消费各雷达页同一批免费接口。「市场温度」「恐慌贪婪」与「今日信号/机会评分」均为启发式读数,不含基本面与逐笔数据,非投资建议;进入 A股/币圈 雷达可见完整分项与数据边界。';
  }
  document.getElementById('refresh') && (document.getElementById('refresh').onclick = loadAndRender);
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
  console.log('hub.js selftest OK');
}
if (typeof require !== 'undefined' && require.main === module) selftest();
