/* 大A仪表盘前端:①市场概况 ②板块行情 ③今日机会·两派(价值/趋势) 基金观察(2026-09-22) ⑤重要资讯 ⑥市场异动(④市场资金已下线)。
   数据端点 /api/stock/{market,boards,opportunity,flow,news,value,trend,funds} 返回 {ok,data}|{ok:false,error},
   单源失败只红对应卡,永不白屏。纯函数(两派chips/温度/解析)在顶层,可 node public/stock.js 自检。
   A股配色:全站统一绿涨红跌;两派 chip 用蓝(达标)/灰(未达标/缺),不占红绿语义。 */

// ---------- 顶层纯函数(自检用) ----------

// 涨跌→类名(rn=涨 gn=跌,沿旧命名);颜色在 CSS 侧全站统一绿涨红跌
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

// ---------- ③ 今日机会 · 两派(v2):评分在服务端(mx.valueScore / market.trendScore),
// 这里只把原始指标拼成展示 chips。返回 [标签, 文本, ok|null]:ok=null 表示缺数据,渲染「—」不猜。 ----------

const nn = v => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);

// 价值派行(服务端 mx.valuePicks 形状:{code,name,ind,price,pct,pe,pb,dvd,roe,gross,dedtYoy,debt,hi52,score,dd,tech})
function valueChips(r) {
  const pe = nn(r.pe), pb = nn(r.pb), dvd = nn(r.dvd), roe = nn(r.roe);
  const gm = nn(r.gross), dy = nn(r.dedtYoy), db = nn(r.debt), dd = nn(r.dd);
  const t = r.tech, c20 = t ? nn(t.chg20) : null;
  return [
    ['质地', roe == null && gm == null ? null : `ROE ${roe == null ? '—' : roe.toFixed(0)}% · 毛利 ${gm == null ? '—' : gm.toFixed(0)}%`,
      (roe ?? 0) > 15 && (gm ?? 0) > 30],
    ['扣非同比', dy == null ? null : `${dy > 0 ? '+' : ''}${dy.toFixed(0)}%`, dy != null && dy > 0],
    ['PE', pe == null ? null : pe.toFixed(1), pe != null && pe > 0 && pe <= 20],
    ['PB', pb == null ? null : pb.toFixed(2), pb != null && pb > 0 && pb <= 3],
    ['股息率', dvd == null ? null : `${dvd.toFixed(1)}%`, dvd != null && dvd >= 3],
    ['高点回撤', dd == null ? null : `-${dd.toFixed(0)}%`, dd != null && dd >= 20],
    ['负债率', db == null ? null : `${db.toFixed(0)}%`, db != null && db < 50],
    // 企稳回升(2026-09-22 服务端硬门槛:站回MA20 且近20日上涨);tech 缺失=行情源兜底,不显示该 chip
    ['企稳回升', t && c20 != null ? `站MA20 · 20日 ${c20 > 0 ? '+' : ''}${c20.toFixed(0)}%` : null, !!t && !!t.aboveMa20 && c20 != null && c20 > 0],
  ].filter(x => x[1] != null);
}

// 趋势派行(服务端 trendPicks 形状:emStockRow + {tech:{maBull,aboveMa20,macdUp,rsi,vol5_60,chg20,newHigh60},sameInd,score})
function trendChips(r) {
  const t = r.tech || {}, turn = nn(r.turn), mn = nn(r.mainNet);
  const v = nn(t.vol5_60), rsi = nn(t.rsi), c20 = nn(t.chg20);
  return [
    ['MA多头', t.maBull ? '5>10>20>60↑' : '排列破坏', t.maBull],
    ['MACD', t.macdUp ? '零上/红柱' : '走弱', t.macdUp],
    ['60日新高', t.newHigh60 ? '✓' : '否', !!t.newHigh60],
    ['量5÷60', v == null ? null : `×${v.toFixed(2)}`, v != null && v > 1.5],
    ['RSI14', rsi == null ? null : rsi.toFixed(0), rsi != null && rsi >= 50 && rsi <= 70],
    ['20日', c20 == null ? null : `${c20 > 0 ? '+' : ''}${c20.toFixed(0)}%`, c20 != null && c20 >= 15],
    ['换手', turn == null ? null : `${turn.toFixed(1)}%`, turn != null && turn >= 5 && turn <= 15],
    ['主力净', mn == null ? null : fmtYi(mn), mn != null && mn >= 1e8],
    ...(r.sameInd >= 2 ? [['板块共振', `${r.sameInd}只同行业`, true]] : []),
  ].filter(x => x[1] != null);
}

// 基金观察行(服务端 stk:funds → {code,name,ex,day,dayDate,r1y,r3y,ln})。
// 第三列口径(2026-09-22 用户要求):有近3年→「近3年」;缺(成立不足3年)→「成立以来」;双缺→['成立以来',null] 显示 —
function fundThird(r) {
  const v = nn(r.r3y);
  return v != null ? ['近3年', v] : ['成立以来', nn(r.ln)];
}

// 基金归类 + 表显示顺序(2026-10-14 用户要求「按基金类型和内容排序」):按基金名称关键词判,
// fund_watch.json 无需新增字段、新加基金自动归位;显示序=核心宽基→行业进攻→红利攻守→海外分散→商品对冲→债券→未归类。
// 判定顺序特意「具体→宽泛」:创业板人工智能 先中 AI 不会被「创业板」判成宽基;纳指100 先中海外不会被「100」判成宽基
function fundCat(name) {
  const s = String(name || '');
  if (/黄金|原油|商品|有色/.test(s)) return '商品';
  if (/纳指|纳斯达克|标普|道指|美国|日经|德国|法国|恒生|港股|中概|亚太|QDII/.test(s)) return '海外';
  if (/红利|低波|股息|现金流/.test(s)) return '红利';
  if (/债|货币/.test(s)) return '债券';
  if (/半导体|芯片/.test(s)) return '半导体';
  if (/人工智能|机器人|算力|软件|游戏|\bAI\b/.test(s)) return 'AI';
  if (/沪深300|上证50|中证500|中证1000|中证2000|科创|创业板|深证100|A50|A100|A500/.test(s)) return '宽基';
  return '其他';
}
const FUND_ORDER = ['宽基', '半导体', 'AI', '红利', '海外', '商品', '债券', '其他'];

// 股票观察归类(2026-10-14 用户要求,排序逻辑与基金观察一致:类别→名称)。
// 类别优先取 data/stock_watch.json 可选 cat(白名单外落其他);省略时按名称关键词兜底
// (判定优先级:金融→医药→电力→科技→材料→地产→消费,与基金同类教训——先判专词防误伤)。
function stkCat(name, cat) {
  const c = String(cat || '');
  if (c) return STOCK_ORDER.indexOf(c) >= 0 ? c : '其他';
  const s = String(name || '');
  if (/银行|保险|证券|信托|租赁|金融/.test(s)) return '金融';
  if (/医|药|生物|基因/.test(s)) return '医药';
  if (/电力|电网|核电|水电|风电|光伏|绿电|燃气/.test(s)) return '电力';
  if (/石油|石化|海油|油气|煤矿?/.test(s)) return '能源';
  if (/建筑|核建|中建|中铁|工程局/.test(s)) return '建筑';
  if (/科技|电子|半导体|芯片|软件|计算机|通信|智能|数字|光电/.test(s)) return '科技';
  if (/铝|铜|锌|镍|锂|稀土|钢|有色|化工|材料|水泥|矿业/.test(s)) return '材料';
  if (/地产|房地产|置业/.test(s)) return '地产';
  if (/食品|乳|伊利|蒙牛|酒|饮|服装|服饰|鞋|旅游|文旅|酒店|零售|百货|家电|汽车|农业/.test(s)) return '消费';
  return '其他';
}
const STOCK_ORDER = ['金融', '电力', '能源', '建筑', '消费', '材料', '科技', '医药', '地产', '其他'];

// 板块按当日涨幅榜:n>0 取涨 Top n(涨幅降序);n<0 取跌 Top |n|(跌幅最大在前);涨幅缺失剔除。不改动原数组
function boardTop(rows, n = 5) {
  const s = (rows || []).filter(r => r && r.pct != null && Number.isFinite(+r.pct)).sort((a, b) => b.pct - a.pct);
  return n >= 0 ? s.slice(0, n) : s.slice(n).reverse();
}

// 沪市「连续 N 日净流入/流出」:日线序列(收盘口径)+ 今日盘中值(shLast,日线收盘后才含当日,不补就永远慢一天)
// 返回 {run 连续天数, sum 合计, sign} ;sign=0 表示无数据
function runDays(days, shLast) {
  const seq = (shLast && shLast.d ? (days || []).filter(x => x.t < shLast.d) : (days || [])).concat(shLast ? [shLast] : []);
  const sign = Math.sign(seq.length ? seq[seq.length - 1].main : 0);
  let run = 0, sum = 0;
  for (let i = seq.length - 1; i >= 0 && sign; i--) {
    if (Math.sign(seq[i].main) !== sign) break;
    run++; sum += seq[i].main;
  }
  return { run, sum, sign };
}

// 资讯重要度分级(2026-09-20 用户要求⑤按「时间线 + 重要程度」编排,节点色同首页事件雷达)。
// 只按标题/正文关键词判级别,不猜涨跌不给建议:'hi' 政策与盘面异动 → 'mid' 常规市场资讯 → '' 长文/公告。
function newsHeat(x) {
  const t = String((x && x.title) || '') + String((x && (x.summary || x.s)) || '');
  if (/央行|降准|降息|加息|国常会|国务院|证监会|政治局|印花税|汇金|平准|涨停|跌停|暴涨|暴跌|崩|黑天鹅|熔断|降准降息|利率|汇率|关税|关税豁免|财政|专项债|MLF|LPR/.test(t)) return 'hi';
  if (/行业|板块|公司|业绩|财报|回购|增持|减持|并购|重组|中标|产品|新势力|销量|指数|成交额|北向|主力|融资|ETF/.test(t)) return 'mid';
  return '';
}

