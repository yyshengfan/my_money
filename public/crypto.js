/* 币圈板块前端:五币现货/市值、BTC·ETH ETF 资金流、四大所活动(每所 ≤3)、全中文。
   纯函数可自检:node public/crypto.js */

// alternative.me 档位:0-24 极度恐惧 / 25-49 恐惧 / 50-74 贪婪 / 75-100 极度贪婪
function fngLabel(v) {
  return v <= 24 ? '极度恐惧' : v <= 49 ? '恐惧' : v <= 74 ? '贪婪' : '极度贪婪';
}
function fngColor(v) {
  return v <= 24 ? 'var(--down)' : v <= 49 ? '#ff9f6b' : v <= 74 ? 'var(--up)' : '#2ecc71';
}

// 1.23T / 456B / 7.8M;小于百万不缩放
function fmtUsdShort(x) {
  const n = Number(x);
  if (!isFinite(n)) return '—';
  const u = [['T', 1e12], ['B', 1e9], ['M', 1e6]];
  for (const [s, m] of u) if (n >= m) return '$' + (n / m).toFixed(2) + s;
  return '$' + Math.round(n);
}

// 毫秒时间戳(或数字串)→ MM-DD HH:mm;其余原样
function fmtTs(x) {
  const n = Number(x);
  if (!isFinite(n) || n < 1e11) return String(x || '');
  const d = new Date(n);
  const p = v => String(v).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 公告行时间:epoch→短格式;ISO 日期串→只留日期;其余原样
function shortT(x) {
  const s = fmtTs(x);
  return /^\d{4}-\d\d-\d\d/.test(s) ? s.slice(0, 10) : s;
}

// 源结果 {ok,data}|{ok:false,error} → 状态条 html(键已是中文 label,诚实标注)
function srcBadges(named) {
  return Object.entries(named).map(([k, r]) =>
    r && r.ok ? `<span class="k">✓ ${k}</span>` : `<span class="x">✗ ${k}:${r && r.error ? r.error : '无数据'}</span>`
  ).join(' ');
}

// 币闻重要度(启发式,资讯时间线节点刻度用,2026-09-20 用户要求照首页事件雷达编排):
// BTC/ETH/ETF/监管/清算被盗类=hi 红圈;主流币/交易所/宏观数据类=mid 琥珀圈;其余=灰点。只判级别,不构成建议。
function cryptoNewsHeat(t) {
  const s = String(t || '');
  if (/BTC|ETH|比特币|以太坊|ETF|SEC|CFTC|清算|崩盘|暴跌|黑客|漏洞|被盗|监管|禁令|合规|美联储|加息|降息|稳定币|USDT|USDC/.test(s)) return 'hi';
  if (/SOL|XRP|BNB|DOGE|ADA|Coinbase|Binance|币安|OKX|Ripple|MicroStrategy|Strategy|空投|质押|公链|上所|通胀|CPI/.test(s)) return 'mid';
  return '';
}

// 交易所活动「含金量」(2026-09-22 用户要求红标):新币上线/大赛奖池/空投返佣/理财收益类=高,标红。
// 纯关键词启发,判不了细则也判不了真伪——只当「值得点开看看」的信号,页面注记已写明。
function annHi(t) {
  const s = String(t || '');
  // 只标真有肉的:新币上线(须挨着现货/合约语境)、交易大赛/瓜分/带数字奖池、空投、返佣减免、写明数值的年化。
  // 「奖励」「理财」「赚币」等泛词曾把答题噱头、产品更新也标上——2026-09-22 用户嫌滥,删。
  // 间距 30 字符:实测「上线 PONS/USDT (Pons Family) 现货交易」上线与现货间隔 25 字,曾漏标新币上线(2026-09-22)
  return /(上线|上架|上所|上新).{0,30}(现货|合约|交易)|交易大赛|瓜分|奖池.{0,12}\d|代币券|空投|Airdrop|返佣|返现|手续费.{0,4}减免|年利率高达|年化.{0,6}\d+%|APR|APY|Prize Pool/i.test(s);
}

// 美元 → 带符号亿:+1.75亿 / -0.48亿 / —(ETF 资金流量级用 亿 比 B/M 更顺)
function fmtYi(x) {
  const n = Number(x);
  if (!isFinite(n)) return '—';
  return (n >= 0 ? '+' : '-') + (Math.abs(n) / 1e8).toFixed(2) + '亿';
}

// 逐日累计(daily 升序;缺某币当日按 0 记,线走平而不是断)
function cumRun(daily) {
  const btc = [], eth = [];
  let b = 0, e = 0;
  for (const r of daily) {
    if (r.btc != null && Number.isFinite(+r.btc)) b += +r.btc;
    if (r.eth != null && Number.isFinite(+r.eth)) e += +r.eth;
    btc.push(b);
    eth.push(e);
  }
  return { btc, eth };
}

// 带符号美元:+$1.20B / −$3.00M / +$0(链上弹药增减量级用)
function fmtSignedUsd(x) {
  const n = Number(x);
  if (!isFinite(n)) return '—';
  const a = Math.abs(n);
  const s = n >= 0 ? '+' : '−';
  const u = [['T', 1e12], ['B', 1e9], ['M', 1e6]];
  for (const [z, m] of u) if (a >= m) return s + '$' + (a / m).toFixed(2) + z;
  return s + '$' + Math.round(a);
}

// OI 多所时间轴合并:各所点归到对齐桶(1h/4h),同桶覆盖保最新;total=该桶可达所之和,n=参与所数
// (某所中途挂 → 合计会跳台阶,tooltip 按 n 标「N所合计」,不假装全平台)
function oiMerge(s, bucketMs) {
  const KS = ['binance', 'okx', 'bybit'];
  const m = new Map();
  for (const k of KS) {
    const d = s[k] && s[k].ok ? s[k].data || [] : [];
    for (const p of d) {
      if (!isFinite(p.t) || !isFinite(p.usd)) continue;
      const t = p.t - (p.t % bucketMs);
      if (!m.has(t)) m.set(t, { t });
      m.get(t)[k] = +p.usd;
    }
  }
  const rows = [...m.values()].sort((a, b) => a.t - b.t);
  for (const r of rows) {
    const ks = KS.filter(k => r[k] != null);
    r.n = ks.length;
    if (ks.length) r.total = ks.reduce((a, k) => a + r[k], 0);
  }
  return rows;
}

// 风险监控纯规则:吃页内已有数据 → [{lvl:'hi'|'mid'|'ok',name,val,hint}],渲染留在 window 块
// 费率按小数传入(0.0004=0.04%),阈值:拥挤 hi≥0.06%·mid≥0.03%;波幅 hi≥10%·mid≥5%;
// 情绪 hi≤12 或 ≥88·mid≤25 或 ≥80;链上拥堵 hi≥80 sat/vB·mid≥25。
function riskAssess(o) {
  const { rates, spot, fng, mem } = o || {};
  const out = [];
  const push = (lvl, name, val, hint) => out.push({ lvl, name, val, hint });

  let worst = null;
  for (const x of rates || []) {
    if (!x || !Number.isFinite(+x.r)) continue;
    const a = Math.abs(x.r);
    if (!worst || a > worst.a) worst = { ex: x.ex, r: x.r, a };
  }
  if (worst) {
    const p = worst.a * 100;
    push(p >= 0.06 ? 'hi' : p >= 0.03 ? 'mid' : 'ok', '永续费率·多空拥挤',
      `${worst.ex} ${worst.r >= 0 ? '+' : ''}${(worst.r * 100).toFixed(4)}%`,
      p >= 0.06 || p >= 0.03
        ? (worst.r >= 0 ? '多头付费偏高,谨防一致性回调 / 多平插针' : '空头付费过深,警惕轧空反弹')
        : '费率常规区间,无单边拥挤');
  } else push('ok', '永续费率·多空拥挤', '—', '费率数据未就绪');

  const big = (spot || []).filter(x => x && Number.isFinite(+x.chgPct)).reduce((m, x) => (m == null || Math.abs(x.chgPct) > Math.abs(m.chgPct) ? x : m), null);
  if (big) {
    const a = Math.abs(big.chgPct);
    push(a >= 10 ? 'hi' : a >= 5 ? 'mid' : 'ok', '主流币 24h 波幅',
      `${big.sym} ${big.chgPct > 0 ? '+' : ''}${Number(big.chgPct).toFixed(2)}%`,
      a >= 10 || a >= 5 ? '波动放大,杠杆清算会加剧短线急插,止损宜放宽' : '波幅正常');
  }

  const fv = Number.isFinite(+fng) ? +fng : null;
  if (fv != null) {
    push(fv <= 12 || fv >= 88 ? 'hi' : fv <= 25 || fv >= 80 ? 'mid' : 'ok', '恐惧贪婪·情绪极端',
      `${Math.round(fv)} · ${fngLabel(fv)}`,
      fv <= 12 || fv >= 88 || fv <= 25 || fv >= 80
        ? (fv >= 80 ? '过度贪婪,追高需谨慎,谨防反身回落' : '深度恐慌,谨防错杀,留意是否见底')
        : '市场情绪中性');
  }

  const mf = mem && Number.isFinite(+mem.fast) ? +mem.fast : null;
  if (mf != null) {
    push(mf >= 80 ? 'hi' : mf >= 25 ? 'mid' : 'ok', 'BTC 链上转账拥堵',
      `${mf} sat/vB`,
      mf >= 80 || mf >= 25 ? '链上拥堵、手续费高,确认变慢,谨防插针' : '链上顺畅,转账成本低');
  }
  return out;
}

if (typeof window !== 'undefined') {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const flowColor = v => (v >= 0 ? 'var(--up)' : 'var(--down)');
  // 上游数字偶发为空/0 除 → 一律降级 '—' 而非 "NaN"(f2 数值格,f2pct 带符号百分,sat 整数)
  const f2 = v => (v == null || !Number.isFinite(+v)) ? '—' : (+v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const p2 = v => (v == null || !Number.isFinite(+v)) ? null : +v;
  const sat = v => (p2(v) == null) ? '—' : Math.round(p2(v)) + '';

  // ECharts 实例统一管理:同一容器复用,resize 走一个监听,避免刷新/切币后叠监听
  const CM = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
  const liveCharts = new Set();
  window.addEventListener('resize', () => { for (const c of liveCharts) c.resize(); });
  const chartOf = el => {
    const c = echarts.getInstanceByDom(el);
    if (c) return c;
    const n = echarts.init(el);
    liveCharts.add(n);
    return n;
  };

  const MCAP_C = { BTC: '#f7931a', ETH: '#627eea', SOL: '#2dd4bf', BNB: '#f0b90b', OKB: '#fb7185', BGB: '#00f0ff', OTHER: '#2a3542' };
  const EX_COLORS = { binance: '#f0b90b', okx: '#58d68d', bitget: '#a78bfa', bybit: '#4f8cff' };
  const EX_LABEL = { binance: '币安', okx: '欧易', bitget: 'Bitget', bybit: 'Bybit' };
  const RISK_TAG = { hi: ['风险', '#ff6b6b'], mid: ['关注', '#ffb454'], ok: ['正常', '#58d68d'] };
  let fundCoin = 'BTC';
  let fundNow = []; // 各所当前费率(风险监控读取),loadFunding 时刷新
  let oiCoin = 'BTC';
  let oiRange = '7d'; // OI 图区间:1d/7d/30d

  async function loadAndRender() {
    const st = document.getElementById('status');
    const [ov, an, et, nw, ch, bk] = await Promise.all([
      fetch('/api/crypto/overview').then(r => r.json()).catch(() => null),
      fetch('/api/crypto/announcements').then(r => r.json()).catch(() => null),
      fetch('/api/crypto/etf').then(r => r.json()).catch(() => null),
      fetch('/api/crypto/news').then(r => r.json()).catch(() => null),
      fetch('/api/crypto/chain').then(r => r.json()).catch(() => null),
      fetch('/api/crypto/book').then(r => r.json()).catch(() => null),
    ]);
    const d = (ov && ov.data) || {};
    let spotRows = []; // 六币现货行,供下方宏观/风险板块复用(需提到 if 之外的作用域)

    // —— 市场概览:六币现货 + 全市场小结 + 市值结构 ——
    if (d.spot) {
      const binance = d.spot.binance, okx = d.spot.okx;
      spotRows = (binance && binance.ok ? binance.data : []).concat(okx && okx.ok ? okx.data : []);
      // 币安/欧易都没有现货的币(如 BGB,仅 Bitget 本所交易)用 dom 里 CoinGecko markets 同一次调用带回的价补行,不新增上游
      for (const x of ((d.dom && d.dom.ok && d.dom.data) || []))
        if (x.price != null && !spotRows.some(s => s.sym === x.sym))
          spotRows.push({ sym: x.sym, price: x.price, chgPct: x.chgPct, high: x.high, low: x.low, quoteVol: x.quoteVol, cg: true });
      document.getElementById('src-market').innerHTML = srcBadges({
        '币安现货': binance, 'OKX/OKB': okx,
        ...(spotRows.some(s => s.cg) ? { 'CoinGecko直采(BGB)': { ok: true } } : {}),
        'CoinGecko市值': d.global, 'CoinGecko占比': d.dom,
      });
      // 7d/30d涨幅与市值:CoinGecko markets 一次带回(dom: [{sym,cap,rank,chgPct,chg7,chg30}]),按币种查表
      const domMap = Object.fromEntries(((d.dom && d.dom.ok && d.dom.data) || []).map(x => [x.sym, x]));
      const chgCell = v => { const c = p2(v); return `<td class="${c == null ? '' : (c >= 0 ? 'pos' : 'neg')}">${c == null ? '—' : (c > 0 ? '+' : '') + c.toFixed(2) + '%'}</td>`; };
      document.getElementById('spot').innerHTML = spotRows.length
        ? `<table><thead><tr><th>币种</th><th>最新价</th><th>24h涨跌</th><th title="OKX 日K口径:今日 0 点(北京)开盘价至当下的涨跌幅,与 OKX App「日涨幅」同源;「24h涨跌」是滚动24小时,两列口径不同">日涨幅</th><th>7d涨跌</th><th>30d涨跌</th><th>90d涨跌</th><th>1y涨跌</th><th>市值</th><th>24h最高</th><th>24h最低</th><th>24h成交额</th></tr></thead><tbody>${
            spotRows.map(r => { const dm = domMap[r.sym] || {}; return `<tr><td class="nm">${r.sym}</td><td>${f2(r.price)}</td>${chgCell(r.chgPct)}${chgCell(r.dayPct)}${chgCell(dm.chg7)}${chgCell(dm.chg30)}${chgCell(dm.chg90)}${chgCell(dm.chg1y)}<td>${fmtUsdShort(dm.cap)}</td><td>${f2(r.high)}</td><td>${f2(r.low)}</td><td>${fmtUsdShort(r.quoteVol)}</td></tr>`; }).join('')
          }</tbody></table>`
        : '<div style="padding:18px;color:var(--down);font-size:13px">✗ 现货行情不可用</div>';
    }
    const g = d.global && d.global.ok ? d.global.data : null;
    const mc = g ? p2(g.mcapChgPct) : null;
    document.getElementById('gsum').innerHTML = g
      ? `<div class="g"><div class="gk">全市场总市值</div><div class="gv">${fmtUsdShort(g.totalUsd)}</div></div>
         <div class="g"><div class="gk">24h 市值变化</div><div class="gv ${mc == null ? '' : (mc >= 0 ? 'pos' : 'neg')}">${mc == null ? '—' : (mc > 0 ? '+' : '') + mc.toFixed(2) + '%'}</div></div>
         <div class="g"><div class="gk">BTC 占比</div><div class="gv">${g.btcPct != null && Number.isFinite(+g.btcPct) ? Number(g.btcPct).toFixed(1) + '%' : '—'}</div></div>
         <div class="g"><div class="gk">ETH 占比</div><div class="gv">${g.ethPct != null && Number.isFinite(+g.ethPct) ? Number(g.ethPct).toFixed(1) + '%' : '—'}</div></div>`
      : '<div class="gk" style="padding:14px 18px">全市场数据不可用</div>';
    // —— 市值结构:饼图(五币 + 其他;占比=市值/全市场)——(g 可能为空,函数内兜底)
    renderMcap((d.dom && d.dom.ok && d.dom.data) || [], g);

    // —— 相关新闻(标题已译简体)——(行数据 rows/g 后续宏观清单复用)
    renderNews(((nw && nw.data) || {}).news);

    // —— 恐慌贪婪:近30天折线 ——
    renderFng(d.fng);

    // —— ETF 资金流 ——
    const ef = et && et.data;
    document.getElementById('src-etf').innerHTML = srcBadges(
      ef ? { 'Farside 全历史回填': { ok: true }, '延后1日': { ok: true } } : { 'ETF 资金流': { ok: false, error: '接口不可达' } }
    );
    if (ef) {
      const box = (k, o) => `<div class="g"><div class="gk">${k}</div><div class="gv">${
        o.latest ? `<span style="color:${flowColor(o.latest.flow)}">${fmtYi(o.latest.flow)}</span><small> · ${o.latest.date}</small>` : '—'
      }</div></div>`;
      const cumBox = o => `<span style="color:${o >= 0 ? 'var(--up)' : 'var(--down)'}">${fmtYi(o)}</span>`;
      document.getElementById('etf-sum').innerHTML =
        box('BTC 昨日净流入', ef.btc) + `<div class="g"><div class="gk">BTC 累计净流入</div><div class="gv">${cumBox(ef.btc.cum)}</div></div>` +
        box('ETH 昨日净流入', ef.eth) + `<div class="g"><div class="gk">ETH 累计净流入</div><div class="gv">${cumBox(ef.eth.cum)}</div></div>`;
      drawEtfChart(ef);
      const upd = ef.updatedAt ? ' · 最近更新 ' + fmtTs(ef.updatedAt) : '';
      document.getElementById('etf-note').textContent =
        `Farside Investors 全历史回填 + 本机逐日增量,延后 1 日;曲线显示近 3 个月(累计自 ${ef.accumulatedFrom || '接入日'} 全历史计),最新一日未定稿会延后出现${upd}。仅 BTC/ETH 有现货 ETF。`;
    } else {
      document.getElementById('etf-note').textContent = '';
    }

    // —— 宏观驱动清单(复用本页已取数据)+ 链上数据 ——
    renderMacro(spotRows, g, d.fng, ef);
    renderChain((ch && ch.data) || null);
    renderBook((bk && bk.data) || null);

    // —— 活动 / 机会(四列 · 每源 ≤3)——
    const ad = (an && an.data) || {};
    document.getElementById('src-ann').innerHTML = srcBadges({ '币安': ad.binance, '欧易': ad.okx, 'Bybit': ad.bybit, 'Bitget': ad.bitget });
    const col = (title, r) => `<div class="col"><h3>${title}</h3>${
      r && r.ok && r.data.length
        ? '<ul>' + r.data.slice(0, 3).map(a => `<li>${annHi(a.title) ? '<span class="hot">机会</span>' : ''}${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>` : esc(a.title)}<span class="t">${shortT(a.time)}</span></li>`).join('') + '</ul>'
        : '<div class="e">✗ ' + esc((r && r.error) || '无数据') + '</div>'}</div>`;
    document.getElementById('ann').innerHTML = col('币安', ad.binance) + col('欧易', ad.okx) + col('Bybit', ad.bybit) + col('Bitget', ad.bitget);

    // —— 永续资金费率走势(币安/欧易/Bitget/Bybit 每所一线,币种可切换)——
    await loadFunding();
    // —— 未平仓合约 OI 走势(币安/欧易/Bybit + 合计)——
    await loadOi();

    // —— 风险监控:费率/波幅/情绪/拥堵,费率用当前资金费率图所在币种 ——
    const chd = (ch && ch.data) || null;
    const fngSorted = ((d.fng && d.fng.ok && d.fng.data) || []).slice().sort((a, b) => +a.ts - +b.ts);
    renderRisk(riskAssess({
      rates: fundNow,
      spot: spotRows,
      fng: fngSorted.length ? +fngSorted[fngSorted.length - 1].value : null,
      mem: chd && chd.mempool && chd.mempool.ok ? chd.mempool.data : null,
    }));

    st.textContent = `公开接口 · 服务端 30s 缓存 · 页面时间 ${new Date().toLocaleTimeString('zh-CN')}`;
  }

  // ETF 曲线(BTC/ETH 累计净流入双面积线);数据不足 2 日不画空图
  function drawEtfChart(ef) {
    const el = document.getElementById('etf-chart');
    const daily = ef.daily || [];
    if (!daily.length) { el.innerHTML = '<div class="etf-ph">暂无历史,自接入日起逐日累积后出图…</div>'; return; }
    if (!window.echarts) { el.innerHTML = '<div class="etf-ph">ECharts 未加载(需外网 CDN),数值仍可看上方小结</div>'; return; }
    try {
      const run = cumRun(daily);
      // 近3个月窗口(2026-09-20 用户要求;Farside 回填后全历史 ~690 日,全画太挤)——累计线仍按全历史基数,只切显示段
      const cut = new Date(Date.now() - 91 * 864e5).toISOString().slice(0, 10);
      let i0 = daily.findIndex(r => r.date >= cut);
      if (i0 < 0) i0 = 0;
      if (daily.length - i0 < 2) i0 = Math.max(0, daily.length - 2);
      const mono = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
      const AX = {
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: '#8b98a5', fontFamily: mono, fontSize: 11 },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,.07)', type: 'dashed' } },
      };
      const yi = v => `${v >= 0 ? '+' : ''}${(v / 1e8).toFixed(0)}亿`;
      const chart = chartOf(el);
      chart.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', backgroundColor: '#171e28', borderColor: '#263140', borderWidth: 1, textStyle: { color: '#e6edf3', fontFamily: CM, fontSize: 12 }, valueFormatter: v => (typeof v === 'number' ? fmtYi(v) : '—') },
        legend: { top: 6, icon: 'round', itemWidth: 9, itemHeight: 9, itemGap: 16, textStyle: { color: '#8b98a5', fontSize: 12 } },
        grid: { left: 76, right: 24, top: 40, bottom: 28 },
        xAxis: { type: 'category', data: daily.slice(i0).map(r => r.date), ...AX, splitLine: { show: false } },
        yAxis: { type: 'value', ...AX, axisLabel: { color: '#8b98a5', fontFamily: CM, fontSize: 11, formatter: yi } },
        series: [
          { name: 'BTC 累计', type: 'line', symbol: 'none', lineStyle: { width: 2.5, color: '#4f8cff', shadowBlur: 8, shadowColor: '#4f8cff55' }, itemStyle: { color: '#4f8cff' }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#4f8cff30' }, { offset: 1, color: '#4f8cff00' }] } }, data: run.btc.slice(i0) },
          { name: 'ETH 累计', type: 'line', symbol: 'none', lineStyle: { width: 2.5, color: '#a78bfa', shadowBlur: 8, shadowColor: '#a78bfa55' }, itemStyle: { color: '#a78bfa' }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#a78bfa30' }, { offset: 1, color: '#a78bfa00' }] } }, data: run.eth.slice(i0) },
        ],
      });
    } catch (err) {
      el.innerHTML = `<div class="etf-ph">✗ 图表渲染失败:${esc(String(err && err.message || err))}</div>`;
    }
  }

  // —— 市值结构饼图(五币 + 其他;占比 = 市值/全市场),右列表作图例 ——
  function renderMcap(rows, g) {
    const box = document.getElementById('mcaps');
    if (!rows.length) { box.innerHTML = '<div class="h">市值结构</div><div style="color:var(--ink-2);font-size:12.5px;padding-bottom:8px">✗ CoinGecko 市值数据不可用</div>'; return; }
    const total = g ? p2(g.totalUsd) : null; // totalUsd 缺失/非法 → null,走下方 '—' 兜底而非 NaN%
    const items = rows
      .filter(c => c.cap != null && Number.isFinite(+c.cap))
      .map(c => ({ sym: c.sym, cap: Number(c.cap), chg: p2(c.chgPct) }));
    const sum = items.reduce((a, x) => a + x.cap, 0);
    const otherCap = total != null ? Math.max(0, total - sum) : null;
    const head = '<div class="h">市值结构(占比=市值/全市场)</div>';

    // 无 ECharts 或全市场缺失时:退回条形占比列表(占比不可算则显示 —)
    if (!window.echarts || total == null) {
      const list = items.concat(otherCap != null ? [{ sym: '其他', cap: otherCap, chg: null, isOther: true }] : []);
      box.innerHTML = head + '<div class="mcap-list">' + list.map(x => {
        const p = total ? (x.cap / total) * 100 : null;
        return `<div class="mcap-row"><span class="dot" style="background:${x.isOther ? MCAP_C.OTHER : MCAP_C[x.sym] || '#4f8cff'}"></span><span class="sym">${x.sym}</span><span class="pct">${p != null ? p.toFixed(1) + '%' : '—'}</span><div class="barx"><i style="width:${p != null ? Math.max(1, Math.min(100, p)) : 0}%"></i></div><span class="cap">${fmtUsdShort(x.cap)}</span></div>`;
      }).join('') + '</div>';
      return;
    }
    const other = { sym: '其他', cap: otherCap ?? 0, chg: null, isOther: true };
    const donut = items.concat([other]).map(x => ({
      name: x.sym, value: x.cap,
      itemStyle: { color: x.isOther ? MCAP_C.OTHER : MCAP_C[x.sym] || '#4f8cff' },
    }));
    const rowsHtml = items.concat([other]).map(x => {
      const p = (x.cap / total) * 100;
      const cls = x.chg == null ? '' : (x.chg >= 0 ? 'pos' : 'neg');
      const sign = x.chg != null ? (x.chg > 0 ? '+' : '') + x.chg.toFixed(2) + '%' : '—';
      return `<div class="mcap-row"><span class="dot" style="background:${x.isOther ? MCAP_C.OTHER : MCAP_C[x.sym] || '#4f8cff'}"></span><span class="sym">${x.sym}</span><span class="pct">${p.toFixed(1)}%</span><span class="cap">${fmtUsdShort(x.cap)}</span><span class="chg ${cls}">${x.chg == null ? '—' : sign}</span></div>`;
    }).join('');
    box.innerHTML = head + '<div class="mcapgrid"><div class="pie" id="mcap-pie"></div><div class="mcap-list">' + rowsHtml + '</div></div>';
    if (!window.echarts) return;
    const chart = chartOf(document.getElementById('mcap-pie'));
    chart.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', backgroundColor: '#171e28', borderColor: '#263140', borderWidth: 1, textStyle: { color: '#e6edf3', fontFamily: CM, fontSize: 12 }, formatter: p => `${p.name} · ${fmtUsdShort(p.value)}<br/>占全市场 ${p.percent}%` },
      series: [{
        type: 'pie', radius: ['58%', '80%'], center: ['50%', '50%'],
        itemStyle: { borderColor: '#0b1220', borderWidth: 1 },
        label: { show: false }, labelLine: { show: false },
        emphasis: { label: { show: true, fontSize: 12, color: '#e6edf3', formatter: '{b} {d}%' } },
        data: donut,
      }],
    });
  }

  // —— 恐慌贪婪:近30天折线 ——
  function renderFng(f) {
    const area = document.getElementById('fng');
    const nowEl = document.getElementById('fng-now');
    const arr = (f && f.ok && f.data || []).filter(d => d && Number.isFinite(+d.ts) && Number.isFinite(+d.value)).sort((a, b) => +a.ts - +b.ts);
    if (!arr.length) { nowEl.innerHTML = '<span style="color:var(--down)">✗ 恐慌贪婪数据不可用</span>'; return; }
    const pts = arr.map(d => [+d.ts * 1000, +d.value]);
    const last = pts[pts.length - 1];
    const cur = last[1];
    if (!window.echarts) {
      nowEl.innerHTML = `<span style="font:600 36px/1 var(--mono);color:${fngColor(cur)}">${cur}</span> <span style="color:${fngColor(cur)};font-weight:600">${fngLabel(cur)}</span>`;
      return;
    }
    const chart = chartOf(area);
    chart.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', backgroundColor: '#171e28', borderColor: '#263140', borderWidth: 1, textStyle: { color: '#e6edf3', fontFamily: CM, fontSize: 11 } },
      grid: { left: 32, right: 12, top: 16, bottom: 24 },
      xAxis: { type: 'time', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#8b98a5', fontFamily: CM, fontSize: 10, formatter: v => fmtTs(v).slice(0, 5) }, splitLine: { show: false } },
      yAxis: { type: 'value', min: 0, max: 100, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#8b98a5', fontFamily: CM, fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,.06)', type: 'dashed' } } },
      series: [{
        name: '指数', type: 'line', showSymbol: false, smooth: true,
        lineStyle: { width: 2, color: '#f0b90b' }, itemStyle: { color: '#f0b90b' },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#f0b90b2e' }, { offset: 1, color: '#f0b90b00' }] } },
        data: pts,
        markPoint: { symbolSize: 34, itemStyle: { color: '#f0b90b' }, label: { color: '#0b1220', fontFamily: CM, fontSize: 10, formatter: () => Math.round(cur) }, data: [{ coord: last }] },
      }],
    });
    nowEl.innerHTML = `当前 ${Math.round(cur)} · <span style="color:${fngColor(cur)};font-weight:600">${fngLabel(cur)}</span><span style="opacity:.6">(恐惧&lt;50 / 贪婪≥50)</span>`;
  }

  // —— 资金费率折线:币安/欧易/Bitget/Bybit 每所一线(8h 结算历史;Bitget 仅当前点)——
  async function loadFunding() {
    let s = {};
    try {
      const r = await fetch(`/api/crypto/funding/history?coin=${encodeURIComponent(fundCoin)}`).then(x => x.json());
      s = (r && r.data && r.data.series) || {};
    } catch { /* 下面按空处理 */ }
    document.getElementById('src-funding').innerHTML = srcBadges({
      '币安': s.binance, '欧易': s.okx, 'Bitget': s.bitget, 'Bybit': s.bybit,
    });
    // 记录各所当前档费率(风险监控用):service 返回升序,末位即最新;Bitget 为当前单点
    fundNow = [];
    for (const k of ['binance', 'okx', 'bitget', 'bybit']) {
      const d = s[k] && s[k].ok ? s[k].data || [] : [];
      if (d.length) fundNow.push({ ex: EX_LABEL[k], r: Number(d[d.length - 1].r) });
    }
    drawFundingChart(s);
    const anyOk = ['binance', 'okx', 'bitget', 'bybit'].some(k => s[k] && s[k].ok);
    document.getElementById('funding-note').textContent = anyOk
      ? `折线 = 各所每 8h 结算的历史费率(×100 为 %,正值=多头付费)。币安/欧易/Bybit 为该档实际结算值;Bitget 无公开历史接口,仅以 ◆ 标注当前费率。临近结算各所趋同。`
      : '';
  }
  function drawFundingChart(s) {
    const el = document.getElementById('funding');
    if (!window.echarts) {
      el.innerHTML = '<div style="padding:16px 4px;color:var(--ink-2);font-size:12.5px">ECharts 未加载(需外网 CDN)</div>';
      return;
    }
    const H8 = 8 * 3600e3;
    const series = [];
    for (const k of ['binance', 'okx', 'bitget', 'bybit']) {
      const d = s[k] && s[k].ok ? s[k].data || [] : [];
      if (!d.length) continue;
      // 结算时刻对齐到 8h 边界(各所差几毫秒),同档去重保最新
      const byT = new Map();
      for (const p of d) {
        const t = p.t - (p.t % H8);
        byT.set(t, Number(p.r) * 100);
      }
      const data = [...byT.entries()].filter(x => isFinite(x[1]));
      if (!data.length) continue;
      const isBitget = k === 'bitget';
      series.push({
        name: EX_LABEL[k] + (isBitget ? '(当前)' : ''),
        type: 'line', connectNulls: true,
        showSymbol: data.length <= 1 || isBitget,
        symbol: isBitget ? 'diamond' : 'circle', symbolSize: isBitget ? 6 : 4,
        lineStyle: { width: isBitget ? 1.5 : 2, color: EX_COLORS[k], type: isBitget ? 'dashed' : 'solid' },
        itemStyle: { color: EX_COLORS[k] },
        data,
      });
    }
    if (!series.length) {
      el.innerHTML = '<div style="padding:18px;color:var(--down);font-size:13px">✗ 资金费率不可达(合约域大陆网络常需代理,属预期内)</div>';
      return;
    }
    const chart = chartOf(el);
    chart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis', backgroundColor: '#171e28', borderColor: '#263140', borderWidth: 1,
        textStyle: { color: '#e6edf3', fontFamily: CM, fontSize: 11 },
        formatter: ps => {
          const head = fmtTs(ps[0].value[0]);
          return ps.map(p => `${p.marker}${p.seriesName}: <b>${p.value[1].toFixed(4)}%</b>`).join('<br/>') + (ps.length ? `<br/><span style="color:#8b98a5">${head}</span>` : '');
        },
      },
      legend: { top: 0, icon: 'round', itemWidth: 9, itemHeight: 9, itemGap: 14, textStyle: { color: '#8b98a5', fontSize: 12 } },
      grid: { left: 64, right: 20, top: 30, bottom: 24 },
      xAxis: {
        type: 'time', axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: '#8b98a5', fontFamily: CM, fontSize: 11, formatter: v => fmtTs(v).slice(0, 5) },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value', scale: true, axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: '#8b98a5', fontFamily: CM, fontSize: 11, formatter: v => `${Number(v).toFixed(4)}%` },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,.07)', type: 'dashed' } },
      },
      series,
    });
  }
  function renderPills() {
    const el = document.getElementById('funding-pills');
    el.innerHTML = '<span>币种</span>' + ['BTC', 'ETH', 'BNB'].map(c => `<button class="${c === fundCoin ? 'on' : ''}" data-c="${c}">${c}</button>`).join('');
    el.querySelectorAll('button').forEach(b => { b.onclick = () => { fundCoin = b.dataset.c; renderPills(); loadFunding(); }; });
  }

  // —— 未平仓合约 OI 折线:币安/欧易/Bybit 每所一线(USDT 名义额)+ 合计灰虚线 ——
  // OKB 币安无永续(实测 -1121),该线自然缺;BGB 仅 Bitget 本所有交易、Bitget 无免费 OI 历史接口 → 不入本图,pill 不放
  async function loadOi() {
    let s = {};
    try {
      const r = await fetch(`/api/crypto/oi/history?coin=${encodeURIComponent(oiCoin)}&r=${oiRange}`).then(x => x.json());
      s = (r && r.data && r.data.series) || {};
    } catch { /* 下面按空处理 */ }
    document.getElementById('src-oi').innerHTML = srcBadges({
      '币安': s.binance, '欧易': s.okx, 'Bybit': s.bybit,
    });
    drawOiChart(s);
    const anyOk = ['binance', 'okx', 'bybit'].some(k => s[k] && s[k].ok);
    document.getElementById('oi-note').textContent = anyOk
      ? `折线 = 币安/欧易/Bybit USDT 本位永续的持仓名义额(USDT)。币安、欧易为交易所公布的 USD 口径;Bybit 只公布币数,按当前标记价折算(历史点为近似)。灰虚线合计 = 该时刻可达所之和(不足三所时 tooltip 标注)。1d/7d 为 1h 档、30d 为 4h 档;OKB 币安无永续,缺一属预期;BGB 仅 Bitget 本所交易且无免费历史接口,不入图。`
      : '';
  }
  function drawOiChart(s) {
    const el = document.getElementById('oi');
    if (!window.echarts) {
      el.innerHTML = '<div style="padding:16px 4px;color:var(--ink-2);font-size:12.5px">ECharts 未加载(需外网 CDN)</div>';
      return;
    }
    const rows = oiMerge(s, oiRange === '30d' ? 4 * 3600e3 : 3600e3);
    const mk = (name, key, dash, w) => ({
      name, type: 'line', connectNulls: true, showSymbol: false,
      lineStyle: { width: w || 2, color: EX_COLORS[key] || '#8b98a5', type: dash ? 'dashed' : 'solid' },
      itemStyle: { color: EX_COLORS[key] || '#8b98a5' },
      data: rows.filter(r => r[key] != null).map(r => [r.t, r[key]]),
    });
    const series = ['binance', 'okx', 'bybit'].map(k => mk(EX_LABEL[k], k)).filter(x => x.data.length);
    if (rows.some(r => r.total != null)) series.push(mk('合计', 'total', true, 2.4));
    if (!series.length) {
      el.innerHTML = '<div style="padding:18px;color:var(--down);font-size:13px">✗ OI 数据不可达(币安合约域大陆网络常需代理,属预期内)</div>';
      return;
    }
    const NM = new Map(rows.map(r => [r.t, r.n]));
    const chart = chartOf(el);
    chart.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis', backgroundColor: '#171e28', borderColor: '#263140', borderWidth: 1,
        textStyle: { color: '#e6edf3', fontFamily: CM, fontSize: 11 },
        formatter: ps => {
          const n = NM.get(ps[0].value[0]);
          return ps.map(p => `${p.marker}${p.seriesName}${p.seriesName === '合计' && n < 3 ? `(${n}所)` : ''}: <b>${fmtUsdShort(p.value[1])}</b>`).join('<br/>') + (ps.length ? `<br/><span style="color:#8b98a5">${fmtTs(ps[0].value[0])}</span>` : '');
        },
      },
      legend: { top: 0, icon: 'round', itemWidth: 9, itemHeight: 9, itemGap: 14, textStyle: { color: '#8b98a5', fontSize: 12 } },
      grid: { left: 64, right: 20, top: 30, bottom: 24 },
      xAxis: {
        type: 'time', axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: '#8b98a5', fontFamily: CM, fontSize: 11, formatter: v => fmtTs(v).slice(0, 5) },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value', scale: true, axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: '#8b98a5', fontFamily: CM, fontSize: 11, formatter: v => fmtUsdShort(v) },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,.07)', type: 'dashed' } },
      },
      series,
    });
  }
  function renderOiPills() {
    const el = document.getElementById('oi-pills');
    el.innerHTML = '<span>币种</span>' + ['BTC', 'ETH', 'SOL', 'BNB', 'OKB'].map(c => `<button class="${c === oiCoin ? 'on' : ''}" data-c="${c}">${c}</button>`).join('') +
      '<span>区间</span>' + [['24H', '1d'], ['7D', '7d'], ['30D', '30d']].map(x => `<button class="${x[1] === oiRange ? 'on' : ''}" data-r="${x[1]}">${x[0]}</button>`).join('');
    el.querySelectorAll('button').forEach(b => { b.onclick = () => { if (b.dataset.c) oiCoin = b.dataset.c; else oiRange = b.dataset.r; renderOiPills(); loadOi(); }; });
  }

  // —— 相关新闻:标题已译简体;snippet 保留原文摘要 ——
  // 2026-09-20 用户要求按「时间线+重要程度」编排(共用 .tl 样式在 theme.css,抄首页事件雷达):
  // 最新在前、按日分组挂日期头,节点空心刻度 = cryptoNewsHeat 级别
  function renderNews(r) {
    const src = document.getElementById('src-news');
    const box = document.getElementById('news');
    if (!r || !r.ok || !(r.data && r.data.length)) {
      src.innerHTML = srcBadges({ 'Cointelegraph 资讯': r || { ok: false, error: '接口不可达' } });
      box.innerHTML = '<div style="color:var(--down);font-size:13px;padding:10px 0">✗ 资讯暂不可用(该源为海外 RSS,需走代理,失败属预期内,刷新可重试)</div>';
      return;
    }
    src.innerHTML = srcBadges({ 'Cointelegraph 资讯': { ok: true }, '标题转简体': { ok: true } });
    const pad = n => String(n).padStart(2, '0');
    const dk = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const now = new Date(), today = dk(now), yest = dk(new Date(+now - 864e5));
    const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const rows = r.data.slice().sort((a, b) => (+b.ts || 0) - (+a.ts || 0)).slice(0, 12);
    let lastDay = '';
    box.innerHTML = `<div class="tlkey"><span class="k-hi"><i></i>主流币 / 监管 / 安全事件</span><span class="k-mid"><i></i>交易所 / 代币 / 宏观数据</span><span class="k-lo"><i></i>其他</span></div><div class="tl">` + rows.map(it => {
      const d = it.ts ? dk(new Date(+it.ts)) : '';
      let hd = '';
      if (d && d !== lastDay) {
        lastDay = d;
        hd = `<div class="tlday"><b>${esc(d.slice(5))}</b><span>${d === today ? ' · 今天' : d === yest ? ' · 昨天' : ''}</span><i>${WD[new Date(d + 'T00:00:00').getDay()]}</i></div>`;
      }
      return hd + `<div class="tlr ${cryptoNewsHeat(it.title)}"><span class="tdot"></span><div class="tlb">
        <a class="tt" href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a>
        ${it.snippet ? `<div class="ds">${esc(it.snippet)}</div>` : ''}
        <div class="mt"><span class="hm">${fmtTs(it.ts)}</span></div></div></div>`;
    }).join('') + '</div>';
  }

  // —— 宏观驱动清单:全部数字来自本页其余接口(不加新上游),给"为什么涨跌"一个资金面清单 ——
  function renderMacro(rows, g, fng, ef) {
    const box = document.getElementById('macro');
    const pct = v => (v == null || !Number.isFinite(+v)) ? '—' : ((+v > 0 ? '+' : '') + (+v).toFixed(2) + '%');
    const row = (k, vHtml, s) => `<div class="mr"><div class="k">${k}<span class="s">${s || ''}</span></div><div class="v">${vHtml}</div></div>`;
    const c = [];
    const fl = o => o && o.latest
      ? `<span style="color:${flowColor(o.latest.flow)}">${fmtYi(o.latest.flow)}</span>`
      : '<span style="color:var(--ink-2)">—</span>';
    if (ef) {
      c.push(row('BTC ETF 昨日净流', fl(ef.btc), '机构现货·延后1日'));
      c.push(row('ETH ETF 昨日净流', fl(ef.eth), '机构现货·延后1日'));
    }
    if (g && g.totalUsd != null) {
      c.push(row('全市场市值', `${fmtUsdShort(g.totalUsd)}`, '加密总盘子'));
      if (Number.isFinite(+g.mcapChgPct))
        c.push(row('市值 24h', `<span style="color:${g.mcapChgPct >= 0 ? 'var(--up)' : 'var(--down)'}">${pct(g.mcapChgPct)}</span>`, '整体风险偏好方向'));
      if (Number.isFinite(+g.btcPct))
        c.push(row('BTC 主导地位', `${Number(g.btcPct).toFixed(1)}%`, 'btc 强弱 vs alt'));
    }
    const sorted = (rows || []).filter(r => r.chgPct != null && Number.isFinite(+r.chgPct)).slice().sort((a, b) => b.chgPct - a.chgPct);
    if (sorted.length) {
      const top = sorted[0], bot = sorted[sorted.length - 1];
      if (top.chgPct > 0.5) c.push(row('领涨主流', `<span style="color:var(--up)">${esc(top.sym)} ${pct(top.chgPct)}</span>`, '今日五币里最强'));
      if (bot.chgPct < -0.5) c.push(row('领跌主流', `<span style="color:var(--down)">${esc(bot.sym)} ${pct(bot.chgPct)}</span>`, '今日五币里最弱'));
    }
    const farr = (fng && fng.ok && fng.data || []).filter(d => d && Number.isFinite(+d.ts) && Number.isFinite(+d.value)).sort((a, b) => +a.ts - +b.ts);
    if (farr.length) {
      const v = +farr[farr.length - 1].value;
      c.push(row('恐慌贪婪', `<span style="color:${fngColor(v)}">${Math.round(v)} · ${fngLabel(v)}</span>`, '市场情绪刻度'));
    }
    box.innerHTML = c.length ? c.join('') : '<div style="color:var(--ink-2);font-size:12px">宏观读数暂缺</div>';
  }

  // —— 链上数据:稳定币弹药 + BTC 实时手续费 ——
  function renderChain(ch) {
    const src = document.getElementById('src-chain');
    const box = document.getElementById('chain');
    const st = ch && ch.stable, mp = ch && ch.mempool;
    src.innerHTML = st || mp
      ? srcBadges({ 'DefiLlama 稳定币': st, 'mempool.space': mp })
      : srcBadges({ '链上数据': { ok: false, error: '接口不可达' } });
    if (!st || !st.ok) {
      box.innerHTML = '<div style="color:var(--down);font-size:13px">✗ 链上数据不可用</div>';
      return;
    }
    const d = st.data;
    const dl = v => `<b style="color:${v >= 0 ? 'var(--up)' : 'var(--down)'}">${fmtSignedUsd(v)}</b>`;
    const mpTxt = mp && mp.ok ? ` · <b>BTC 实时费</b> ${sat(mp.data.fast)} sat/vB` : '';
    const rows = (d.rows || []);
    const maxCap = Math.max(...rows.map(r => r.cap), 1);
    box.innerHTML =
      `<div class="mk">稳定币总供给(场外弹药)</div>
       <div class="st-num">${fmtUsdShort(d.total)}</div>
       <div class="st-deltas">24h ${dl(d.day)} · 7d ${dl(d.week)}${mpTxt}</div>
       <div class="st-rows">${rows.map(r => `<div class="str"><span class="sym">${esc(r.sym)}</span><div class="bar"><i style="width:${Math.max(1, (r.cap / maxCap) * 100).toFixed(1)}%"></i></div><span class="amt">${fmtUsdShort(r.cap)}</span><span class="d" style="color:${r.day >= 0 ? 'var(--up)' : 'var(--down)'}">${fmtSignedUsd(r.day)}</span></div>`).join('')}</div>
       <div class="mp"><b>口径:</b> 供给净增 = 场外买力增加,净减 = 资金离场;真实交易所净流/巨鲸需付费源,此为免 key 近似。${
         mp && mp.ok ? `<b>BTC 手续费档:</b> 极速 ${sat(mp.data.fast)} · 普通 ${sat(mp.data.econ)} sat/vB,高 = 链上拥堵/波动放大` : ''}</div>`;
  }

  // —— 合约挂单(照 2026-09-20 用户参考图):左=逐币买/卖挂单分布表,右=合计挂单统计卡 ——
  // 参考图的「24h变化」无历史台账不做,该列如实标「买盘占比」;现货挂单/大单成交两 tab 无数据源,不装。
  function renderBook(rows) {
    const src = document.getElementById('src-book');
    const box = document.getElementById('book');
    if (!Array.isArray(rows) || !rows.length) {
      src.innerHTML = srcBadges({ '合约挂单': { ok: false, error: '接口不可达' } });
      box.innerHTML = '<div style="color:var(--down);font-size:13px">✗ 合约挂单暂不可用(fapi 大陆需代理),60s 后自动重试</div>';
      return;
    }
    src.innerHTML = srcBadges(Object.fromEntries(rows.map(r => [r.sym, r.ok ? { ok: true } : r])));
    // 同名币色块与本页「市值结构」图例(MCAP_C)同值,两板块观感一致(2026-09-20 用户抓包「透明度不一样」=灰调发暗,非真有 alpha)
    const BRAND = { BTC: '#f7931a', ETH: '#627eea', SOL: '#2dd4bf', BNB: '#f0b90b', XRP: '#7a8fa6', DOGE: '#c2a633' };
    const f0 = v => (v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : (v / 1e6).toFixed(1) + 'M');
    const ok = rows.filter(r => r.ok);
    const maxTot = Math.max(...ok.map(r => r.data.bidUsd + r.data.askUsd), 1);
    const bidSum = ok.reduce((t, r) => t + r.data.bidUsd, 0), askSum = ok.reduce((t, r) => t + r.data.askUsd, 0);
    const bp = bidSum + askSum ? (bidSum / (bidSum + askSum)) * 100 : 0;
    const hot = ok.filter(r => r.data.bidPct >= 55).map(r => r.sym);
    const tr = rows.map(r => {
      const n = `<span class="nm"><span class="bkg" style="--c:${BRAND[r.sym] || '#4b5a6e'}">${esc(r.sym[0])}</span>${esc(r.sym)}${r.ok && r.data.bidPct >= 55 ? '🔥' : ''}</span>`;
      if (!r.ok) return `<div class="bkrow">${n}<span style="color:var(--down);font-size:11px">✗ ${esc((r.error || '不可用').slice(0, 40))}</span><span></span><span></span></div>`;
      const v = r.data, fill = ((v.bidUsd + v.askUsd) / maxTot) * 100, p = v.bidPct;
      return `<div class="bkrow" title="${r.sym}USDT 永续千档:中间价 ${v.px >= 100 ? v.px.toFixed(0) : v.px.toFixed(2)} · 一档价差 ${v.spreadBp.toFixed(2)}bp · 买盘占比 ${p.toFixed(1)}%">
        ${n}
        <div class="bkbar" style="width:${fill.toFixed(1)}%"><i class="g" style="width:${p}%"></i><i class="r" style="width:${100 - p}%"></i></div>
        <span class="bkamt">买 ${f0(v.bidUsd)}<em>/</em>卖 ${f0(v.askUsd)}</span>
        <span class="bkpct" style="color:${p >= 50 ? 'var(--up)' : 'var(--down)'}">${p.toFixed(1)}% ${p >= 50 ? '▲' : '▼'}</span></div>`;
    }).join('');
    box.innerHTML = `<div class="bkwrap">
      <div class="bkt"><div class="bkrow bkrh"><span>交易对</span><span>挂单分布 绿=买 红=卖(USDT)</span><span>买/卖金额</span><span style="text-align:right">买盘占比</span></div>${tr}</div>
      <div class="bkc"><h3>📊 合计挂单统计</h3>
        <div class="bkdonut" style="background:conic-gradient(var(--up) 0 ${bp.toFixed(1)}%, var(--down) ${bp.toFixed(1)}% 100%)">
          <s><i>总挂单金额</i><b>$${(bidSum + askSum).toLocaleString('en-US', { maximumFractionDigits: 0 })}</b><i>USDT</i></s></div>
        <div class="bkleg"><span style="color:var(--up)">●</span> <b>买单(多)</b> $${Math.round(bidSum).toLocaleString('en-US')} &nbsp;${bp.toFixed(1)}%<br><span style="color:var(--down)">●</span> <b>卖单(空)</b> $${Math.round(askSum).toLocaleString('en-US')} &nbsp;${(100 - bp).toFixed(1)}%</div>
        <div class="mk" style="margin-top:10px">多空比(挂单金额)</div>
        <div class="bkls"><i style="width:${bp}%;background:var(--up)"></i><i style="width:${100 - bp}%;background:var(--down)"></i></div>
        <div style="display:flex;justify-content:space-between;font:600 11px/1 var(--mono)"><span style="color:var(--up)">多 ${bp.toFixed(1)}%</span><span style="color:var(--down)">空 ${(100 - bp).toFixed(1)}%</span></div>
        <div class="bkbox">💡 <b>重点关注</b><br>${hot.length ? `${esc(hot.join('、'))} 买盘占比 ≥55%,盘口承接偏多。` : '暂无买盘占比 ≥55% 的币种,挂单均衡。'}<br><span style="color:var(--ink-2)">挂单可撤,不代表必然承接,不构成投资建议。</span></div>
      </div></div>
      <div class="mp" style="margin-top:8px"><b>口径:</b> 币安 USDT 本位永续 ≤1000 档挂单名义合计(USDT≈USD),60s 快照;条长按六币合计金额等比,<b>🔥</b>=买盘占比≥55%;参考图「24h变化」需逐日台账(本机尚无)故改为当下买盘占比,现货挂单/大单成交两视图无免费源未做。</div>`;
  }

  // —— 风险监控:规则判定结果渲染成红/黄/绿卡片 ——
  function renderRisk(items) {
    const box = document.getElementById('risk');
    box.innerHTML = (items || []).map(it => {
      const [tag, col] = RISK_TAG[it.lvl] || RISK_TAG.ok;
      return `<div class="rk"><span class="tag" style="color:${col};background:${col}22">${tag}</span><div><div class="nm">${it.name}</div><div class="vl" style="color:${it.lvl === 'ok' ? 'var(--ink-2)' : col}">${it.val}</div><div class="ht">${it.hint}</div></div></div>`;
    }).join('');
  }

  // SWR(nav.js v2):后台重取成功 → apifresh → 自动重渲替换;手动刷新置 __apibust 无视本地缓存直连
  document.getElementById('refresh').onclick = () => { window.__apibust = Date.now(); loadAndRender(); };
  window.addEventListener('apifresh', loadAndRender);
  renderPills(); // 币种切换条只建一次
  renderOiPills(); // OI 图币种/区间切换条同理
  loadAndRender(); // 同 stock.js:块内自调用
}

function selftest() {
  console.assert(fngLabel(24) === '极度恐惧' && fngLabel(25) === '恐惧', 'fng 24/25 边界');
  console.assert(fngLabel(49) === '恐惧' && fngLabel(50) === '贪婪', 'fng 49/50 边界');
  console.assert(fngLabel(74) === '贪婪' && fngLabel(75) === '极度贪婪', 'fng 74/75 边界');
  console.assert(fmtUsdShort(1.234e12) === '$1.23T', '万亿');
  console.assert(fmtUsdShort(4.56e9) === '$4.56B', '十亿');
  console.assert(fmtUsdShort(7.8e6) === '$7.80M', '百万');
  console.assert(fmtUsdShort(999) === '$999' && fmtUsdShort(undefined) === '—', '小额/空值');
  console.assert(fmtTs('1756999200000').length === 11, '毫秒串→短格式');
  console.assert(fmtTs('2026-09-04 12:00:00') === '2026-09-04 12:00:00', '非 epoch 原样');
  console.assert(shortT('2026-09-04T10:00:00.000Z') === '2026-09-04', 'ISO 日期只留日期');
  console.assert(fmtYi(173000000) === '+1.73亿' && fmtYi(-48000000) === '-0.48亿' && fmtYi(0) === '+0.00亿', 'ETF 净流入格式');
  const b = srcBadges({ '币安现货': { ok: true }, '币安合约': { ok: false, error: '请求超时' } });
  console.assert(b.includes('✓ 币安现货') && b.includes('✗ 币安合约:请求超时'), '逐源中文状态条');
  const run = cumRun([{ date: 'a', btc: 1e8 }, { date: 'b', eth: 2e8 }, { date: 'c', btc: -5e7, eth: 1e8 }]);
  console.assert(run.btc.join() === '100000000,100000000,50000000', 'BTC 累计(缺日走平)');
  console.assert(run.eth.join() === '0,200000000,300000000', 'ETH 累计');
  console.assert(fmtSignedUsd(1.2e9) === '+$1.20B' && fmtSignedUsd(-3e6) === '−$3.00M' && fmtSignedUsd(0) === '+$0', '带符号美元简写');
  const hi = riskAssess({ rates: [{ ex: '币安', r: 0.0008 }], spot: [], fng: 90, mem: { fast: 3 } });
  console.assert(hi[0].lvl === 'hi' && hi[0].val.includes('币安'), '费率 0.08% → hi');
  console.assert(hi.some(x => x.name === '恐惧贪婪·情绪极端' && x.lvl === 'hi'), 'fng 90 → 贪婪 hi');
  console.assert(hi.some(x => x.name === 'BTC 链上转账拥堵' && x.lvl === 'ok'), 'fee 3 → ok');
  const nrm = riskAssess({ rates: [{ ex: '币安', r: 0.0001 }, { ex: '欧易', r: -0.00008 }], spot: [{ sym: 'ETH', chgPct: -2.1 }], fng: 52, mem: { fast: 2 } });
  console.assert(nrm.every(x => x.lvl === 'ok'), '常规数据全绿');
  const bear = riskAssess({ rates: [{ ex: '币安', r: -0.0007 }], spot: [], fng: 8, mem: { fast: 150 } });
  console.assert(bear[0].lvl === 'hi' && bear[0].hint.includes('轧空'), '负费率 → 轧空提示');
  console.assert(bear.some(x => x.lvl === 'hi' && x.name === 'BTC 链上转账拥堵'), 'fee 150 → 拥堵 hi');
  console.assert(cryptoNewsHeat('SEC 批准比特币现货 ETF 上市') === 'hi', '监管+BTC+ETF → hi');
  console.assert(cryptoNewsHeat('币安上线新交易对') === 'mid', '交易所类 → mid');
  console.assert(cryptoNewsHeat('') === '', '空标题不判级');
  console.assert(annHi('欧易关于上线 PONS/USDT (Pons Family) 现货交易的公告'), '新币上线 → 机会标');
  console.assert(annHi('币安 Alpha 交易大赛:交易瓜分高达400 BNB代币券'), '大赛瓜分 → 机会标');
  console.assert(annHi('持有 1 美元并赚取:3500 万 WLFI 奖励,年利率高达 8%'), '写明年化 → 机会标');
  console.assert(annHi('Bybit Odds:官方产品发布,总奖池17,000 USDT!'), '带数字奖池 → 机会标');
  console.assert(!annHi('每日一言:测试您对"控制 AI 代理"的了解,以解锁 USDC 奖励!'), '答题噱头不标');
  console.assert(!annHi('欧易简单赚币活期产品更新'), '产品更新不标');
  console.assert(!annHi('GetAgent 2.0 正式上线:一句话,问遍加密、美股与链上'), '产品上线≠新币上线,不标');
  console.assert(!annHi('系统维护公告'), '维护公告不标');
  {
    const H = 3600e3;
    const mg = oiMerge({
      binance: { ok: true, data: [{ t: 5 * H + 700, usd: 100 }, { t: 6 * H, usd: 120 }] },
      okx: { ok: true, data: [{ t: 5 * H + 900, usd: 40 }] },
      bybit: { ok: false, error: '超时' },
    }, H);
    console.assert(mg.length === 2 && mg[0].total === 140 && mg[0].n === 2, 'OI 合并:同桶对齐、两所求和、挂所不计');
    console.assert(mg[1].t === 6 * H && mg[1].total === 120 && mg[1].n === 1, 'OI 合并:单所桶也出合计(n=1 供 tooltip 标注)');
    console.assert(oiMerge({}, H).length === 0, 'OI 合并:全空回 []');
  }
  console.log('crypto.js selftest OK');
}
if (typeof require !== 'undefined' && require.main === module) selftest();
