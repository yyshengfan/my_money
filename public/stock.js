/* 大A六块仪表盘前端:①市场概况 ②板块行情 ③今日机会 ④市场资金 ⑤重要资讯 ⑥市场异动。
   数据端点 /api/stock/{market,boards,opportunity,flow,news} 返回 {ok,data}|{ok:false,error},
   单源失败只红对应卡,永不白屏。纯函数(评分/温度/解析)在顶层,可 node public/stock.js 自检。
   A股配色:红涨绿跌。 */

// ---------- 顶层纯函数(自检用) ----------

// A股涨跌类:红涨绿跌
function aCls(v) { return v > 0 ? 'rn' : v < 0 ? 'gn' : ''; }

// 行情时间 → 可读(紧凑 20260904150000 / 带斜杠 / 空)
function fmtQuoteTime(t) {
  const s = String(t || '');
  const d = s.replace(/\D/g, '');
  if (d.length >= 12) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)} ${d.slice(8, 10)}:${d.slice(10, 12)}`;
  return s || '—';
}

// 数字安全取数:null/'-'/空/NaN → null(顶层版 p2,浏览器与 node 自检共用)
function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 元 → 带符号亿文本(+2.10亿 / -0.48亿 / —);n 为空/非法 → —(注意 Number(null)=0,需先判空)
function fmtYi(n) {
  if (n == null || n === '') return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '-') + (Math.abs(v) / 1e8).toFixed(2) + '亿';
}

// 两市成交额:qt 的 f37 单位是"万元",两值加和 → 亿/万亿文本;任一缺 → —
function turnoverTxt(shWan, szWan) {
  if (numOrNull(shWan) == null || numOrNull(szWan) == null) return '—';
  const yi = (numOrNull(shWan) + numOrNull(szWan)) / 10000;
  return yi >= 10000 ? (yi / 10000).toFixed(2) + '万亿' : Math.round(yi) + '亿';
}

// 市场温度:指数 + 涨跌家数 + 涨停-跌停 三信号合成 0-100(缺的项不参与,权重归一)
// 指数 +3%→1 / -3%→0;上涨占比 0.2→0 / 0.8→1;涨停-跌停差 ±60 封顶
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function marketTemp(idxPct, ratio, zt, dt) {
  const have = [
    idxPct != null && Number.isFinite(+idxPct),
    ratio != null && Number.isFinite(+ratio),
    zt != null && dt != null && Number.isFinite(+zt) && Number.isFinite(+dt),
  ];
  if (!have.some(Boolean)) return null;
  const c = [
    have[0] ? clamp01((+idxPct / 3 + 1) / 2) : null,
    have[1] ? clamp01((+ratio - 0.2) / 0.6) : null,
    have[2] ? clamp01((+zt - +dt) / 60 + 0.5) : null,
  ];
  const W = [40, 40, 20];
  let s = 0, wsum = 0;
  for (let i = 0; i < 3; i++) if (c[i] != null) { s += c[i] * W[i]; wsum += W[i]; }
  const score = Math.round(100 * s / wsum);
  const meta =
    score >= 78 ? ['🔥 极强', 'rn'] : score >= 58 ? ['🟢 偏强', 'rn'] :
    score >= 42 ? ['🟡 中性', ''] : score >= 25 ? ['🟠 偏弱', 'gn'] : ['🔴 极弱', 'gn'];
  return { score, label: meta[0], cls: meta[1] };
}

// 今日机会启发式评分(免费口径,非投资建议):
// score = 流入0-30 + 走势0-25 + 健康0-20 + 低估0-15;涨停(pct≥9.8)剔除;过热项封顶 55 并标「已过热」。
// r = {pct,mainNet(元),turn,volRatio,pe,pb,ind};indPct: Map(行业名→板块当日涨幅)。
function oppScore(r, indPct) {
  const p = numOrNull(r.pct);
  if (p == null || p >= 9.8) return null; // 打板/新股不算"机会"
  const mn = numOrNull(r.mainNet);
  const g = mn == null ? null : mn / 1e8; // 主力净流入(亿);真缺/为0不冒充流入
  const vr = numOrNull(r.volRatio);
  const turn = numOrNull(r.turn);

  let flow = 0;
  if (g != null) flow = g >= 3 ? 30 : g >= 1.5 ? 24 : g >= 0.8 ? 18 : g > 0 ? 6 : 0; // 净流出记 0
  let trend = 5; // pct<0 只给 5 分
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

  const pe = numOrNull(r.pe);
  const pb = numOrNull(r.pb);
  const low = (pe != null && pe > 0 && pe <= 20) || (pb != null && pb > 0 && pb <= 1.5);

  let score = flow + trend + health + (low ? 15 : 0);
  if (hot) score = Math.min(score, 55);

  const tags = [];
  if (hot) tags.push('已过热');
  if (low) tags.push('低估值');
  if (g != null && g >= 0.5) tags.push('主力流入');
  if (vr != null && vr > 1 && vr <= 3 && (turn == null || turn <= 12)) tags.push('温和放量');
  const ip = r.ind && indPct ? indPct.get(r.ind) : undefined;
  if (ip != null && Number.isFinite(+ip) && +ip > 0) tags.push('板块强势');
  for (const drop of ['板块强势', '温和放量', '主力流入', '低估值'])
    while (tags.length > 3 && tags.includes(drop)) tags.splice(tags.indexOf(drop), 1);

  const parts = [];
  if (g != null) parts.push(`主力净流入 ${g >= 0 ? '+' : ''}${g.toFixed(1)}亿`);
  if (vr != null) parts.push(`量比 ${vr.toFixed(1)}`);
  if (ip != null && Number.isFinite(+ip) && +ip > 0) parts.push(`${r.ind} 板块 ${+ip > 0 ? '+' : ''}${(+ip).toFixed(1)}%`);
  if (low) parts.push(pe != null && pe > 0 ? `PE ${pe.toFixed(0)}` : `PB ${pb.toFixed(1)}`);
  return {
    score,
    tags,
    reason: parts.join(' · ') || '免费口径暂无资金/量比数据',
    pct: p,
    ind: r.ind,
  };
}

// 板块 tab 本地排序(都不改动原数组)
function boardTop(rows, tab) {
  const key = { 涨幅: 'pct', 净流入: 'mainNet', 净流出: 'mainNet', 净占比: 'mainPct' }[tab];
  const asc = tab === '净流出';
  const withv = (rows || []).filter(r => r && Number.isFinite(+r[key]));
  return withv.sort((a, b) => (asc ? +a[key] - +b[key] : +b[key] - +a[key])).slice(0, 8);
}

// ---------- 浏览器渲染 ----------
if (typeof window !== 'undefined') {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f2 = v => (v == null || !Number.isFinite(+v)) ? '—' : (+v).toFixed(2);
  const p2 = v => (v == null || !Number.isFinite(+v)) ? null : +v;
  const grp = s => (s == null ? '—' : (+s).toLocaleString('zh-CN'));
  const srcBadges = named => Object.entries(named).map(([k, r]) =>
    r && r.ok ? `<span class="k">✓ ${k}</span>` : `<span class="x">✗ ${k}${r && r.error ? ':' + esc(String(r.error)) : ''}</span>`
  ).join(' ');
  const pctCell = (v, clsEmpty) => {
    const p = p2(v);
    if (p == null) return `<span class="dim">—</span>`;
    return `<span class="${p >= 0 ? 'rn' : 'gn'}">${p > 0 ? '+' : ''}${p.toFixed(2)}%</span>`;
  };
  const TAG_STYLE = {
    低估值: 'color:#c8a2ff;background:#221433', 主力流入: 'color:#ff8f8f;background:#2a1418',
    温和放量: 'color:#7fb0ff;background:#132238', 板块强势: 'color:#ffd25e;background:#2a2413',
    已过热: 'color:#ff9f6b;background:#2a1d10',
  };

  let boardRows = []; // 板块全表,②④ 与 ③ 板块强势共用
  let boardTab = '涨幅';
  let boardFail = false; // 东财板块(④列)拉取失败/等待态
  let indPct = new Map(); // 行业名 → 板块当日涨幅(机会标签)
  const mv = document.getElementById('moves-body');

  const NO_BOARD = '<div class="err">✗ 板块数据不可用(东财接口被限流时请稍后刷新)</div>';
  const NO_POOL = '<div class="err">✗ 涨停池不可用</div>';

  // ① 市场概况
  function renderMarket(d) {
    document.getElementById('src-mkt').innerHTML = srcBadges({
      '腾讯指数': d.qt, '东财涨跌家数': d.breadth, '东财涨跌停': d.limit,
    });
    const qs = (d.qt && d.qt.ok && d.qt.data) || [];
    const cards = qs.filter(r => r.code !== 'sz399106');
    document.getElementById('idxrow').innerHTML = cards.map(r => {
      if (!r.ok) return `<div class="idx"><div class="nm">${esc(r.code)}</div><div class="dim small">✗ ${esc(r.error || '无行情')}</div></div>`;
      return `<div class="idx">
        <div class="nm">${esc(r.name)}</div>
        <div class="pv ${aCls(r.chg)}">${f2(r.price)}</div>
        <div class="ch ${aCls(r.chg)}"><span>${r.chg > 0 ? '+' : ''}${r.chg.toFixed(2)}</span><span>${r.chgPct > 0 ? '+' : ''}${r.chgPct.toFixed(2)}%</span></div>
        <div class="am">${fmtQuoteTime(r.time)}</div>
      </div>`;
    }).join('');

    const b = (d.breadth && d.breadth.ok && d.breadth.data) || null;
    const l = (d.limit && d.limit.ok && d.limit.data) || null;
    const shIdx = qs.find(r => r.code === 'sh000001');
    const szi = qs.find(r => r.code === 'sz399106');
    const tmp = marketTemp(shIdx && shIdx.ok ? shIdx.chgPct : null,
      b ? b.ratio : null, l ? l.zt : null, l ? l.dt : null);
    const tCell = tmp
      ? `<span class="${tmp.cls}">${tmp.label}</span><span class="sub">温度 ${tmp.score}</span>`
      : '<span class="dim">—</span>';
    const box = (k, v, cls = '') => `<div class="ms"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
    document.getElementById('mktstrip').innerHTML =
      box('上涨家数', b ? grp(b.up) : '—', b ? 'rn' : '') +
      box('下跌家数', b ? grp(b.down) : '—', b ? 'gn' : '') +
      box('平盘', b ? grp(b.flat) : '—') +
      box('涨停 / 跌停', l ? `${grp(l.zt)} <span class="gn">/ ${grp(l.dt)}</span>` : '—') +
      box('两市成交额', (shIdx && szi) ? turnoverTxt(shIdx.amountWan, szi.amountWan) : '—') +
      `<div class="ms tmp"><span class="k">市场温度</span><span class="v">${tCell}</span></div>`;
  }

  // ② 板块行情(pills 本地排序)
  function renderBoards() {
    const el = document.getElementById('board-body');
    if (!boardRows.length) { el.innerHTML = NO_BOARD; return; }
    const rowHtml = r => {
      const pct = p2(r.pct), amt = p2(r.mainNet), mp = p2(r.mainPct);
      const w = pct != null ? Math.min(100, Math.abs(pct) * 12) : 0;
      return `<div class="listrow"><span class="bg" style="width:${w}%;background:${(pct || 0) >= 0 ? 'var(--down)' : 'var(--up)'}"></span>
        <span class="n">${esc(r.name)}</span>
        <span class="v">${pctCell(r.pct)}</span>
        <span class="v ${amt == null ? '' : (amt >= 0 ? 'rn' : 'gn')}">${fmtYi(r.mainNet)}</span>
        <span class="v dim">${mp == null ? '—' : (mp > 0 ? '+' : '') + mp.toFixed(1) + '%'}</span></div>`;
    };
    el.innerHTML = `<div class="listrow head"><span class="n">板块</span><span class="v">涨跌幅</span><span class="v">主力净流入</span><span class="v">净占比</span></div>` +
      boardTop(boardRows, boardTab).map(rowHtml).join('');
  }
  function renderBoardPills() {
    const tabs = ['涨幅', '净流入', '净流出', '净占比'];
    document.getElementById('board-pills').innerHTML =
      `<div class="pills" style="margin:0">` + tabs.map(t =>
        `<button class="${t === boardTab ? 'on' : ''}" data-t="${t}">${t}</button>`).join('') + `</div>`;
    document.querySelectorAll('#board-pills button').forEach(b =>
      b.onclick = () => { boardTab = b.dataset.t; renderBoardPills(); renderBoards(); });
  }

  // ③ 今日机会(评分 Top6)
  function renderOpp(o) {
    const el = document.getElementById('opps');
    document.getElementById('src-opp').innerHTML = srcBadges({ '东财全A': o });
    if (!o || !o.ok) { el.innerHTML = '<div class="err">✗ 全A行情不可用(评分需涨跌/资金/换手/估值,东财限流时刷新重试)</div>'; return; }
    const rows = o.data.cands || [];
    const ranked = rows
      .map(r => ({ r, s: oppScore(r, indPct) }))
      .filter(x => x.s)
      .sort((a, b) => b.s.score - a.s.score || (b.s.pct || 0) - (a.s.pct || 0))
      .slice(0, 6);
    if (!ranked.length) { el.innerHTML = '<div class="err">今日无符合启发式的标的(可能全A行情未就绪)</div>'; return; }
    el.innerHTML = ranked.map(({ r, s }, i) => `
      <div class="opp">
        <div class="sc ${s.score >= 65 ? 'hi' : s.score >= 45 ? 'mid' : ''}">${s.score}</div>
        <div class="h"><span class="nm">${esc(r.name)}</span><span class="code">${esc(r.code)}</span>
          <span style="margin-left:auto" class="mono ${aCls(s.pct)}">${s.pct > 0 ? '+' : ''}${s.pct.toFixed(2)}%</span></div>
        <div class="tags">${s.tags.map(t => `<span class="tag" style="${TAG_STYLE[t]}">${t}</span>`).join('')}</div>
        <div class="why">${esc(s.reason)}<span class="xi">${esc(s.ind || '')}</span></div>
      </div>`).join('');
    document.getElementById('opp-note').textContent =
      `评分=主力流入30+走势25+量价健康20+估值15(启发式,满 100)。剔除涨停(pct≥9.8)与过热项。` +
      `仅用东财日频免费口径(主力/换手/量比/PE/PB),无北向、无逐笔,非投资建议。`;
  }

  // ④ 市场资金:涨停池主力聚焦 | 板块净流入/流出 | 连板聚焦
  function renderFlow(poolRes) {
    document.getElementById('src-flow').innerHTML = srcBadges({ '东财涨停池': poolRes });
    if (!poolRes || !poolRes.ok) {
      document.getElementById('flow-grid').innerHTML = NO_POOL;
      document.getElementById('flow-note').textContent = '';
      return;
    }
    const rows = poolRes.data.rows || [];
    const byFund = [...rows].sort((a, b) => (+b.mainNet || 0) - (+a.mainNet || 0)).slice(0, 6);
    const byLb = [...rows].filter(r => (+r.lb || 0) >= 2)
      .sort((a, b) => (+b.lb || 0) - (+a.lb || 0) || (+b.amount || 0) - (+a.amount || 0)).slice(0, 6);
    const mini = (list, fn) => list.map((r, i) => fn(r, i)).join('') || '<div class="dim small">无数据</div>';
    const inRow = r => `<div class="r"><span class="in">${r.name}</span><span class="num ${(p2(r.mainNet) || 0) >= 0 ? 'rn' : 'gn'}">${fmtYi(r.mainNet)}</span></div>`;
    const lbRow = r => `<div class="r"><span class="n">${esc(r.name)}</span><span class="lb">${r.lb}连</span><span class="in">${esc(r.board || '')}</span><span class="num ${(p2(r.mainNet) || 0) >= 0 ? 'rn' : 'gn'}">${fmtYi(r.mainNet)}</span></div>`;
    const g = boardRows.slice().sort((a, b) => (+b.mainNet || 0) - (+a.mainNet || 0)).filter(r => p2(r.mainNet) != null);
    const topIn = g.slice(0, 5), topOut = g.slice(-5).reverse().filter(r => p2(r.mainNet) < 0);
    const boardCol = boardRows.length
      ? `<div class="minir">${mini(topIn, inRow)}<div class="xi" style="padding:4px 0 2px">净流出</div>${mini(topOut, inRow)}</div>`
      : boardFail
        ? '<div class="err" style="padding:0">✗ 东财板块数据不可用</div>'
        : '<div class="dim small">等待板块数据…</div>';
    document.getElementById('flow-grid').innerHTML = `
      <div class="gcol"><h3>涨停池 · 主力净流入聚焦</h3><div class="minir">${mini(byFund, lbRow)}</div></div>
      <div class="gcol"><h3>行业板块 · 净流入 / 净流出 Top5</h3>${boardCol}</div>
      <div class="gcol"><h3>连板聚焦(≥2 连)</h3><div class="minir">${mini(byLb, lbRow)}</div></div>`;
    document.getElementById('flow-note').textContent =
      `口径:涨停池 rows 来自东财涨停池(主力净流入=fund 字段),板块资金与 ② 同源。` +
      `免费口径没有全市场超大单/大单细分,北向资金官方已停发 —— 此处不做假数。${poolRes.data.date} 涨停池共 ${rows.length} 只。`;
  }

  // ⑤ 重要资讯
  function renderNews(nw) {
    const el = document.getElementById('news');
    document.getElementById('src-news').innerHTML = srcBadges({ '东财资讯': nw });
    if (!nw || !nw.ok) { el.innerHTML = '<div class="err">✗ 资讯不可用</div>'; return; }
    const tc = { 政策: 'tc-policy', 市场: 'tc-market', 公司: 'tc-company', 要闻: 'tc-news' };
    el.innerHTML = (nw.data || []).map(x => `
      <div class="nrow">
        <a class="t" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>
        ${x.summary ? `<div class="s">${esc(x.summary)}</div>` : ''}
        <div class="m"><span class="tchip ${tc[x.tag] || 'tc-news'}">${x.tag || '要闻'}</span><span>${esc(x.media || '')}</span><span style="margin-left:auto">${esc(String(x.time || '').slice(0, 16))}</span></div>
      </div>`).join('');
  }

  // ⑥ 市场异动:涨停连板(池) + 大跌 + 放量(机会全A列表附带的跌/量比榜)
  function renderMoves(oppRes, poolRes) {
    document.getElementById('src-moves').innerHTML = srcBadges({ '东财全A': oppRes, '东财涨停池': poolRes });
    const cols = [];
    const poolRows = (poolRes && poolRes.ok && poolRes.data.rows) || [];
    const zt = [...poolRows].filter(r => (+r.lb || 0) >= 2)
      .sort((a, b) => (+b.lb || 0) - (+a.lb || 0) || (+b.pct || 0) - (+a.pct || 0)).slice(0, 5);
    cols.push(`<div class="colh">涨停连板</div>` +
      (zt.length ? zt.map(r => `<div class="minir"><div class="r"><span class="lb">${r.lb}连</span><span class="n">${esc(r.name)}</span><span class="num rn">${r.pct > 0 ? '+' : ''}${(+r.pct).toFixed(1)}%</span></div></div>`).join('')
        : '<div class="blk-note">无 2 连及以上涨停</div>'));
    const down = ((oppRes && oppRes.ok && oppRes.data.down) || []).slice(0, 6);
    cols.push(`<div class="colh">跌幅榜</div>` +
      (down.length ? down.map(r => `<div class="minir"><div class="r"><span class="n">${esc(r.name)}</span><span class="num ${aCls(r.pct)}">${p2(r.pct) == null ? '—' : (r.pct > 0 ? '+' : '') + (+r.pct).toFixed(2) + '%'}</span></div></div>`).join('')
        : '<div class="blk-note">全A跌幅榜暂未返回</div>'));
    const vol = ((oppRes && oppRes.ok && oppRes.data.vol) || []).slice(0, 6);
    cols.push(`<div class="colh">量比榜(放量)</div>` +
      (vol.length ? vol.map(r => `<div class="minir"><div class="r"><span class="n">${esc(r.name)}</span><span class="num">量比 ${p2(r.volRatio) == null ? '—' : (+r.volRatio).toFixed(1)}</span><span class="num ${aCls(r.pct)}">${p2(r.pct) == null ? '' : (r.pct > 0 ? '+' : '') + (+r.pct).toFixed(1) + '%'}</span></div></div>`).join('')
        : '<div class="blk-note">量比榜暂未返回</div>'));
    mv.innerHTML = cols.join('');
  }

  // 东财 clist(板块/机会/跌量榜)被限流时会变慢或失败,分批渲染 —— 先画 市场/涨停池/资讯,clist 好了再补 ②③④板块列 ⑥。
  async function loadAndRender() {
    const st = document.getElementById('status');
    st.textContent = '加载中…';
    const get = u => fetch(u).then(r => r.json()).catch(() => null);
    // 第一批:不依赖 clist 的快源(指数/涨停池/资讯)→ 立即出画面
    const [jm, jf, jn] = await Promise.all([
      get('/api/stock/market'), get('/api/stock/flow'), get('/api/stock/news'),
    ]);
    renderMarket((jm && jm.data) || {});
    const poolRes = (jf && jf.data && jf.data.pool) || { ok: false, error: '接口不可达' };
    renderFlow(poolRes);
    renderNews((jn && jn.data && jn.data.em) || { ok: false, error: '接口不可达' });
    // 第二批:东财 clist 系(板块/机会)后台等;限流时先画上面,这里好了再补 ②③④板块列 ⑥
    const [jb, jo] = await Promise.all([
      get('/api/stock/boards'), get('/api/stock/opportunity'),
    ]);
    const boardsRes = (jb && jb.data && jb.data.em) || { ok: false, error: '接口不可达' };
    const oppRes = (jo && jo.data && jo.data.em) || { ok: false, error: '接口不可达' };
    document.getElementById('src-boards').innerHTML = srcBadges({ '东财板块': boardsRes });
    boardFail = !boardsRes.ok;
    boardRows = (boardsRes.ok && boardsRes.data) || [];
    indPct = new Map(boardRows.filter(r => r.name).map(r => [r.name, r.pct]));
    renderBoardPills();
    renderBoards();
    renderFlow(poolRes); // 补上板块净流入/流出列(含失败红注)
    renderOpp(oppRes);
    renderMoves(oppRes, poolRes);

    const qtRows = ((jm && jm.data && jm.data.qt) && jm.data.qt.ok && jm.data.qt.data) || [];
    const asOf = qtRows.map(r => r.time).find(t => t);
    st.textContent = `免费源 · 服务端 60s 缓存 · 行情时间 ${fmtQuoteTime(asOf) || '—'} · 刷新于 ${new Date().toLocaleTimeString('zh-CN')} · A股红涨绿跌`;
  }

  document.getElementById('refresh').onclick = loadAndRender;
  loadAndRender(); // 块内定义并自调用;勿在 HTML 尾部再加 <script>loadAndRender()</script>
}