// 板块回放时间注(2026-10-20 东财 502 调查后): boards 故障时回显最近一次成功数据,距今>10min 如实标采集时刻,宁缺勿假
function asOfNote(ts, pre) {
  if (!ts || Date.now() - ts <= 600e3) return '';
  const d = new Date(ts);
  const P = n => String(n).padStart(2, '0');
  return `<span style="color:#d29a3a;font-size:11px;margin-right:6px">${pre || '东财限流中 ·'} 板块截至 ${P(d.getMonth() + 1)}-${P(d.getDate())} ${P(d.getHours())}:${P(d.getMinutes())} 回放</span>`;
}

// A股/港股现价货币前缀(2026-10-28 持仓复盘并入统一表,从 holdings.js 搬来):腾讯 qt 原值本币——
// A股=人民币、港股=港币(市场名含「港」),复盘行现价不标单位会被当成美元
function stkCur(m) {
  return /港|hk/i.test(String(m || '')) ? 'HK$' : '¥';
}

// 统一表行合并(2026-10-28 用户把持仓复盘并入股票观察):watch 行为主、同码复盘行挂 r.hold(两清单实测仅3只重合);
// holding-only 行折算成 watch 行形(day=chgPct、cat:null 走 stkCat 名称兜底)按 code 去重追加在后。任一参数可为 null
function mergeRows(W, R) {
  const rows = (W || []).slice();
  const rmap = {};
  for (const a of R || []) rmap[a.code] = a;
  const seen = new Set();
  for (const r of rows) {
    const a = rmap[r.code];
    if (a) { r.hold = a; seen.add(r.code); }
  }
  for (const a of R || []) {
    if (seen.has(a.code)) continue;
    rows.push({ code: a.code, name: a.name, cat: null, price: a.price, day: a.chgPct, pe: a.pe, pb: a.pb, mcap: a.mcap ?? null, amt: a.amt ?? null, pc: a.pc, hold: a });
  }
  return rows;
}

// ---- 高阶表助手(2026-10-28 用户「不易读,用高阶表格来做」):排序/筛选/列基线/热底,纯函数进 node 自检 ----
const wCell = (r, k) =>
  k === 'name' || k === 'code' ? String(r[k] || '') :
    k === 'hold' ? (r.hold ? 1 : 0) :
      /^d(7|30|90|180|365)$/.test(k) ? ((r.pc || {})[k] ?? null) : r[k];