// ---------- 自检(node public/stock.js) ----------
function selftest() {
  const A = (c, m) => console.assert(c, m);
  A(aCls(1) === 'rn' && aCls(-1) === 'gn' && aCls(0) === '', 'A股红涨绿跌类');
  A(fmtQuoteTime('20260904150000') === '2026-09-04 15:00', '紧凑时间');
  A(fmtQuoteTime('') === '—', '空时间');
  A(fmtYi(2.1e8) === '+2.10亿' && fmtYi(-4.8e7) === '-0.48亿' && fmtYi(null) === '—', 'fmtYi');
  A(turnoverTxt(88852161, 103665671) === '1.93万亿', '两市成交额万亿');
  A(turnoverTxt(null, 103665671) === '—', '缺一市场→—');

  const t = marketTemp(0.5, 0.55, 10, 3);
  A(t && t.score > 42 && t.score < 70, '正常偏强日应中性偏强');
  A(marketTemp(2, 0.7, 60, 5).score >= 58, '普涨大涨应偏强+');
  A(marketTemp(-2, 0.3, 2, 60).score <= 42, '普跌应偏弱');
  A(marketTemp(null, null, null, null) === null, '全缺→null');
  const idxOnly = marketTemp(0.5, null, null, null);
  A(idxOnly != null && idxOnly.score > 0, '只给指数也能出温度');

  const indPct = new Map([['半导体', 2.3], ['银行', -0.4]]);
  // 强资金+温和放量+低估值+板块强势 → 高分
  const s1 = oppScore({ pct: 3.2, mainNet: 2.1e8, turn: 5, volRatio: 1.8, pe: 12, pb: 1.4, ind: '半导体' }, indPct);
  A(s1 && s1.score === 79, '满分标的 79 分(24+20+20+15)');
  A(s1.tags.length <= 3 && s1.tags.includes('主力流入') && s1.tags.includes('温和放量') && s1.tags.includes('低估值'), '标签≤3 且含核心');
  A(s1.reason.includes('主力净流入 +2.1亿') && s1.reason.includes('半导体 板块 +2.3%'), '理由行指标');
  // 涨停剔除;过热封顶 55 带标
  A(oppScore({ pct: 10.1, mainNet: 3e8, turn: 3, volRatio: 1.5, pe: 15, pb: 1, ind: 'x' }, indPct) === null, '涨停剔除');
  const s2 = oppScore({ pct: 8.6, mainNet: 5e8, turn: 8, volRatio: 1.6, pe: 10, pb: 1, ind: 'y' }, indPct);
  A(s2 && s2.score <= 55 && s2.tags.includes('已过热'), '过热封顶55');
  // 弱势无资金股 → 低分(不该进 Top6)
  A(oppScore({ pct: -1.2, mainNet: null, turn: 2, volRatio: 1.1, pe: 80, pb: 9, ind: 'z' }, indPct).score === 25, '跌且无资金无估值仅低分');
  // 量比缺失(如上市首日 '-')仍可评分
  A(oppScore({ pct: 2, mainNet: 1e8, turn: 30, volRatio: null, pe: null, pb: null, ind: 'w' }, indPct).score >= 0, '量比缺失仍可评分');

  // 板块排序
  const rows = [{ name: 'A', pct: 3, mainNet: 1e8, mainPct: 2 }, { name: 'B', pct: 1, mainNet: 5e8, mainPct: 1 }, { name: 'C', pct: null, mainNet: -2e8, mainPct: null }];
  A(boardTop(rows, '涨幅')[0].name === 'A' && boardTop(rows, '净流入')[0].name === 'B', '板块排序');
  const out = boardTop(rows, '净流出');
  A(out.length === 3 && out[0].name === 'C', '净流出=升序,最负排最前');
  console.log('stock.js selftest OK');
}
if (typeof require !== 'undefined' && require.main === module) selftest();