// 列排序:k='' 保持传入序(默认类别序);空值恒沉底(不随方向翻);同列再点靠 d 翻向
function sortRows(rows, k, d) {
  if (!k) return rows.slice();
  const bad = v => v == null || (typeof v === 'number' && !Number.isFinite(v));
  return rows.slice().sort((a, b) => {
    const va = wCell(a, k), vb = wCell(b, k);
    if (bad(va) && bad(vb)) return 0;
    if (bad(va)) return 1;
    if (bad(vb)) return -1;
    return (typeof va === 'string' ? String(va).localeCompare(String(vb), 'zh') : va - vb) * d;
  });
}
function filterRows(rows, f) {
  return f === 'hold' ? rows.filter(r => r.hold) : f === 'watch' ? rows.filter(r => !r.hold) : rows.slice();
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
  // 两派 chip:达标=本学派主色亮圆点(价值蓝/趋势金,由 .school CSS 变量给),
  // 未达=空心灰点;不用红绿,避免与涨跌语义打架。缺数据项上游已 filter 掉,不显示。
  const chipHtml = c => {
    const [lb, txt, ok] = c;
    return `<span class="chip${ok === true ? ' on' : ''}"><i></i>${esc(lb)} <b>${esc(String(txt))}</b></span>`;
  };

  let boardRows = []; // 板块全表,② 与 ③ 板块强势共用
  let REASONS = {}; // 板块涨跌原因:板块名 → 东财新闻检索最新命中 {title,date,url}(服务端10min缓存)
  let REASON_Q = false; // 同一批渲染只发一次原因请求
  let boardFail = false; // 东财板块拉取失败/等待态(② 净流入榜用)
  let indPct = new Map(); // 行业名 → 板块当日涨幅(机会标签)
  const mv = document.getElementById('moves-body');

  const NO_BOARD = '<div class="err">✗ 板块数据不可用(东财接口被限流时请稍后刷新)</div>';

  // ① 市场概况
  function renderMarket(d) {
    document.getElementById('src-mkt').innerHTML = srcBadges({
      '腾讯指数': d.qt, '东财涨跌家数': d.breadth, '东财涨跌停': d.limit,
    });
    const qs = (d.qt && d.qt.ok && d.qt.data) || [];
    // 大标题头右侧「行情时间 → 交易日 · 周X」(节假日无免费源,周末以外粗判为交易日)
    const t0 = (qs.find(r => r.ok && r.time) || {}).time;
    const meta = document.getElementById('mh-meta');
    if (meta) {
      if (t0) {
        const q = fmtQuoteTime(t0);
        const dt = new Date(q.replace(' ', 'T'));
        const wd = '日一二三四五六'[dt.getDay()];
        const open = dt.getDay() > 0 && dt.getDay() < 6;
        const hhmm = q.slice(11);
        meta.innerHTML = `<span class="dt">📅 ${esc(q)}</span><span class="arrow">→</span>`
          + `<span class="pill">${open ? '交易日' : '休市'} · 周${wd}</span>`
          + `<span>${open && hhmm > '15:00' ? '已收盘' : open && hhmm >= '09:30' ? '盘中' : ''}</span>`;
      } else {
        meta.textContent = '✗ 指数行情不可用';
      }
    }
    const cards = qs.filter(r => r.code !== 'sz399106');
    document.getElementById('idxrow').innerHTML = cards.map(r => {
      if (!r.ok) return `<div class="idx"><div class="nm">${esc(r.code)}</div><div class="dim small">✗ ${esc(r.error || '无行情')}</div></div>`;
      return `<div class="idx ${aCls(r.chg)}">
        <div class="nm"><span class="tx">${esc(r.name)}</span><span class="chip ${aCls(r.chgPct)}">${r.chgPct > 0 ? '+' : ''}${r.chgPct.toFixed(2)}%</span></div>
        <div class="pv ${aCls(r.chg)}">${f2(r.price)}</div>
        <div class="ch ${aCls(r.chg)}"><span>${r.chg > 0 ? '+' : ''}${r.chg.toFixed(2)}</span><span class="dim">较昨收</span></div>
        <div class="am">${fmtQuoteTime(r.time)}</div>
      </div>`;
    }).join('');

    const b = (d.breadth && d.breadth.ok && d.breadth.data) || null;
    const l = (d.limit && d.limit.ok && d.limit.data) || null;
    const shIdx = qs.find(r => r.code === 'sh000001');
    const szi = qs.find(r => r.code === 'sz399106');
    const tmp = marketTemp(shIdx && shIdx.ok ? shIdx.chgPct : null,
      b ? b.ratio : null, l ? l.zt : null, l ? l.dt : null);
    // 读数卡:大数字 + 占比条(参照「市场观察」KPI 风格)
    const upN = b ? numOrNull(b.up) : null, dnN = b ? numOrNull(b.down) : null, flN = b ? numOrNull(b.flat) : null;
    const totN = [upN, dnN, flN].every(v => v != null) ? upN + dnN + flN : 0;
    const upPct = totN ? upN / totN * 100 : null;
    const zt = l ? numOrNull(l.zt) : null, dt = l ? numOrNull(l.dt) : null;
    const ztPct = (zt != null && dt != null && zt + dt) ? zt / (zt + dt) * 100 : null;
    const yi = w => numOrNull(w) == null ? null : numOrNull(w) / 10000; // 万元 → 亿元
    const shYi = (shIdx && shIdx.ok) ? yi(shIdx.amountWan) : null;
    const szYi = (szi && szi.ok) ? yi(szi.amountWan) : null;
    const amtTot = (shYi != null && szYi != null) ? shYi + szYi : null;
    const yiTxt = v => v == null ? '—' : Math.round(v).toLocaleString('zh-CN') + '亿';
    const bar = segs => `<span class="bar">${segs.filter(s => s && s.w > 0).map(s =>
      `<b style="width:${Math.min(100, s.w).toFixed(1)}%;background:${s.c}"></b>`).join('')}</span>`;
    document.getElementById('mktstrip').innerHTML =
      `<div class="ms"><span class="k">涨跌家数</span>
        <span class="v">${upN == null ? '<span class="dim">—</span>' : `<span class="rn">${grp(upN)}</span><i>:</i><span class="gn">${grp(dnN)}</span>`}</span>
        <span class="sub">上涨占比 ${upPct == null ? '—' : upPct.toFixed(1) + '%'} · 平盘 ${flN == null ? '—' : grp(flN)}</span>
        ${bar(upPct == null ? [] : [{ w: upPct, c: 'var(--down)' }, { w: 100 - upPct, c: 'var(--up)' }])}</div>` +
      `<div class="ms"><span class="k">两市成交额</span><span class="v">${amtTot == null ? '<span class="dim">—</span>' : (amtTot >= 10000 ? (amtTot / 10000).toFixed(2) + '万亿' : yiTxt(amtTot))}</span>
        <span class="sub">沪 ${yiTxt(shYi)} · 深 ${yiTxt(szYi)}</span>
        ${bar(amtTot ? [{ w: shYi / amtTot * 100, c: 'var(--asset)' }, { w: szYi / amtTot * 100, c: '#7a8ea6' }] : [])}</div>` +
      `<div class="ms"><span class="k">涨停 / 跌停</span>
        <span class="v">${zt == null ? '<span class="dim">—</span>' : `<span class="rn">${grp(zt)}</span><i>/</i><span class="gn">${grp(dt)}</span>`}</span>
        <span class="sub">涨停占比 ${ztPct == null ? '—' : ztPct.toFixed(0) + '%'}</span>
        ${bar(ztPct == null ? [] : [{ w: ztPct, c: 'var(--down)' }, { w: 100 - ztPct, c: 'var(--up)' }])}</div>` +
      `<div class="ms"><span class="k">市场温度</span>
        <span class="v">${tmp ? `<span class="${tmp.cls}">${tmp.label}</span><i>·</i>${tmp.score}` : '<span class="dim">—</span>'}</span>
        <span class="sub">权重 指数40 家数40 停板20</span>
        <span class="bar grad">${tmp ? `<b style="width:${Math.max(0, 100 - tmp.score).toFixed(0)}%"></b>` : ''}</span></div>`;
  }

  // ② 资金流向趋势:近 7 个交易日主力净额条形图(当日按整点累计、历史按日;红=净流入、绿=净流出,0 轴居中)
  // 台账机制:东财时通时断,有多少画多少;有 hours 的日子画整点累计条,否则单根日线;全空也不留白,给等待提示
  // 合并双轴图:主力净额(左轴,0 轴居中,流入红/流出绿+面积)+ 沪/深成交额(右轴,各自 min-max 自适应),共用横轴日期
  const comboSvg = (dates, mainV, shV, szV) => {
    const W = 1000, H = 220, P = 10;
    const n = dates.length;
    const x = i => P + i * (W - 2 * P) / Math.max(1, n - 1);
    const mv = mainV.filter(v => v != null);
    const mx = Math.max(1, ...mv.map(Math.abs));
    const ym = v => H / 2 - (v / mx) * (H / 2 - P);
    const av = [...shV, ...szV].filter(v => v != null);
    const lo = av.length ? Math.min(...av) : 0, hi = av.length ? Math.max(...av) : 1, span = hi - lo || 1;
    const ya = v => H - P - ((v - lo) / span) * (H - 2 * P);
    const line = (vals, y) => { let d = '', pen = false; vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; pen = true; }); return d.trim(); };
    const last = mv.length ? (mainV[n - 1] != null ? mainV[n - 1] : mv[mv.length - 1]) : 0;
    const zero = ym(0).toFixed(1), col = last >= 0 ? '#58d68d' : '#ff6b6b'; // 全站统一:正=绿 负=红
    const md = line(mainV, ym);
    const dots = (vals, y, color, tip) => vals.map((v, i) => v == null ? '' :
      `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4.5" fill="${color}"><title>${esc(dates[i])} ${tip(v)}</title></circle>`).join('');
    return `<svg class="fsvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="fz" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H}">
        <stop offset="0" stop-color="#58d68d" stop-opacity=".26"/><stop offset="${zero}" stop-color="#58d68d" stop-opacity="0"/>
        <stop offset="${zero}" stop-color="#ff6b6b" stop-opacity="0"/><stop offset="1" stop-color="#ff6b6b" stop-opacity=".26"/></linearGradient></defs>
      <line x1="0" y1="${zero}" x2="${W}" y2="${zero}" stroke="#2a3644" stroke-dasharray="4 6"/>
      ${mv.length ? `<path d="${md} L${x(n - 1).toFixed(1)} ${zero} L${x(0).toFixed(1)} ${zero} Z" fill="url(#fz)"/>
      <path d="${md}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>` : ''}
      ${av.length ? `<path d="${line(shV, ya)}" fill="none" stroke="#4f8cff" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/><path d="${line(szV, ya)}" fill="none" stroke="#ffd25e" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>` : ''}
      ${dots(mainV, ym, col, v => `主力净额 ${fmtYi(v)}`)}
      ${dots(shV, ya, '#4f8cff', v => `沪市成交额 ${yi2(v)}`)}
      ${dots(szV, ya, '#ffd25e', v => `深市成交额 ${yi2(v)}`)}</svg>`;
  };
  const yi2 = v => v == null ? '—' : v >= 1e4 ? (v / 1e4).toFixed(2) + '万亿' : Math.round(v).toLocaleString('zh-CN') + '亿'; // 入参亿元

  function renderTrend(mf, nb) {
    const el = document.getElementById('trend-body');
    document.getElementById('src-trend').innerHTML = srcBadges({ '东财资金流(近7日)': mf });
    const d = (mf && mf.ok && mf.data) || null;
    if (!d) {
      el.innerHTML = `<div class="d7empty">东财资金接口暂不可达(${esc((mf && mf.error) || '等待中')}),60s 自动重试;台账逐日攒数,通了即画</div>`;
      document.getElementById('trend-points').innerHTML = '';
      return;
    }
    const days = (d.days || []).slice(-7);
    const amtDays = (d.amtDays || []).slice(-7);
    // 一张合并图:共用日期轴,主力净额(实线+红绿面积)与 沪/深成交额(虚线)各用各的纵轴
    const dates = [...new Set([...days.map(x => x.t), ...amtDays.map(x => x.t)])].sort();
    const pick = (arr, k) => dates.map(t => { const r = arr.find(x => x.t === t); return r && r[k] != null ? r[k] : null; });
    let html = '<div class="d7h">主力净额(左轴·实线)+ 沪深成交额(右轴·虚线) · 近7日</div>';
    const mainY = pick(days, 'main');
    if (mainY.every(v => v == null) && !amtDays.length) {
      html += `<div class="d7empty">台账暂无数据(${esc((mf && mf.error) || '等待中')}),60s 自动重试</div>`;
    } else {
      html += comboSvg(dates, mainY.map(v => v), pick(amtDays, 'sh').map(v => v == null ? null : v / 1e8), pick(amtDays, 'sz').map(v => v == null ? null : v / 1e8));
      const lastM = mainY.filter(v => v != null).pop(), LA = amtDays[amtDays.length - 1];
      html += `<div class="ftimes"><span>${dates[0].slice(5)}</span>`
        + `<span>${LA ? `<i class="lg" style="background:#4f8cff"></i>沪 ${yi2(LA.sh == null ? null : LA.sh / 1e8)} <i class="lg" style="background:#ffd25e"></i>深 ${yi2(LA.sz == null ? null : LA.sz / 1e8)} · ` : '成交额台账攒数中 · '}`
        + `主力末日 <span class="${(lastM ?? 0) >= 0 ? 'rn' : 'gn'}">${fmtYi(lastM)}</span></span><span>${dates[dates.length - 1].slice(5)}</span></div>`;
    }
    el.innerHTML = html;
    // 三张要点卡:主力连续N日 / 北向成交(T-1) / 两市成交额较昨日
    const both = d.sh && d.sz;
    const scope = both ? '两市' : d.sh ? '沪市' : d.sz ? '深市' : '两市(板块合计)';
    const sum = days.reduce((a, x) => a + x.main, 0);
    const { run, sum: runSum, sign } = runDays(days, null);
    const tk = (k, v, cls, sub) => `<div class="tk"><span class="k">→ ${k}</span>
      <span class="v ${cls}">${cls === 'rn' ? '▲ ' : cls === 'gn' ? '▼ ' : ''}${v}</span><span class="d">${sub}</span></div>`;
    const nd = (nb && nb.ok && nb.data) || null;
    const L = nd && nd.latest, P = nd && nd.prev;
    const nbChg = L && P && P.total ? ((L.total / P.total - 1) * 100) : null;
    const A = d.amt;
    const aChg = A && A.prev && A.today ? ((A.today / A.prev - 1) * 100) : null;
    document.getElementById('trend-points').innerHTML =
      tk(sign > 0 ? `主力连续${run}日净流入` : sign < 0 ? `主力连续${run}日净流出` : '主力资金持平',
        fmtYi(runSum), sign >= 0 ? 'rn' : 'gn',
        days.length ? `近${days.length}日累计 ${fmtYi(sum)} · ${scope}` : '台账攒数中') +
      tk('北向资金成交(T-1)', L ? `${Math.round(L.total).toLocaleString('zh-CN')}亿` : '—', nbChg == null ? '' : nbChg >= 0 ? 'rn' : 'gn',
        L ? `${esc(L.d)} · 较前日 ${nbChg == null ? '—' : (nbChg >= 0 ? '+' : '') + nbChg.toFixed(1) + '%'} · 净买入官方已停发` : '数据不可用') +
      tk('两市成交额', A && A.today ? yi2(A.today / 1e8) : '—', aChg == null ? '' : aChg >= 0 ? 'rn' : 'gn',
        A ? (aChg == null ? `${esc(A.d)} 盘中累计 · 较昨日待台账攒满隔日生效` : `较昨日 ${(aChg >= 0 ? '+' : '') + aChg.toFixed(1)}%`) : '行情源未回');
  }

  // ② 今日资金净流入(行业 Top10,主力净额降序;参考图右列)
  function renderNetIn() {
    const el = document.getElementById('netin-body');
    if (boardFail) { el.innerHTML = '<div class="err" style="padding:10px 0">✗ 板块数据不可用</div>'; return; }
    const rows = (boardRows || []).filter(r => r && numOrNull(r.mainNet) != null)
      .sort((a, b) => b.mainNet - a.mainNet).slice(0, 10);
    if (!rows.length) { el.innerHTML = '<div class="err" style="padding:10px 0">✗ 暂无资金流数据</div>'; return; }
    const pctTxt = v => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%');
    el.innerHTML = rows.map((r, i) => {
      const n = r.mainNet, p = p2(r.pct);
      return `<div class="nirow" title="${esc(r.name)}　主力净流入 ${fmtYi(n)} · 涨幅 ${pctTxt(p)}">
        <span class="rk ${i === 0 ? 'g1' : i === 1 ? 'g2' : i === 2 ? 'g3' : ''}">${i + 1}</span>
        <span class="t">${esc(r.name)}</span>
        <span class="a ${n >= 0 ? 'rn' : 'gn'}">${fmtYi(n)}</span>
        <span class="c ${p == null ? 'dim' : p >= 0 ? 'rn' : 'gn'}">${pctTxt(p)}</span>
      </div>`;
    }).join('');
  }

  // ②-c 北向资金动向:净买入自 2024-08 停发,只有成交额(T-1);占比 = 成交额 ÷ 两市成交额
  function renderNorth(nb) {
    const el = document.getElementById('nb-body');
    const d = (nb && nb.ok && nb.data) || null;
    const L = d && d.latest;
    if (!L) {
      el.innerHTML = `<div class="err">✗ 北向成交额:${esc((nb && nb.error) || '数据不可用')}</div>`;
      return;
    }
    // 参考图版式:标签 | 金额 | 较前一日环比(红增绿减);末行「今日成交合计」走上分隔线
    const yi = v => v == null ? '—' : (v >= 10000 ? (v / 10000).toFixed(2) + '万亿' : Math.round(v).toLocaleString('zh-CN') + '亿');
    const row = (ic, nm, v, pv, tot) => {
      const c = v != null && pv ? (v / pv - 1) * 100 : null;
      const cls = c == null ? '' : c >= 0 ? 'rn' : 'gn';
      return `<div class="nbrow${tot ? ' tot' : ''}" title="${esc(nm)} ${esc(L.d)} 收盘成交额 ${yi(v)}${c == null ? '' : ' · 较前日 ' + (c >= 0 ? '+' : '') + c.toFixed(1) + '%'}">
        <span class="lb"><i class="nbic">${ic}</i><span class="nm">${nm}</span></span>
        <span class="v ${cls}">${yi(v)}</span>
        <span class="p ${cls}">${c == null ? '—' : (c >= 0 ? '▲ +' : '▼ ') + c.toFixed(1) + '%'}</span></div>`;
    };
    const P = d.prev || {};
    el.innerHTML = row('沪', '沪股通', L.sh, P.sh) + row('深', '深股通', L.sz, P.sz) +
      row('北', `今日成交合计 · ${esc(L.d)}`, L.total, P.total, true);
  }

  // ② 板块行情:行业资金榜拆两榜——涨幅 TOP5 + 跌幅 TOP5(序号 + 主力净额 + 涨跌幅;净额正=流入/负=流出)
  function renderBoards() {
    const el = document.getElementById('board-body');
    if (!boardRows.length) { el.innerHTML = NO_BOARD; return; }
    const pctTxt = v => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%');
    const rkCls = i => i === 0 ? 'g1' : i === 1 ? 'g2' : i === 2 ? 'g3' : '';
    const brow = (r, i, medals) => {
      const p = p2(r.pct), n = p2(r.mainNet), mp = p2(r.mainPct), lp = p2(r.leadPct);
      const rs = REASONS[r.name];
      const cause = (rs && rs.title
          ? `<a class="rsn" href="${esc(rs.url)}" target="_blank" rel="noopener" title="${esc(rs.title)}(${rs.date}) 来自东财新闻检索">原因:${esc(rs.title)}</a> · `
          : '') +
        `领涨股 ${esc(r.leadUp || '—')} ${pctTxt(lp)}` +
        (n != null && n > 0 ? ` · 主力净入 ${fmtYi(n)}` : n != null && n < 0 ? ` · 主力净出 ${fmtYi(-n)}` : '');
      return `<div class="brow" title="${esc(r.name)}　主力净额 ${fmtYi(n)} · 涨幅 ${pctTxt(p)} · 净占比 ${pctTxt(mp)}">
        <span class="rk ${medals ? rkCls(i) : ''}">${i + 1}</span>
        <span class="bn"><span class="tt">${esc(r.name)}</span><span class="pp">净占比 ${pctTxt(mp)}</span></span>
        <span class="n1 ${n == null ? 'dim' : n >= 0 ? 'rn' : 'gn'}">${fmtYi(n)}</span>
        <span class="n2 ${p == null ? 'dim' : p >= 0 ? 'rn' : 'gn'}">${pctTxt(p)}</span>
        <span class="bz">${cause}</span>
      </div>`;
    };
    const seg = t => `<div class="bseg">${t}</div>`;
    el.innerHTML = '<div class="brank">' +
      `<div class="brow bhead"><span></span><span>行业</span><span class="n1">主力净额</span><span class="n2">涨跌幅</span></div>` +
      seg('<b class="u"></b>涨幅榜 TOP4') + boardTop(boardRows, 4).map((r, i) => brow(r, i, true)).join('') +
      seg('<b class="d"></b>跌幅榜 TOP4') + boardTop(boardRows, -4).map((r, i) => brow(r, i, false)).join('') +
      '</div>';
    if (!REASON_Q && boardRows.length) {
      REASON_Q = true;
      const names = [...new Set(boardTop(boardRows, 4).concat(boardTop(boardRows, -4)).map(r => r.name))];
      fetch('/api/stock/board-reasons?names=' + encodeURIComponent(names.join(',')))
        .then(r => r.json()).catch(() => null)
        .then(j => { if (j && j.success && Object.keys(j.data || {}).length) { Object.assign(REASONS, j.data); renderBoards(); } })
        .finally(() => { REASON_Q = false; });
    }
    document.getElementById('board-note').innerHTML =
      `按当日涨幅分别取涨 Top4 / 跌 Top4,只列二级行业(带Ⅲ的三级细分与父板块重复,服务端已剔除)。红 = 正、绿 = 负:主力净额正为流入、负为流出,净占比 = 主力净额 ÷ 板块成交额。` +
      `每行下「原因」= 按板块名检索东财新闻取 3 日内最新标题(点开原文),再附领涨股与主力净入/净出;检索不到只展示后者。新闻口径仅供参考,不构成投资建议。` +
      `板块上涨≠个股都涨,需结合 ③ 机会里的个股确认。`;
  }

  // ③ 今日机会 · 两派。价值派=妙想 MX 基本面选股(缓存 1h);趋势派=东财候选+腾讯日K硬门槛(60s)。
  // 两列各自 ok/error 互不拖累;chip 达标=学派主色亮圆点/未达空心灰/缺数据不显示(服务端已剔除 null 项)。
  let srcV = null, srcT = null;
  const updOppSrc = () => {
    const m = {};
    if (srcV) m['价值派 · 妙想MX(每小时)'] = srcV;
    if (srcT) m['趋势派 · 东财+腾讯K线(60s)'] = srcT;
    document.getElementById('src-opp').innerHTML = srcBadges(m);
  };
  // 分数环(conic-gradient 进度=分数,≥65 金环)+ TOP 序号 + 指标芯片;行业取末级(全路径进 title)
  const oppCard = (r, chips, i) => {
    const p = Math.max(0, Math.min(100, Math.round(r.score || 0)));
    const ind = String(r.ind || '');
    const pct = p2(r.pct) == null ? '—' : (r.pct > 0 ? '+' : '') + (+r.pct).toFixed(2) + '%';
    return `
    <div class="opp">
      <span class="rk">TOP ${i + 1}</span>
      <div class="ring" style="--p:${p}" title="综合评分 ${p}/100"><b>${p}</b></div>
      <div class="h"><span class="nm">${esc(r.name)}</span><span class="code">${esc(r.code)}</span><span class="mt" title="${esc(ind)}">现价 ${r.price != null ? `<b class="px">${(+r.price).toFixed(2)}</b>` : '—'} · 行业 ${esc(ind.split('-').pop() || '—')}</span>
        <span class="pp ${aCls(r.pct)}">${pct}</span></div>
      <div class="chips">${chips.map(chipHtml).join('')}</div>
    </div>`;
  };

  function renderValue(res) {
    srcV = res; updOppSrc();
    const el = document.getElementById('value-list');
    if (!res || !res.ok) { el.innerHTML = `<div class="err">✗ ${esc((res && res.error) || '妙想 MX 不可用')}(价值筛选依赖基本面源,无免费兜底;稍后自动重试)</div>`; return; }
    const d = res.data;
    if (!d.rows || !d.rows.length) { el.innerHTML = '<div class="err">今日两档基本面筛选(严格→放宽)有结果,但均未通过「企稳回升」确认(站回MA20 且近20日上涨),按门槛宁缺毋滥</div>'; return; }
    el.innerHTML = d.rows.map((r, i) => oppCard(r, valueChips(r), i)).join('') +
      (d.rows.length && d.rows.every(r => !r.tech) ? '<div class="blk-note">腾讯日K暂不可达,「企稳回升」确认本轮跳过,按基本面出榜。</div>' : '') +
      (d.level === 'loose' ? '<div class="blk-note">严格档(5年ROE+扣非+回撤全达标)今日 0 只,当前为放宽档结果。</div>' : '');
  }

  function renderTrendPicks(res) {
    srcT = res; updOppSrc();
    const el = document.getElementById('trend-list');
    const sub = document.getElementById('trend-sub');
    if (!res || !res.ok) { el.innerHTML = `<div class="err">✗ ${esc((res && res.error) || '趋势候选池不可用')}(全A列表东财限流时,稍后刷新)</div>`; sub.textContent = ''; return; }
    const d = res.data;
    sub.textContent = `漏斗:粗筛(涨/换手3-20/量比≥1.2/主力净>0)${d.pool}只 → 日K核验${d.screened}只 → 过四项硬门槛${d.passed}只。`;
    if (!d.rows.length) { el.innerHTML = '<div class="err">今日无个股同时满足 MA多头+站MA20+量5÷60>1.5+RSI∈[50,70](趋势派宁缺毋滥)</div>'; return; }
    el.innerHTML = d.rows.map((r, i) => oppCard(r, trendChips(r), i)).join('');
  }

  // 基金观察(2026-09-22):表格版,抄币圈「现货与市值」表规格(2026-09-22 用户点名)。
  // 只 5 列:名称/代码(含场内外角标)/今日涨跌/近1年/近3年(不足3年落成立以来,角标「成立」)。
  // 单字段缺失显示 —,永不因个别基金拉挂空表。
  // 表格版(2026-09-22 用户要求,抄币圈现货表规格);.tscroll 兜底:窄屏 5 列+角标放不下时表内横滑、名称列吸附(theme.css ≤900),页面级永不横滚
  function renderFunds(res) {
    const el = document.getElementById('funds');
    document.getElementById('src-funds').innerHTML = srcBadges({ '东财基金': res });
    if (!res || !res.ok) { el.innerHTML = `<div class="err">✗ ${esc((res && res.error) || '基金数据不可用')}(东财基金接口偶发限流,稍后刷新)</div>`; return; }
    const fp = v => {
      const p = p2(v);
      return p == null ? '<span class="dim">—</span>' : `<span class="${p >= 0 ? 'rn' : 'gn'}">${p > 0 ? '+' : ''}${p.toFixed(2)}%</span>`;
    };
    const px = v => (v == null || !isFinite(v) || v <= 0 ? '<span class="dim">—</span>' : v.toFixed(3));
    const yi = (v, d) => (v == null || !isFinite(v) || v <= 0 ? '<span class="dim">—</span>' : `${v.toFixed(d)}亿`);
    el.innerHTML = `<div class="tscroll"><table class="ftab"><thead><tr>
      <th>基金名称</th><th>代码</th>
      <th title="场内=实时成交价涨跌幅;场外=最新净值涨跌幅(QDII T+1)">今日涨跌</th>
      <th title="近7日收益(东财·净值口径)">7日</th>
      <th title="近30日收益(东财·净值口径)">30日</th>
      <th title="近90日收益(东财·净值口径)">90日</th>
      <th title="近1年收益(东财基金)">近1年</th>
      <th title="近3年收益;成立不足3年的基金显示成立以来(角标「成立」)">近3年</th>
      <th title="场内=基金规模(总市值口径);场外无">市值</th>
      <th title="24h(当日)最高成交价,仅场内">24h高</th>
      <th title="24h(当日)最低成交价,仅场内">24h低</th>
      <th title="24h(当日)成交额,仅场内">成交额</th>
    </tr></thead><tbody>` +
      res.data.slice().sort((a, b) => FUND_ORDER.indexOf(fundCat(a.name)) - FUND_ORDER.indexOf(fundCat(b.name)) || String(a.name).localeCompare(String(b.name), 'zh')).map(r => {
        const [t3l, t3v] = fundThird(r);
        return `<tr>
          <td class="nm" title="${esc(r.name)}">${esc(r.name)}<span class="fx">${fundCat(r.name)}</span></td>
          <td>${esc(r.code)}<span class="fx${r.ex ? ' on' : ''}">${r.ex ? '场内' : '场外'}</span></td>
          <td>${fp(r.day)}${r.dayDate ? `<span class="xi">${esc(String(r.dayDate).slice(5))}</span>` : ''}</td>
          <td>${fp(r.r7d)}</td>
          <td>${fp(r.r30d)}</td>
          <td>${fp(r.r90d)}</td>
          <td>${fp(r.r1y)}</td>
          <td>${fp(t3v)}${t3l === '成立以来' ? '<span class="xi">成立</span>' : ''}</td>
          <td>${yi(r.mcap, 1)}</td>
          <td>${px(r.hi)}</td>
          <td>${px(r.lo)}</td>
          <td>${yi(r.amt, 2)}</td>
        </tr>`;
      }).join('') + '</tbody></table></div>';
  }

  // ---------- 股票观察 · 持仓复盘(统一表) ----------
  // 2026-10-28 用户把持仓页 A股 tab 并入此面板(免登录):watch∪复盘按代码去重一张 16 列表,
  // 后 3 列(分红/120日区/逻辑)仅持仓行有值、观察行显 —;持仓行下挂简评 .main+.ana 组。
  // RECAP/LASTW 两条数据流各自到达都重画一次;版式/排序同基金观察(.ftab + 类别→名称)
  let RECAP = null, LASTW = null;
  let WSORT = { k: '', d: -1 }, WFILT = 'all'; // 高阶表列排序态(d=-1 首点=降序)与筛选态
  const sign2 = x => (x > 0 ? '+' : '') + Number(x).toFixed(2); // 复盘行涨跌额/概况百分比(自 holdings.js sign 搬来)
  const rngBar = p => p == null ? '<span class="dim">—</span>'
    : `<span class="rng ${p >= 66 ? 'hi' : p <= 33 ? 'lo' : ''}"><span class="track"><span class="dot" style="left:${Math.min(96, Math.max(4, p))}%"></span></span><b>${p.toFixed(0)}%</b></span>`;
  const anaRow = a => !a.tech
    ? `<tr class="ana"><td colspan="16"><span class="dim">✗ ${esc(a.error || '分析无数据')}</span></td></tr>`
    : `<tr class="ana ${a.verdict.tone}"><td colspan="16">` +
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

  function renderWatch(res) {
    LASTW = res;
    const el = document.getElementById('watch');
    const bd = { '腾讯行情': res };
    if (RECAP) bd['持仓复盘'] = RECAP;
    document.getElementById('src-watch').innerHTML = srcBadges(bd);
    const all = mergeRows(res && res.ok ? res.data : null, RECAP && RECAP.ok ? RECAP.data.rows : null);
    if (!all.length) {
      el.innerHTML = `<div class="err">✗ 行情:${esc((res && res.error) || '不可用')};复盘:${esc((RECAP && RECAP.error) || '不可用')}——稍后自动重试</div>`;
      return;
    }
    const fp2 = v => {
      const p = p2(v);
      return p == null ? '<span class="dim">—</span>' : `<span class="${p >= 0 ? 'rn' : 'gn'}">${p > 0 ? '+' : ''}${p.toFixed(2)}%</span>`;
    };
    const n2 = (v, d) => (v == null || !isFinite(v) ? '<span class="dim">—</span>' : v.toFixed(d));
    const yi = v => (v == null || !isFinite(v) || v <= 0 ? '<span class="dim">—</span>' : `${v.toFixed(1)}亿`);
    const na = '<span class="dim">—</span>';
    const sh =(k, lb, t) => `<th class="srt${WSORT.k === k ? ' on' + (WSORT.d > 0 ? ' asc' : '') : ''}" data-k="${k}"${t ? ` title="${t} · 点击排序"` : ' title="点击排序"'}>${lb}</th>`;
    let rows = filterRows(all, WFILT);
    rows = WSORT.k ? sortRows(rows, WSORT.k, WSORT.d) : rows.sort((a, b) => STOCK_ORDER.indexOf(stkCat(a.name, a.cat)) - STOCK_ORDER.indexOf(stkCat(b.name, b.cat)) || String(a.name).localeCompare(String(b.name), 'zh'));
    const nHold = all.filter(r => r.hold).length;
    el.innerHTML = `<div class="pills wfil">` +
      [['all', '全部', all.length], ['hold', '仅持仓', nHold], ['watch', '仅自选', all.length - nHold]].map(([f, lb, n]) =>
        `<button type="button"${WFILT === f ? ' class="on"' : ''} data-f="${f}">${lb} ${n}</button>`).join('') +
      `<span class="dim">点表头排序</span></div>` +
      `<div class="tscroll"><table class="ftab"><thead><tr class="gh">` +
      `<th colspan="2">标的</th><th colspan="2">今日行情</th>` +
      `<th colspan="5" title="前复权日K,含分红">区间涨跌</th><th colspan="4">估值 · 规模</th>` +
      `<th colspan="3" title="仅持仓行有值">持仓复盘</th></tr><tr>` +
      sh('name', '股票名称') + sh('code', '代码') +
      sh('price', '现价', '最新价(腾讯实时;持仓行悬停带涨跌额与行情时间)') +
      sh('day', '今日涨跌', '今日涨跌幅(腾讯实时)') +
      sh('d7', '7日', '近7个交易日(含分红)') + sh('d30', '30日', '近30日(含分红)') + sh('d90', '90日', '近90日(含分红)') +
      sh('d180', '180日', '近180日(含分红)') + sh('d365', '1年', '近1年(含分红)') +
      sh('pe', 'PE', '动态市盈率(亏损为负)') + sh('pb', 'PB', '市净率') + sh('mcap', '市值', '总市值(亿元)') + sh('amt', '成交额', '当日成交额(亿元)') +
      `<th title="最新分红(东财分红送配报表,按除息日取最近一条):每10股税前派息·除息日·现价股息率;港股无此报表">分红</th>` +
      `<th title="现价在 120 日高低区间的位置(技术面复盘用)">120日区</th>` +
      `<th title="技术面逻辑变化:利好/风险/无变化(120日K规则判定)">逻辑</th>` +
      `</tr></thead><tbody>` +
      (rows.length ? rows.map(r => {
        const pc = r.pc || {}, h = r.hold, div = h && h.div;
        return `<tr class="main">
          <td class="nm" title="${esc(r.name)}">${esc(r.name)}<span class="fx">${stkCat(r.name, r.cat)}</span>${h ? '<span class="fx on">持仓</span>' : ''}</td>
          <td>${esc(r.code)}</td>
          <td${h ? ` title="涨跌额 ${h.chg == null ? '—' : stkCur(h.market) + sign2(h.chg)} · 行情时间 ${esc(fmtQuoteTime(h.time))}"` : ''}>${n2(r.price, 2)}</td>
          <td>${fp2(r.day)}</td>
          <td>${fp2(pc.d7)}</td>
          <td>${fp2(pc.d30)}</td>
          <td>${fp2(pc.d90)}</td>
          <td>${fp2(pc.d180)}</td>
          <td>${fp2(pc.d365)}</td>
          <td>${n2(r.pe, 1)}</td>
          <td>${n2(r.pb, 2)}</td>
          <td>${yi(r.mcap)}</td>
          <td>${yi(r.amt)}</td>
          <td${div ? ` title="${esc(div.full)} · 除息 ${div.ex} · 现价股息率 ${div.yl == null ? '—' : div.yl + '%'}"` : ''}>${div ? esc(div.plan) + `<span class="dim"> 除息${esc(String(div.ex).slice(5))}</span>` : na}</td>
          <td>${h && h.tech ? rngBar(h.rs.pos) : na}</td>
          <td>${h && h.tech ? `<span class="tg ${h.tag}" title="${esc(h.tagWhy)}"><i></i>${h.tag === 'good' ? '利好' : h.tag === 'risk' ? '风险' : '无变化'}</span>` : na}</td>
        </tr>` + (h && (h.tech || h.error) ? anaRow(h) : '');
      }).join('') : '<tr><td colspan="16" class="dim" style="text-align:center;padding:18px">该筛选下暂无标的</td></tr>') +
      '</tbody></table></div>';
  }

  // 高阶表交互:表头排序 / 筛选 pills——委托在静态容器 #watch(innerHTML 重排不丢监听)
  document.getElementById('watch').addEventListener('click', e => {
    const th = e.target.closest('th.srt');
    if (th) {
      const k = th.getAttribute('data-k');
      WSORT = WSORT.k === k ? { k, d: -WSORT.d } : { k, d: -1 };
      renderWatch(LASTW); return;
    }
    const b = e.target.closest('.wfil button');
    if (b) { WFILT = b.getAttribute('data-f'); renderWatch(LASTW); }
  });

  // 复盘信封落位:概况条 #mkline + 四类 #focus + 三选 #digest + 注记,然后重画统一表(复盘行并入 watch 表)。
  // 失败/未到:四块清空、#dnote 如实挂原因(宁缺勿假);表照常画——观察行复盘三列显 —
  function paintRecap(r) {
    RECAP = r;
    const mk = document.getElementById('mkline'), fg = document.getElementById('focus'),
      dg = document.getElementById('digest'), dn = document.getElementById('dnote');
    const d = r && r.ok && r.data;
    if (d && d.overview) {
      const ov = d.overview;
      mk.innerHTML = ov.idx.map(i => `<span class="ix">${esc(i.n)} <b class="${aCls(i.pct)}">${i.pct == null ? '—' : sign2(i.pct) + '%'}</b></span>`).join('') +
        `<span class="meta">持仓 <b class="rn">${ov.up}涨</b> <b class="gn">${ov.down}跌</b></span>` +
        `<span class="meta">技术面实质变化 <b>${ov.changed}</b> 只 · 复盘 <b>${d.rows.length}</b> 只</span>`;
      const f = d.focus, g = d.digest;
      const card = (color, title, list) =>
        `<div class="fcard ${color}"><h4>${title}</h4>` +
        (list.length ? list.map(x => `<div class="fitem"><b>${esc(x.name)}</b><i>${esc(x.why)}</i></div>`).join('') : '<div class="fnone">— 暂无</div>') + '</div>';
      fg.innerHTML = card('c-blue', '🎯 超跌不坏', f.oversold) + card('c-gold', '📉 历史低位估值', f.lowVal) +
        card('c-green', '🔧 改善未反映', f.improve) + card('c-red', '⚠️ 逻辑风险', f.risk);
      const dcard = (emoji, title, x, fb) =>
        `<div class="dcard"><i>${emoji} ${title}</i>` + (x ? `<b>${esc(x.name)}</b><p>${esc(x.why || fb)}</p>` : '<b class="dim">无</b>') + '</div>';
      dg.innerHTML = dcard('🟢', '最值得关注', g.best, '技术面强势') + dcard('🔴', '最需警惕', g.watch, '') + dcard('💰', '超跌最值得等待', g.wait, '');
      dn.textContent = '四类与总结为技术面代理判定(无免费逐票基本面/新闻源),不构成投资建议;PE/PB 来自腾讯行情;复盘清单=MySQL holding 表。';
    } else {
      mk.innerHTML = ''; fg.innerHTML = ''; dg.innerHTML = '';
      dn.textContent = r && !r.ok ? `✗ 复盘数据不可用:${String(r.error || '')}(稍后自动重试)` : '';
    }
    renderWatch(LASTW);
  }

  // 重要资讯(位置在页尾双栏⑤;2026-10-22 用户「原来的位置不要动」——10-21 曾上移已挪回,勿再挪):东财优先,MX 兜底(均为中文,标题已贴标)
  // 2026-10-21 用户要求参考首页「今日信号」的设计、板块可上下滑动:圆点卡列表(.slw/.sln 在 theme.css),
  // 级别=newsHeat(红大圈=政策/盘面异动,琥珀=常规,灰点=其他),时间进每行 meta、不再按日分组;放 20 条吃滚动。
  function renderNews(nw, mx) {
    const el = document.getElementById('news');
    const badges = { '东财资讯': nw };
    if (mx) badges['妙想MX'] = mx;
    document.getElementById('src-news').innerHTML = srcBadges(badges);
    const useMx = mx && mx.ok && !(nw && nw.ok);
    const act = useMx ? mx : nw;
    if (!act || !act.ok) { el.innerHTML = '<div class="err">✗ 资讯与妙想兜底均不可用</div>'; return; }
    const tc = { 政策: 'tc-policy', 市场: 'tc-market', 公司: 'tc-company', 要闻: 'tc-news' };
    const rows = (act.data || []).slice()
      .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')))
      .slice(0, 20);
    el.innerHTML = (useMx ? `<div class="blk-note">东财不可用,当前为妙想 MX 兜底。</div>` : '') +
      '<div class="slw">' + rows.map(x => {
        const d = String(x.time || '').slice(5, 16).replace('T', ' '); // MM-DD HH:mm
        return `<div class="sln ${newsHeat(x)}"><i></i>
          ${x.url ? `<a class="tt" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : `<span class="tt">${esc(x.title)}</span>`}
          ${x.summary ? `<div class="ds">${esc(x.summary)}</div>` : ''}
          <div class="mt"><span class="tchip ${tc[x.tag] || 'tc-news'}">${x.tag || '要闻'}</span><span>${esc(x.media || '')}</span><span class="hm">${esc(d || '—')}</span></div>
        </div>`;
      }).join('') + '</div>';
  }

  // ⑥ 市场异动:涨停连板(池) + 大跌 + 放量(机会列表附带的跌/量比榜;MX 兜底无跌量榜 → 诚实留空)
  function renderMoves(em, mx, poolRes) {
    const badges = { '东财全A': em, '东财涨停池': poolRes };
    if (mx) badges['妙想MX'] = mx;
    document.getElementById('src-moves').innerHTML = srcBadges(badges);
    const oppRes = (em && em.ok) ? em : (mx && mx.ok) ? mx : null;
    // 三张擂台小卡:名次圆牌(前三名金/银/铜,复用 ② .rk)+ 能量条 + 名称 + 右对齐百分比
    // 能量条:连板=一格一板的绿格子(>6 折叠成 +n);跌幅/量比=长度按列内最大值归一的色条
    const rkCls = i => i === 0 ? 'g1' : i === 1 ? 'g2' : i === 2 ? 'g3' : '';
    const ecells = n => { const k = +n || 0; return `<span class="ecells">${'<i></i>'.repeat(Math.min(6, k))}${k > 6 ? `<u>+${k - 6}</u>` : ''}</span>`; };
    const ebar = (cls, w) => `<span class="ebar ${cls}" style="--w:${Math.max(6, Math.min(100, Math.round(w)))}%"></span>`;
    const mrow = (i, chip, nm, val, vcls, bar) =>
      `<div class="mrow"><span class="rk ${rkCls(i)}">${i + 1}</span>${chip || ''}<span class="mn">${esc(nm)}</span><span class="mv ${vcls}">${val}</span>${bar || ''}</div>`;
    const mvcard = (t, n, body) => `<div class="mvcard"><div class="mvh">${t}<b>Top ${n}</b></div>${body}</div>`;
    const mvnone = t => `<div class="mvnone">${t}</div>`;
    // 连板/放量榜折叠下拉(2026-09-22 用户要求):收起只见 TOP1,点开到 4 行;原生 details 零 JS。
    // 展开态按卡 key 记,SWR 自动重渲/手动刷新都保持用户点开的那张不回卷。
    const openNow = new Set([...mv.querySelectorAll('details[open]')].map(d => d.dataset.k));
    const mvdet = (t, k, rows, empty) => rows.length
      ? `<details class="mvcard"${openNow.has(k) ? ' open' : ''} data-k="${k}"><summary><div class="mvh">${t}<b>Top ${rows.length} <i class="ca">▾</i></b></div>${rows[0]}</summary>${rows.slice(1).join('')}</details>`
      : mvcard(t, 4, empty);
    const cols = [];
    const poolRows = (poolRes && poolRes.ok && poolRes.data.rows) || [];
    const zt = [...poolRows].filter(r => (+r.lb || 0) >= 2)
      .sort((a, b) => (+b.lb || 0) - (+a.lb || 0) || (+b.pct || 0) - (+a.pct || 0)).slice(0, 4);
    cols.push(mvdet('涨停连板', 'zt',
      zt.map((r, i) => mrow(i, ecells(r.lb), r.name,
        `${r.pct > 0 ? '+' : ''}${(+r.pct).toFixed(1)}%`, 'rn')),
      mvnone('无 2 连及以上涨停')));
    const down = ((oppRes && oppRes.ok && oppRes.data.down) || []).slice(0, 4);
    const dMax = Math.max(0.01, ...down.map(r => Math.abs(+r.pct || 0)));
    cols.push(mvcard('跌幅榜', 4,
      down.length ? down.map((r, i) => mrow(i, '', r.name,
        p2(r.pct) == null ? '—' : (r.pct > 0 ? '+' : '') + (+r.pct).toFixed(2) + '%', aCls(r.pct),
        ebar('r', Math.abs(+r.pct || 0) / dMax * 100))).join('')
        : mvnone('需东财全A列表(限流时无兜底)')));
    const vol = ((oppRes && oppRes.ok && oppRes.data.vol) || []).slice(0, 4);
    const vMax = Math.max(0.01, ...vol.map(r => +r.volRatio || 0));
    cols.push(mvdet('放量榜 · 量比', 'vol',
      vol.map((r, i) => mrow(i, `<span class="mchip blue">量比 ${p2(r.volRatio) == null ? '—' : (+r.volRatio).toFixed(1)}</span>`, r.name,
        p2(r.pct) == null ? '—' : (r.pct > 0 ? '+' : '') + (+r.pct).toFixed(1) + '%', aCls(r.pct),
        ebar('b', (+r.volRatio || 0) / vMax * 100))),
      mvnone('需东财全A列表(限流时无兜底)')));
    mv.innerHTML = cols.join('');
  }

  // ② 板块数据装配:徽标 + 全局解析 + 行业分布/净流入榜两列(整页渲染与板块级刷新共用,2026-10-18 勿双实现)
  function setBoards(boardsRes, asOf) {
    document.getElementById('src-boards').innerHTML = srcBadges({ '东财板块': boardsRes }) + (boardsRes.ok ? asOfNote(asOf) : '');
    boardFail = !boardsRes.ok;
    boardRows = (boardsRes.ok && boardsRes.data) || [];
    indPct = new Map(boardRows.filter(r => r.name).map(r => [r.name, r.pct]));
    renderBoards();
    renderNetIn();
  }

  // 东财 clist(板块/机会/跌量榜)被限流时会变慢或失败,分批渲染 —— 先画 市场/涨停池/资讯,clist 好了再补 ②③⑥。
  async function loadAndRender() {
    const st = document.getElementById('status');
    st.textContent = '加载中…';
    const get = u => fetch(u).then(r => r.json()).catch(() => null);
    // ③ 价值派走 MX,与东财无关 → 立即并行(首次可慢至 45s,好了才画,不拖其他块)
    get('/api/stock/value').then(j => renderValue((j && j.data && j.data.mx) || { ok: false, error: '接口不可达' }));
    // 基金观察:东财 fundmob + 腾讯 qt,不碰 clist → 同批并行,好了即画
    get('/api/stock/funds').then(j => renderFunds((j && j.data && j.data.em) || { ok: false, error: '接口不可达' }));
    get('/api/stock/watch').then(j => renderWatch((j && j.data && j.data.qt) || { ok: false, error: '接口不可达' }));
    // 持仓复盘(2026-10-28 并入):独立并发,paintRecap 落位时会连统一表一起重画,谁先到谁先出
    get('/api/stock/recap').then(j => paintRecap((j && j.data && j.data.ana) || { ok: false, error: '接口不可达' }));
    // 趋势派复用 /opportunity 的 stk:opp 缓存 → 放在 jo 之后发,避免服务端并发打两遍 clist 触发限流
    // 第一批:不依赖 clist 的快源(指数/涨停池/资讯)→ 立即出画面
    const [jm, jf, jn, jmf] = await Promise.all([
      get('/api/stock/market'), get('/api/stock/flow'), get('/api/stock/news'), get('/api/stock/moneyflow'),
    ]);
    renderMarket((jm && jm.data) || {});
    renderTrend((jmf && jmf.data && jmf.data.em) || { ok: false, error: '接口不可达' }, (jmf && jmf.data && jmf.data.nb) || null);
    renderNorth((jmf && jmf.data && jmf.data.nb) || { ok: false, error: '接口不可达' });
    const poolRes = (jf && jf.data && jf.data.pool) || { ok: false, error: '接口不可达' };
    const newsD = (jn && jn.data) || {};
    renderNews(newsD.em || { ok: false, error: '接口不可达' }, newsD.mx || null);
    // 第二批:东财 clist 系(板块/机会)后台等;限流时先画上面,这里好了再补 ②③④板块列 ⑥
    const [jb, jo] = await Promise.all([
      get('/api/stock/boards'), get('/api/stock/opportunity'),
    ]);
    const boardsRes = (jb && jb.data && jb.data.em) || { ok: false, error: '接口不可达' };
    const oppD = (jo && jo.data) || {};
    const oppEm = oppD.em || { ok: false, error: '接口不可达' };
    const oppMx = oppD.mx || null;
    setBoards(boardsRes, jb && jb.data && jb.data.asOf);
    renderMoves(oppEm, oppMx, poolRes); // 涨停池只喂 ⑥ 连板榜(④市场资金板块已下线)
    get('/api/stock/trend').then(j => renderTrendPicks((j && j.data && j.data.em) || { ok: false, error: '接口不可达' }));

    const qtRows = ((jm && jm.data && jm.data.qt) && jm.data.qt.ok && jm.data.qt.data) || [];
    const asOf = qtRows.map(r => r.time).find(t => t);
    st.textContent = `免费源 · 服务端 60s 缓存 · 行情时间 ${fmtQuoteTime(asOf) || '—'} · 刷新于 ${new Date().toLocaleTimeString('zh-CN')} · 绿涨红跌`;
  }

  // SWR(nav.js v2):后台重取成功 → apifresh → 自动重渲替换;手动刷新置 __apibust 无视本地缓存直连
  document.getElementById('refresh').onclick = () => { window.__apibust = Date.now(); loadAndRender(); };
  window.addEventListener('apifresh', loadAndRender);

  // 板块级刷新(2026-10-18 用户要求,nav.js 依此表在板块右上角挂 ⟳):只重取本板块用到的源、只重渲本板块
  const BAD = { ok: false, error: '接口不可达' };
  window.panelRef = {
    'p-mkt': async () => { const j = await panelFetch('/api/stock/market'); renderMarket((j && j.data) || {}); },
    'p-watch': async () => { // 观察 + 复盘两路并发(panelFetch=直连 fresh,穿透服务端缓存与 SWR)
      const [j, jr] = await Promise.all([panelFetch('/api/stock/watch'), panelFetch('/api/stock/recap')]);
      renderWatch((j && j.data && j.data.qt) || BAD);
      paintRecap((jr && jr.data && jr.data.ana) || BAD);
    },
    'p-funds': async () => { const j = await panelFetch('/api/stock/funds'); renderFunds((j && j.data && j.data.em) || BAD); },
    'p-boards': async () => { // ② 三列:行业分布/净流入榜=东财 boards;趋势+北向=moneyflow(本地台账多路)
      const [jb, jmf] = await Promise.all([panelFetch('/api/stock/boards'), panelFetch('/api/stock/moneyflow')]);
      const mfd = (jmf && jmf.data) || {};
      renderTrend(mfd.em || BAD, mfd.nb || null); renderNorth(mfd.nb || BAD);
      setBoards((jb && jb.data && jb.data.em) || BAD, jb && jb.data && jb.data.asOf);
    },
    'p-opp': async () => { // ③ 两派:价值=MX 语义选股,趋势=候选+腾讯日K本地算
      const [jv, jt] = await Promise.all([panelFetch('/api/stock/value'), panelFetch('/api/stock/trend')]);
      renderValue((jv && jv.data && jv.data.mx) || BAD);
      renderTrendPicks((jt && jt.data && jt.data.em) || BAD);
    },
    'p-news': async () => { const jn = await panelFetch('/api/stock/news'); const nd = (jn && jn.data) || {}; renderNews(nd.em || BAD, nd.mx || null); },
    'p-moves': async () => { // ⑥ 连板/跌幅/放量:全A排行=opportunity,涨停池=flow
      const [jo, jf] = await Promise.all([panelFetch('/api/stock/opportunity'), panelFetch('/api/stock/flow')]);
      const od = (jo && jo.data) || {};
      renderMoves(od.em || BAD, od.mx || null, (jf && jf.data && jf.data.pool) || BAD);
    },
  };
  loadAndRender(); // 块内定义并自调用;勿在 HTML 尾部再加 <script>loadAndRender()</script>
}

// ---------- 自检(node public/stock.js) ----------
function selftest() {
  const A = (c, m) => console.assert(c, m);
  A(aCls(1) === 'rn' && aCls(-1) === 'gn' && aCls(0) === '', '涨跌→类名映射(rn涨/gn跌)');
  A(fmtQuoteTime('20260904150000') === '2026-09-04 15:00', '紧凑时间');
  A(fmtQuoteTime('') === '—', '空时间');
  A(fmtYi(2.1e8) === '+2.10亿' && fmtYi(-4.8e7) === '-0.48亿' && fmtYi(null) === '—', 'fmtYi');

  const t = marketTemp(0.5, 0.55, 10, 3);
  A(t && t.score > 42 && t.score < 70, '正常偏强日应中性偏强');
  A(marketTemp(2, 0.7, 60, 5).score >= 58, '普涨大涨应偏强+');
  A(marketTemp(-2, 0.3, 2, 60).score <= 42, '普跌应偏弱');
  A(marketTemp(null, null, null, null) === null, '全缺→null');
  const idxOnly = marketTemp(0.5, null, null, null);
  A(idxOnly != null && idxOnly.score > 0, '只给指数也能出温度');

  // ③ 两派 chips(评分在服务端,前端只拼装展示):null 字段剔除,不猜;达标位 true/false
  const vc = valueChips({ pe: 12, pb: 1.4, dvd: 3.8, roe: 18, gross: 35, dedtYoy: 9, debt: 42, dd: 26 });
  A(vc.length === 7 && vc.every(x => x[2] === true), '价值派全达标 7 chips');
  const vc2 = valueChips({ pe: null, pb: '-', dvd: 2.1, roe: 18, gross: 35, dedtYoy: null, debt: null, dd: null });
  A(vc2.length === 2 && vc2.find(x => x[0] === '股息率')[2] === false, '价值派缺数据剔除、未达标 false');
  const vc3 = valueChips({ pe: 12, dd: 26, tech: { aboveMa20: true, chg20: 5.2 } });
  A(vc3.find(x => x[0] === '企稳回升')?.[2] === true, '价值派企稳chip达标');
  A(!vc2.find(x => x[0] === '企稳回升'), '价值派tech缺失不显示企稳chip');

  // 基金观察第三列口径:有近3年用近3年,成立不足3年(3N缺)落成立以来,双缺显示 —
  A(fundThird({ r3y: 14.26, ln: 173.06 })[0] === '近3年', '基金满3年→近3年');
  const fYoung = fundThird({ r3y: '', ln: 173.06 });
  A(fYoung[0] === '成立以来' && fYoung[1] === 173.06, '基金不足3年→成立以来');
  // 基金归类(2026-10-14 用户「按类型和内容排序」,不懂基金→规则由代码判):具体先判防误归
  A(fundCat('黄金ETF华安') === '商品' && fundCat('纳指100ETF国泰') === '海外' && fundCat('标普500ETF博时') === '海外', '基金归类·商品/海外');
  A(fundCat('富国中证红利指数增强A') === '红利' && fundCat('红利低波50ETF南方') === '红利', '基金归类·红利(增强A不误判AI)');
  A(fundCat('创业板人工智能ETF南方') === 'AI' && fundCat('半导体ETF国泰') === '半导体', '基金归类·行业先于宽基');
  A(fundCat('科创50ETF华夏') === '宽基' && fundCat('沪深300ETF华泰柏瑞') === '宽基' && fundCat('某新主题基金') === '其他', '基金归类·宽基/其他');
  A(FUND_ORDER.indexOf(fundCat('黄金ETF华安')) > FUND_ORDER.indexOf(fundCat('沪深300ETF华泰柏瑞')), '显示序·宽基在前商品在后');
  A(stkCat('中国银行', '金融') === '金融' && stkCat('某某控股', '稀土') === '其他', '股票归类·cat 白名单(cat 只认 STOCK_ORDER,未知落其他)');
  A(stkCat('华能电力') === '电力' && stkCat('南山铝业') === '材料' && stkCat('西安旅游') === '消费' && stkCat('寒武纪科技') === '科技', '股票归类·名称关键词兜底');
  A(stkCat('中国海油') === '能源' && stkCat('中国核建') === '建筑' && stkCat('中国核电') === '电力', '股票归类·能源/建筑(核电≠核建 关键词各归各位)');
  A(STOCK_ORDER.indexOf(stkCat('工商银行')) < STOCK_ORDER.indexOf(stkCat('某某科技')), '显示序·金融在前科技在后(同基金:类别→名称)');
  A(fundThird({ r3y: null, ln: null })[1] === null, '基金双缺→null显示—');
  const tc = trendChips({ turn: 8, mainNet: 2.1e8, sameInd: 3, tech: { maBull: true, macdUp: true, newHigh60: false, vol5_60: 1.8, rsi: 61, chg20: 18 } });
  A(tc.length === 9 && tc[0][2] === true && tc.find(x => x[0] === '60日新高')[2] === false && tc[8][0] === '板块共振', '趋势派 9 chips/共振附加');
  const tc2 = trendChips({ turn: null, mainNet: null, tech: { maBull: false, macdUp: false, newHigh60: false, vol5_60: null, rsi: null, chg20: null } });
  A(tc2.length === 3 && tc2.every(x => x[2] === false), '趋势派缺数据只剩三形态位');

  // 板块排序:涨榜降序、跌榜跌幅最大在前,涨幅缺失的剔除
  const rows = [{ name: 'A', pct: 3, mainNet: 1e8 }, { name: 'B', pct: 1, mainNet: 5e8 }, { name: 'C', pct: null, mainNet: -2e8 }, { name: 'D', pct: -2, mainNet: -5e8 }, { name: 'E', pct: -5, mainNet: -1e8 }];
  const top = boardTop(rows, 2);
  A(top.length === 2 && top[0].name === 'A' && top[1].name === 'B', '涨榜按涨幅降序/剔缺');
  const bot = boardTop(rows, -2);
  A(bot.length === 2 && bot[0].name === 'E' && bot[1].name === 'D', '跌榜跌幅最大在前');
  // 沪市连续净流入/流出:今日盘中值并入日线,同号才连;日线缺当日不重复计
  const dd = [{ t: '2026-09-08', main: 5e9 }, { t: '2026-09-09', main: 2e9 }];
  const r1 = runDays(dd, { d: '2026-09-10', main: 3e9 });
  A(r1.run === 3 && r1.sum === 1e10 && r1.sign === 1, '今日并入 → 连续3日净流入');
  A(runDays(dd, { d: '2026-09-10', main: -1e9 }).run === 1, '今日转负 → 连续1日净流出');
  A(runDays(dd, { t: '2026-09-09', d: '2026-09-09', main: 2e9 }).run === 2, '日线已含当日 → 不重复计');
  A(runDays([], null).run === 0 && runDays([], null).sign === 0, '无数据 → 0');

  // ⑤ 资讯时间线级别(2026-09-20):政策/盘面异动→hi,常规市场资讯→mid,其余→''
  A(newsHeat({ title: '央行宣布降准', summary: '' }) === 'hi', '降准→hi');
  A(newsHeat({ title: '某股东减持', summary: '' }) === 'mid', '减持→mid');
  A(newsHeat({ title: '', summary: '' }) === '', '空文本→默认级');

  // 板块回放时间注(2026-10-20):新鲜/缺失→空串;>10min→琥珀注记带 MM-DD HH:mm
  A(asOfNote(Date.now() - 60e3) === '' && asOfNote(0) === '', '回放注·新鲜不标');
  A(/东财限流[\s\S]*\d\d-\d\d \d\d:\d\d 回放/.test(asOfNote(Date.now() - 3600e3)), '回放注·旧数据如实标时刻');

  // 持仓复盘并入统一表(2026-10-28):货币前缀 + 合并去重
  A(stkCur('A股·沪') === '¥' && stkCur('港股') === 'HK$' && stkCur('HK') === 'HK$' && stkCur() === '¥', 'stkCur 货币前缀');
  const f1 = [{ code: '601985', name: '中国核电', cat: '电力' }, { code: '600219', name: '南山铝业' }];
  const f2 = [{ code: '601985', name: '中国核电', market: 'A股·沪', price: 10, chgPct: 1 }, { code: '000516', name: '国际医学', market: 'A股·深', price: 5, chgPct: -1, pc: { d7: 2 } }];
  const mM = mergeRows(f1, f2);
  A(mM.length === 3 && !!mM[0].hold, 'mergeRows 同码挂 hold、去重成 3 行');
  A(mM[2].code === '000516' && mM[2].cat === null && mM[2].day === -1 && mM[2].pc.d7 === 2, 'mergeRows 复盘独行折算行形(day=chgPct)');
  A(mergeRows([{ code: '601988', name: '中国银行' }], null).every(x => !x.hold), 'mergeRows 复盘缺→原样观察表');
  const only = mergeRows(null, [{ code: '000610', name: '西安旅游', price: 3, chgPct: 0.5 }]);
  A(only.length === 1 && only[0].day === 0.5 && !!only[0].hold, 'mergeRows 观察缺→复盘独表');

  // 高阶表(2026-10-28 用户「不易读,用高阶表格」):排序/筛选/基线/热底
  {
    const rs = [{ name: 'b', code: '2', price: 1, pc: { d7: 5 } }, { name: 'a', code: '1', price: null }, { name: 'c', code: '3', price: 3, hold: { x: 1 } }];
    A(sortRows(rs, 'price', -1).map(r => r.name).join() === 'c,b,a', 'sortRows 数值降序、null 恒沉底');
    A(sortRows(rs, 'price', 1).map(r => r.name).join() === 'b,c,a', 'sortRows 同列再点=升序(null 仍沉底)');
    A(sortRows(rs, 'name', 1).map(r => r.name).join() === 'a,b,c', 'sortRows 名称升序');
    A(sortRows(rs, 'd7', -1).map(r => r.name).join() === 'b,a,c', 'sortRows 区间列取 r.pc');
    A(sortRows(rs, '', -1).length === 3 && sortRows(rs, '', -1)[0].name === 'b', 'sortRows k="" 保持传入序');
    A(filterRows(rs, 'hold').length === 1 && filterRows(rs, 'watch').length === 2 && filterRows(rs, 'all').length === 3, 'filterRows 全部/仅持仓/仅自选');
  }

  console.log('stock.js selftest OK');
}
if (typeof require !== 'undefined' && require.main === module) selftest();
