import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { readFileSync } from 'fs';
import { createHmac } from 'crypto';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { Holding } from '../entity/entities/Holding';
import { QtService, quoteCode } from './qt.service';
import { klineInd, parseTencentKline, periodChg } from './market.service';

// periodChg 已挪到 market.service(股票观察 watch() 同用,避免 market→holding 循环引用);此处 re-export,test/holding.test.ts 与各调用方不动
export { periodChg };
import { binance24h } from './crypto.service';
import { getJson, getKlineJson } from '../util/net';
import { DEMO_CRY, DEMO_STK } from './demo';

/*
 * 持仓扩展:① A股/港股逐只技术面简评(腾讯日K直连,复用 market.service 的 klineInd,同趋势派路数)
 * ② 币圈持仓(现货+合约),仓位台账在 data/crypto_holdings.json(用户手填数量/开仓价,不入库)。
 * 纯函数(rangeStats/stockVerdict/futMetrics)顶层可单测,npx jest test/holding.test.ts。
 */

// 120 根日K → 区间高低、现价位置(0=最低 100=最高)、距高点回撤%。K线只有 close 列参与「低」
export function rangeStats(bars: Array<{ c: number; h: number; v: number }>) {
  const close = bars[bars.length - 1].c;
  const hi = Math.max(...bars.map(b => b.h));
  const lo = Math.min(...bars.map(b => b.c));
  const span = hi - lo;
  return {
    hi, lo, close,
    pos: span > 0 ? ((close - lo) / span) * 100 : null,
    dd: hi > 0 ? ((hi - close) / hi) * 100 : null,
  };
}

// 技术面 → tone(up 强势 / mid 震荡 / dn 弱势)+ 一句话结论。只陈述指标事实,不喊买卖
// 合约行区间涨跌(2026-10-12 用户对照 App「BNB −0.4/BTC −15/OKB −37」定稿,否决显 —/该币1年两版):
// 周期起点早于开仓时间(持仓不足该档)→ 该档显示合约总盈亏率 = OKX uplRatio×100(开仓 ROE,与 App 收益率同值,已带方向);
// 持满的档照常该币涨跌、d1 不动。返回浅拷贝,勿把同币现货行的共享 pcMap 对象裁脏
export function futPcTrim(pc: any, r: any): any {
  if (!pc || !r || !r.ctime) return pc ?? null;
  const o = Object.assign({}, pc);
  const p = r.roe != null && isFinite(+r.roe) ? +(+r.roe).toFixed(1)
    : r.margin && r.upnl != null ? +((r.upnl / r.margin) * 100).toFixed(1)
    : r.entry && r.mark ? +(((r.dir === 'short' ? r.entry / r.mark : r.mark / r.entry) - 1) * 100).toFixed(1)
    : null;
  for (const N of [7, 30, 90, 180, 365]) if (r.ctime > Date.now() - N * 864e5) o[`d${N}`] = p;
  return o;
}

// 非合约行区间涨跌回填(2026-10-12 用户选「按成本收益率填」,与合约总盈亏同思路——OKX 现货/理财无取得时间,
// 无法判「不足档」,改为该档无日K行情(稳定币/新上市/拉挂)时回填这笔资产自己的总收益率):
// 理财/质押行 = 累计利息÷持仓额(earnings/qty),现货行 = 现价 vs 成本均价(price/cost−1,accAvgPx 同源);
// 转入无成本、资金账户无成本 → 仍 null 显 —。有行情的档不动;合约行走 futPcTrim 不进这里(ctime 判定)。
// o.yld/yldSrc 供前端 title 注口径;返回浅拷贝,勿把共享 pcMap 对象写脏
export function pcYield(pc: any, r: any): any {
  if (!r || r.ctime) return pc ?? null;
  const useE = r.earnings != null && r.qty > 0;
  const y = useE ? +((r.earnings / r.qty) * 100).toFixed(1)
    : r.cost > 0 && r.price > 0 ? +((r.price / r.cost - 1) * 100).toFixed(1)
    : null;
  if (y == null) return pc ?? null;
  const o = Object.assign({}, pc);
  let used = false;
  for (const N of [1, 7, 30, 90, 180, 365]) if (o[`d${N}`] == null) { o[`d${N}`] = y; used = true; }
  if (!used) return pc ?? null;
  o.yld = y;
  o.yldSrc = useE ? 'earn' : 'cost';
  return o;
}

// 东财港股 K线行(fqt=1 前复权,2026-10-08 用户要求「分红要包含」)——腾讯 fqkline 对港股不支持复权,
// qfq/hfq 参数实测都只回原始 day(除息日跳空算成下跌、漏分红)。push2his fields2=f51,f53 → "日期,收盘",
// 折成 periodChg 吃的 [date,开,收,高,低,量] 形态(只用 [0]/[2],其余占位);前复权锚最新真值,币种同为 HKD,与 qt 现价同基准
// OKX K线行 [ts,o,h,l,c,vol,...] → periodChg 吃的 [date,开,收,高,低,量](2026-10-08 币圈列表区间涨跌)
// bar=1D 开盘 ts 为北京 0 点,日期按 +8h 折北京日历日,与 A股腾讯日K同一「自然日」语义
export function okxToPcRows(klines: any[]): any[] {
  return (klines || [])
    .filter((k: any) => Number(k?.[0]) > 0 && +k[4] > 0) // 先滤坏行,NaN ts 会让 toISOString 直接 throw
    .map((k: any) => [new Date(Number(k[0]) + 8 * 3600e3).toISOString().slice(0, 10), String(k[1]), String(k[4]), String(k[2]), String(k[3]), String(k[5])]);
}

export function emHkRows(klines: any[]): any[] {
  return (klines || [])
    .map((s: any) => { const p = String(s).split(','); return [p[0], '0', +p[1], '0', '0', '0']; })
    .filter((r: any) => /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && r[2] > 0);
}

// 东财分红送配(RPT_SHAREBONUS_DET)首行 → 展示字段(2026-10-12 用户要求「分红信息放表格里」)。
// 无报表行(港股/ETF 实测该报表回空)、缺每10股派额或除息日 → null 显 —,宁缺勿假。
// 股息率按现价现算(per10÷10÷price),不用 EM 的 DIVIDENT_RATIO(公告时点价,已滞后)
export function emDiv(row: any, price: number | null) {
  const per10 = Number(row && row.PRETAX_BONUS_RMB);
  const ex = String((row && row.EX_DIVIDEND_DATE) || '').slice(0, 10);
  if (!(per10 > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(ex)) return null;
  const full = String(row.IMPL_PLAN_PROFILE || `10派${per10}元(含税)`);
  return {
    plan: full.split('(')[0], // 列内短形态「10派X元」,(含税,扣税后…)进 title(2026-10-12 用户嫌原样入列不美观)
    full,
    ex,
    yl: price > 0 ? +((per10 / 10 / price) * 100).toFixed(2) : null,
  };
}

export function stockVerdict(
  ind: ReturnType<typeof klineInd>,
  rs: ReturnType<typeof rangeStats>,
) {
  const s: string[] = [];
  let tone: 'up' | 'mid' | 'dn' = 'mid';
  if (ind.maBull && ind.aboveMa20) {
    tone = 'up';
    s.push('均线多头排列,站 MA20 上方');
  } else if (ind.aboveMa20) {
    s.push('MA20 上方,均线仍在修复');
  } else if (ind.ma60 && rs.close < ind.ma60) {
    tone = 'dn';
    s.push('跌破 MA20 且失守 MA60,结构偏弱');
  } else {
    s.push('回落至 MA20 下方,守 MA60 看企稳');
  }
  if (ind.macdUp) s.push('MACD 偏多');
  if (ind.newHigh60) s.push('创 60 日新高');
  if (ind.rsi != null && ind.rsi >= 75) s.push(`RSI ${ind.rsi.toFixed(0)} 超买注意回吐`);
  else if (ind.rsi != null && ind.rsi <= 30) s.push(`RSI ${ind.rsi.toFixed(0)} 超卖观察反抽`);
  if ((ind.vol5_60 ?? 0) >= 2) s.push('量能明显放大');
  if (rs.dd != null && rs.dd >= 35) s.push(`距 120 日高点回撤 ${rs.dd.toFixed(0)}%`);
  return { tone, text: s.join(' · ') };
}

// 合约台账一行 + 标记价 → 浮盈/占用保证金/ROE/强平近似价(维持保证金率按 0.5% 估,页面标「≈」)
export function futMetrics(
  f: { dir: string; entry: number; qty: number; lev: number },
  mark: number | null,
) {
  const long = f.dir !== 'short';
  const margin = f.lev > 0 ? (f.entry * f.qty) / f.lev : null;
  const liq =
    f.lev > 0 && f.entry > 0
      ? long
        ? f.entry * (1 - 1 / f.lev + 0.005)
        : f.entry * (1 + 1 / f.lev - 0.005)
      : null;
  if (mark == null || !isFinite(mark)) {
    return { upnl: null, margin, roe: null, liq, dir: long ? 'long' : 'short' };
  }
  const upnl = (long ? mark - f.entry : f.entry - mark) * f.qty;
  return {
    upnl,
    margin,
    roe: margin ? (upnl / margin) * 100 : null,
    liq,
    dir: long ? 'long' : 'short',
  };
}

// 逻辑变化标签(复盘表的 ✅/🔴/➖):只有技术面出现「实质变化」才打标,附一句原因
export function stockTag(ind: ReturnType<typeof klineInd>, rs: ReturnType<typeof rangeStats>) {
  if (ind.maBull && ind.aboveMa20 && (ind.macdUp || ind.newHigh60))
    return { tag: 'good' as const, why: ind.newHigh60 ? '多头排列 + 创 60 日新高' : '多头排列 + MACD 转偏多' };
  const deepDn = !ind.aboveMa20 && ind.ma60 != null && rs.close < ind.ma60;
  if (deepDn && ((ind.rsi ?? 50) < 35 || (rs.dd ?? 0) >= 35))
    return { tag: 'risk' as const, why: (rs.dd ?? 0) >= 35 ? `跌破 MA60 且距高点 -${(rs.dd as number).toFixed(0)}%` : '跌破 MA60 且 RSI 超卖' };
  return { tag: 'flat' as const, why: '' };
}

// 🎯 四类重点关注(价值+超跌视角)。基本面/新闻无免费逐票源,全部用可复算的技术面代理,页面注明
export function focusOf(rows: Array<any>) {
  // (tsconfig lib 无 flatMap,用 forEach push)
  const pick = (f: (r: any) => string | null) => {
    const out: Array<{ code: string; name: string; why: string }> = [];
    rows.forEach(r => { const w = f(r); if (w) out.push({ code: r.code, name: r.name, why: w }); });
    return out;
  };
  return {
    oversold: pick(r => (r.rs.dd ?? 0) >= 25 && (r.tech.aboveMa20 || (r.tech.ma60 != null && r.rs.close >= r.tech.ma60))
      ? `距高点 -${r.rs.dd.toFixed(0)}%,未破 MA60(形态未坏)` : null),
    lowVal: pick(r => ((r.pe ?? 0) > 0 && r.pe <= 15 && (r.rs.pos ?? 100) <= 30)
      ? `PE ${r.pe.toFixed(1)} · 120 日区 ${r.rs.pos.toFixed(0)}%`
      : ((r.pb ?? 0) > 0 && r.pb < 1 && (r.rs.pos ?? 100) <= 30 ? `PB ${r.pb.toFixed(2)} 破净 · 120 日区 ${r.rs.pos.toFixed(0)}%` : null)),
    improve: pick(r => r.tech.macdUp && (r.tech.chg20 ?? 0) > 5 && (r.rs.pos ?? 100) < 45
      ? `20 日动量 +${r.tech.chg20.toFixed(0)}% 转正,价仍处区间低位` : null),
    risk: pick(r => r.tag === 'risk' ? r.tagWhy : null),
  };
}

// 📌 每日总结三选:最关注(多头里20日动量最强)/最警惕(风险里回撤最深)/超跌等待(回撤最深的未破位)
export function digestOf(rows: Array<any>, focus: ReturnType<typeof focusOf>) {
  const by: Record<string, any> = {}; for (const r of rows) by[r.code] = r;
  const up = rows.filter(r => r.tag === 'good').sort((a, b) => (b.tech.chg20 ?? 0) - (a.tech.chg20 ?? 0))[0];
  const dn = rows.filter(r => r.tag === 'risk').sort((a, b) => (b.rs.dd ?? 0) - (a.rs.dd ?? 0))[0];
  const wait = (focus.oversold || []).map(f => by[f.code]).filter(Boolean).sort((a, b) => (b.rs.dd ?? 0) - (a.rs.dd ?? 0))[0];
  const wrap = (r: any) => (r ? { code: r.code, name: r.name, why: r.tag === 'good' || r.tag === 'risk' ? r.tagWhy : (focus.oversold.find((f: any) => f.code === r.code) || {}).why || '' } : null);
  return { best: wrap(up), watch: wrap(dn), wait: wrap(wait) };
}

function safe<T>(fn: () => Promise<T>) {
  return fn().then(
    data => ({ ok: true as const, data }),
    e => ({ ok: false as const, error: String(e?.message || e) })
  );
}

// 币圈现货报价:OKB 只在 OKX(crypto.service 同款口径),其余走币安镜像→国际站回退
async function spotQuote(sym: string) {
  if (sym === 'OKB') {
    const j = await getJson('https://www.okx.com/api/v5/market/ticker?instId=OKB-USDT', 8000);
    const d = j?.data?.[0];
    if (!d) throw new Error('OKX OKB ticker 为空');
    return {
      price: +d.last,
      chgPct: ((+d.last - +d.open24h) / +d.open24h) * 100,
      high: +d.high24h,
      low: +d.low24h,
    };
  }
  const r = await binance24h(sym + 'USDT');
  return { price: r.price, chgPct: r.chgPct, high: r.high, low: r.low };
}

// 30 日高低区间(复盘「支撑·阻力」用):币安 1d K线;OKB 走 OKX candles(倒序无所谓,取 min/max)
async function binRange(pair: string) {
  const j = await getJson(`https://data-api.binance.vision/api/v3/klines?symbol=${pair}&interval=1d&limit=30`, 6000);
  const k = Array.isArray(j) ? j : [];
  if (!k.length) throw new Error('K线空返');
  return { hi: Math.max(...k.map((x: any) => +x[2])), lo: Math.min(...k.map((x: any) => +x[3])) };
}
async function okxRange(instId = 'OKB-USDT') {
  const j = await getJson(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=1D&limit=30`, 6000);
  const k = Array.isArray(j?.data) ? j.data : [];
  if (!k.length) throw new Error('K线空返');
  return { hi: Math.max(...k.map((x: any) => +x[2])), lo: Math.min(...k.map((x: any) => +x[3])) };
}
async function fngNow() {
  const j = await getJson('https://api.alternative.me/fng/?limit=1', 6000);
  const d = (j?.data || [])[0];
  if (!d) throw new Error('FNG 空返');
  return { value: +d.value, label: d.value_classification };
}

// ---------- OKX 账户(只读 key → 持仓实时化;未配/失败 → 落回手填台账) ----------
// creds:env OKX_API_KEY/OKX_API_SECRET/OKX_API_PASS 优先,否则 ~/.okx_apikey 三行(key/secret/passphrase)
// —— 同 ~/.mx_apikey 路数:chmod 600、不进仓库/plist/argv;launchd 不继承 shell rc,所以文件是主路径
function okxCreds(): { key: string; secret: string; pass: string } | null {
  const e = [process.env.OKX_API_KEY, process.env.OKX_API_SECRET, process.env.OKX_API_PASS];
  let ls: string[] | null = e.every(x => !!x) ? ((e as string[]) as [string, string, string]) : null;
  if (!ls) {
    try {
      const t = readFileSync(join(homedir(), '.okx_apikey'), 'utf8').split('\n').map(x => x.trim()).filter(Boolean);
      if (t.length >= 3) ls = t;
    } catch { /* 无文件 = 未配置 */ }
  }
  return ls ? { key: ls[0], secret: ls[1], pass: ls[2] } : null;
}

// OKX v5 签名:base64(HMAC-SHA256(secret, timestamp + method + requestPath含query + body)),GET 空 body 用空串
export function okxSign(secret: string, ts: string, method: string, path: string, body = '') {
  return createHmac('sha256', secret).update(ts + method + path + body).digest('base64');
}

async function okxGet(c: { key: string; secret: string; pass: string }, path: string) {
  const ts = new Date().toISOString();
  const j: any = await getJson('https://www.okx.com' + path, 8000, {
    'OK-ACCESS-KEY': c.key,
    'OK-ACCESS-SIGN': okxSign(c.secret, ts, 'GET', path),
    'OK-ACCESS-TIMESTAMP': ts,
    'OK-ACCESS-PASSPHRASE': c.pass,
  });
  if (j?.code !== '0') throw new Error(`OKX ${j?.code || '?'}: ${j?.msg || '请求失败'}`);
  return j;
}

// /account/balance → 现货行:eqUsd 即权益市值(统一账户:eq=cash+upl+liab,合约未实现盈亏已摊入,
// totalEq=ΣeqUsd,实测),latestPrice 即现价;upl 字段透传供走势扣减(曲线自行建模浮盈,勿双加)。
// ⚠️ 实测:该字段组没有 bal(非统一/部分模式),数量在 availBal+frozenBal——两版都兜住
export function mapOkxBalance(j: any) {
  const det: any[] = j?.data?.[0]?.details || [];
  return det
    .map((d: any) => {
      const qty = Number(d.bal) || +(Number(d.availBal || 0) + Number(d.frozenBal || 0)).toFixed(8);
      return { sym: String(d.ccy), qty, price: +d.latestPrice || null, value: +d.eqUsd || null, upl: +d.upl || 0 };
    })
    // 尘埃过滤:OKX 会给每个持过币回一行(哪怕 $0.000001);<$1 不算持仓,否则表被 20 行垃圾刷满
    .filter((r: any) => (r.value || 0) >= 1)
    .sort((a: any, b: any) => (b.value || 0) - (a.value || 0));
}

// 公开全量现货行情 → {SYM:{price,chgPct}}(资金账户/理财的币没有账户真值价,一次拉齐,免逐币请求)
async function okxPxMap() {
  const j = await getJson('https://www.okx.com/api/v5/market/tickers?instType=SPOT', 10000);
  const m: Record<string, { price: number | null; chgPct: number | null }> = {};
  for (const t of j?.data || []) {
    const s = String(t.instId || '').split('-');
    if (s[1] === 'USDT' && !m[s[0]]) {
      const last = +t.last, open = +t.open24h;
      m[s[0]] = { price: last || null, chgPct: last && open ? ((last - open) / open) * 100 : null };
    }
  }
  return m;
}

// /asset/balances(资金账户)→ 现货形状行(挂 acct:'funding' 标「资金」);价来自公开 pxMap,无 USDT 对/<$1 剔除
// exclude:与赚币产品端点重复的 ccy(大写集合)——SOL/ETH 质押的 OKSOL/BETH 同时出现在
// /asset/balances 与 staking-defi/*/balance(数量分毫不差,同一笔资产两个视图),资金账户行里剔掉,
// 留赚币行为权威(2026-09-24 用户抓包「今日收益排行两行一模一样的 OKSOL」)
export function mapOkxFund(j: any, px: Record<string, any>, exclude?: Set<string>) {
  return (j?.data || [])
    .map((d: any) => {
      const p = px[String(d.ccy).toUpperCase()] || {};
      const qty = Number(d.availBal) + Number(d.frozenBal || 0);
      return { sym: String(d.ccy), acct: 'funding', qty: +qty.toFixed(8), price: p.price ?? null, chgPct: p.chgPct ?? null, value: p.price ? +(p.price * qty).toFixed(2) : null, cost: null, rng: null };
    })
    .filter((r: any) => !exclude || !exclude.has(String(r.sym).toUpperCase()))
    .filter((r: any) => (r.value || 0) >= 1)
    .sort((a: any, b: any) => (b.value || 0) - (a.value || 0));
}

// /finance/savings/balance(活期理财 Simple Earn)→ {sym,qty,price,chgPct,value,apy,earnings(币),earnUsd};earnings=OKX 给的申购以来累计利息
export function mapOkxEarn(j: any, px: Record<string, any>) {
  return (j?.data || [])
    .map((d: any) => {
      const p = px[String(d.ccy).toUpperCase()] || {};
      const gnc = Number(d.earnings) || 0;
      return {
        sym: String(d.ccy), qty: Number(d.amt) || 0, price: p.price ?? null, chgPct: p.chgPct ?? null,
        value: p.price ? +(p.price * (Number(d.amt) || 0)).toFixed(2) : null,
        apy: d.rate != null && isFinite(+d.rate) ? +d.rate * 100 : null,
        earnings: +gnc.toFixed(8), earnUsd: p.price ? +(p.price * gnc).toFixed(2) : null,
      };
    })
    .filter((r: any) => r.qty > 0)
    .sort((a: any, b: any) => (b.value || 0) - (a.value || 0));
}

// 闪赚(campaign 锁定)无公开余额 API:探测 /finance/flash-earn/balance 回 7002(要登录态,不吃 API key),
// OKX 官方 Agent Trade Kit 也只做 projects 查询。能拿到的权威汇总只有 /asset/asset-valuation 的 details.earn
// (理财全盘总额,含闪赚/定期/未上现货的对冲品)。把 earn 与逐行已折价求和的差额补成一行「闪赚(估算)」,
// 页面理财总额即与 App 对上;≤5U 不进(全是价格时点差)。数量列如实留空——OKX 不逐币回明细,不编数。
export function earnResidual(rows: any[], earnTotal: number | null): any[] {
  const t = Number(earnTotal);
  if (!isFinite(t) || t <= 0) return [];
  const gap = +(t - rows.reduce((a, r) => a + (r.value || 0), 0)).toFixed(2);
  return gap > 5 ? [{ sym: '闪赚(估算)', qty: null, price: null, chgPct: null, value: gap, apy: null, earnings: null, earnUsd: gap }] : [];
}

// 尘埃币统一口径:可折算价值 <1U 剔出列表/合计/走势(现货·理财·合约都过这一道;
// mapOkxBalance/mapOkxFund 在映射时已各自剔过 <1,这里是共用的最终兜底,覆盖 earn 与台账路径;无价行 value 为 null 不算尘埃)
export function dropDust(rows: any[]): any[] {
  return (rows || []).filter((r: any) => {
    const v = r.value != null ? r.value : r.mark != null && r.qty != null ? r.mark * r.qty : null;
    return !(v != null && v < 1);
  });
}

// /account/positions → 合约行:OKX 直接回 upl/avgPx/liqPx/uplRatio,比 futMetrics 本地近似准;
// 数量按 名义USD/标记价 折算(pos 是张数,ctVal 各异,这样免拉 instruments)
export function mapOkxPositions(j: any) {
  const list: any[] = j?.data || [];
  return list
    .filter((p: any) => p?.instType === 'SWAP' && Math.abs(Number(p.pos)) > 0)
    .map((p: any) => {
      const pos = Number(p.pos);
      const mark = +p.markPx || null;
      const notional = Math.abs(+p.notionalUsd || 0);
      const lev = +p.lever || null;
      return {
        sym: String(p.instId || '').split('-')[0],
        dir: p.posSide === 'short' || (p.posSide == null && pos < 0) ? 'short' : 'long',
        entry: +p.avgPx || null,
        mark,
        qty: mark && notional ? +(notional / mark).toFixed(6) : Math.abs(pos),
        lev,
        upnl: +p.upl || 0,
        margin: lev && notional ? notional / lev : null,
        roe: p.uplRatio != null && isFinite(+p.uplRatio) ? +p.uplRatio * 100 : null,
        liq: +p.liqPx || null,
        ctime: +p.cTime || null, // OKX 回建仓时间ms;转入/历史仓可能无
        openDay: +p.cTime ? new Date(+p.cTime + 8 * 3600e3).toISOString().slice(0, 10) : null, // 北京日历日,前端区间列 title 用
      };
    });
}

// 总资产走势合成(纯函数,可单测):对每个K线时刻 t 用「当前持仓数量」回溯估算市值——
// v(t) = USDT数量 + Σ(币数量×收盘价t) + Σ(合约浮盈t);usdtQty 含闪赚估算/缺K线行的「常量资产值」(调用方并入);各序列共用时间轴、价格前向填充,
// 币首根K线之前不计该币。⚠️ 保证金不加回:全仓保证金就是被冻结的 USDT,已含在 usdtQty/eqUsd 里(实测
// details.USDT frozen≈Σpositions.margin),再加会重复(2026-09 对账修正,总资产口径同此)。
// ⚠️ 这是按当前持仓的估算曲线,不是历史真实净值(系统无每日快照台账)。
export function equityFromCandles(
  coins: Array<{ qty: number; series: Array<[number, number]> }>,
  usdtQty: number,
  fut: Array<{ qty: number; entry: number; dir: string; margin: number; series: Array<[number, number]> }>
): Array<{ t: number; v: number }> {
  const all: Array<any> = [...coins, ...fut];
  const tsSet = new Set<number>();
  for (const s of all) for (const [t] of s.series) tsSet.add(t);
  const ts = Array.from(tsSet).sort((a, b) => a - b);
  const ptr = all.map(() => -1); // 每条序列的前向填充指针(series 已按时间升序)
  const out: Array<{ t: number; v: number }> = [];
  for (const t of ts) {
    let v = usdtQty;
    all.forEach((s, i) => {
      while (s.series[ptr[i] + 1] && s.series[ptr[i] + 1][0] <= t) ptr[i]++;
      if (ptr[i] < 0) return;
      const px = s.series[ptr[i]][1];
      v += s.entry != null ? (s.dir === 'long' ? px - s.entry : s.entry - px) * s.qty : s.qty * px;
    });
    out.push({ t, v: +v.toFixed(2) });
  }
  return out;
}

const CRYPTO_FILE = resolve(process.cwd(), 'data/crypto_holdings.json');

// ---------- 演示账号构造器(2026-09-22 用户要求,取代旧 demoSwr×上游路数) ----------
// 写死底数(DEMO_STK/DEMO_CRY)× 随机抖动:纯本地计算毫秒回、零上游请求,每次读数字都在小幅波动 = 「看起来实时」。
// 判定/合计不双实现:verdict/tag 复用 stockVerdict/stockTag,focus/digest 复用 focusOf/digestOf,合约复用 futMetrics。
// ponytail:抖动是无状态的,要「同一分钟数字一致」再按 Date.now()/60000 播种替换 Math.random
const rnd = (amp: number) => (Math.random() * 2 - 1) * amp;
const jit = (x: number, p = 0.005) => x * (1 + rnd(p));
const STABLE: Record<string, number> = { USDT: 1, USDC: 0.999 }; // 稳定币不抖价
const demoPx = (sym: string, base: number) => +(STABLE[sym] != null ? STABLE[sym] : jit(base)).toFixed(base < 1 ? 4 : 2);
function demoTime() {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

// /api/holding/quotes 演示行(形状同真路径 {code,name,market,ok,...qt字段})
export function demoQuotes() {
  const time = demoTime();
  return DEMO_STK.map(s => {
    const price = +jit(s.price).toFixed(2);
    const chgPct = +(s.chgPct + rnd(0.35)).toFixed(2);
    return {
      code: s.code, name: s.name, market: s.market, ok: true,
      price, chg: +((price * chgPct) / (100 + chgPct)).toFixed(2), chgPct, time,
      pe: +jit(s.pe, 0.01).toFixed(1), pb: +jit(s.pb, 0.01).toFixed(2),
    };
  });
}

// /api/holding/analysis 演示载荷:逐只行(tech 固定故事+数值抖)→ verdict/tag/focus/digest 全走真函数
export function demoAnalysis() {
  const time = demoTime();
  const rows = DEMO_STK.map(s => {
    const price = +jit(s.price).toFixed(2);
    const chgPct = +(s.chgPct + rnd(0.35)).toFixed(2);
    const tech = { ...s.tech, rsi: +jit(s.tech.rsi, 0.02).toFixed(1), vol5_60: +jit(s.tech.vol5_60, 0.04).toFixed(2), chg20: +(s.tech.chg20 + rnd(0.8)).toFixed(1) };
    const dd = +Math.max(0.5, s.dd + rnd(1)).toFixed(1);
    const pos = +Math.min(99, Math.max(1, s.pos + rnd(2))).toFixed(0);
    const hi = price / (1 - dd / 100);
    const rs = { hi: +hi.toFixed(2), lo: +(price - ((hi - price) * pos) / (100 - pos)).toFixed(2), close: price, pos, dd };
    const st = stockTag(tech as any, rs as any);
    return {
      code: s.code, name: s.name, market: s.market,
      price, chg: +((price * chgPct) / (100 + chgPct)).toFixed(2), chgPct, time,
      pe: +jit(s.pe, 0.01).toFixed(1), pb: +jit(s.pb, 0.01).toFixed(2),
      // 演示区间涨跌:位置越高→长周期越强的稳定故事 × 小抖动(同「技术布尔写死」思路,不构成漂移翻转)
      pc: { d7: +(s.tech.chg20 * 0.3 + rnd(1)).toFixed(1), d30: +(s.tech.chg20 + rnd(1.5)).toFixed(1), d90: +(s.pos * 0.4 - 18 + rnd(2)).toFixed(1), d180: +(s.pos * 0.6 - 25 + rnd(3)).toFixed(1), d365: +(s.pos * 0.8 - 30 + rnd(4)).toFixed(1) },
      tech, rs, verdict: stockVerdict(tech as any, rs as any), tag: st.tag, tagWhy: st.why,
    };
  });
  const idxPick = (n: string, pct: number) => ({ n, pct: +(pct + rnd(0.15)).toFixed(2) });
  const focus = focusOf(rows);
  return {
    rows,
    overview: {
      idx: [idxPick('上证', 0.35), idxPick('深成', -0.22), idxPick('创业板', 0.68)],
      up: rows.filter(r => r.chgPct > 0).length,
      down: rows.filter(r => r.chgPct < 0).length,
      changed: rows.filter(r => r.tag !== 'flat').length,
    },
    focus,
    digest: digestOf(rows, focus),
  };
}

// /api/holding/crypto 演示载荷:现货(交易+资金)/理财/合约,合计现算;source:'demo' 供前端数据源卡点名
export function demoCrypto() {
  const priceOf: Record<string, number> = {};
  const chgOf: Record<string, number> = {};
  const mk = (r: any, acct: string) => {
    const price = demoPx(r.sym, r.price);
    const chgPct = +(r.chgPct + rnd(0.4)).toFixed(2);
    priceOf[r.sym] = price;
    chgOf[r.sym] = chgPct;
    return {
      sym: r.sym, acct, qty: r.qty, price, chgPct,
      value: +(price * r.qty).toFixed(2), cost: r.cost != null ? r.cost : null, rng: null,
    };
  };
  const spot = DEMO_CRY.spot.map(r => mk(r, 'trading')).concat(DEMO_CRY.fund.map(r => mk(r, 'funding')));
  const earn = DEMO_CRY.earn.map(r => {
    const price = priceOf[r.sym] || null;
    const earnings = +jit(r.earnings, 0.01).toFixed(6);
    return { sym: r.sym, qty: r.qty, price, chgPct: chgOf[r.sym] ?? null, value: price ? +(price * r.qty).toFixed(2) : null, apy: +jit(r.apy, 0.03).toFixed(2), earnings, earnUsd: price ? +(price * earnings).toFixed(2) : null };
  });
  const fut = DEMO_CRY.fut.map(r => {
    const mark = priceOf[r.sym] || demoPx(r.sym, r.entry);
    const fm = futMetrics({ dir: r.dir, entry: r.entry, qty: r.qty, lev: r.lev }, mark);
    return {
      sym: r.sym, dir: fm.dir, entry: r.entry, mark, qty: r.qty, lev: r.lev,
      funding: +(r.funding * (1 + rnd(0.2))).toFixed(6),
      upnl: fm.upnl != null ? +fm.upnl.toFixed(2) : null,
      margin: fm.margin != null ? +fm.margin.toFixed(2) : null,
      roe: fm.roe != null ? +fm.roe.toFixed(1) : null, liq: fm.liq != null ? +fm.liq.toFixed(2) : null, rng: null,
    };
  });
  const num = (x: any) => (x == null || !isFinite(x) ? 0 : x);
  const fng = Math.round(jit(DEMO_CRY.fng, 0.06));
  return {
    source: 'demo', fx: +jit(DEMO_CRY.fx, 0.002).toFixed(4), sub: null,
    spot, fut, earn,
    sentiment: { value: fng, label: fng >= 55 ? 'Greed' : fng <= 45 ? 'Fear' : 'Neutral' },
    totals: (() => {
      const spotUsd = +spot.reduce((a, r) => a + num(r.value), 0).toFixed(2);
      const futUpnl = +fut.reduce((a, r) => a + num(r.upnl), 0).toFixed(2);
      const earnUsd = +earn.reduce((a, r) => a + num(r.value), 0).toFixed(2);
      return {
        spotUsd,
        futUpnl,
        futMargin: +fut.reduce((a, r) => a + num(r.margin), 0).toFixed(2),
        earnUsd,
        earnGnc: +earn.reduce((a, r) => a + num(r.earnUsd), 0).toFixed(2),
        partial: false,
      };
    })(),
  };
}

// /api/holding/crypto/history 演示载荷:随机游走净值曲线 + 逐币 24h spark(形状同 equityFromCandles 真路径)
export function demoHistory(r: string) {
  const P: Record<string, [string, number, number]> = { '1d': ['1H', 25, 3600e3], '7d': ['4H', 43, 14400e3], '30d': ['1D', 32, 86400e3], '1y': ['1W', 54, 604800e3] };
  const pr = P[r] || P['1d'];
  const now = Date.now();
  let v = 47000 + rnd(1500);
  const points: Array<{ t: number; v: number }> = [];
  for (let i = 0; i < pr[1]; i++) { v *= 1 + rnd(0.012) + 0.001; points.push({ t: now - (pr[1] - 1 - i) * pr[2], v: +v.toFixed(2) }); }
  const spark: Record<string, Array<[number, number]>> = {};
  for (const row of [...DEMO_CRY.spot, ...DEMO_CRY.fund]) {
    let p = STABLE[row.sym] != null ? STABLE[row.sym] : row.price;
    const s: Array<[number, number]> = [];
    for (let i = 0; i < 25; i++) { p *= 1 + rnd(0.006); s.push([now - (24 - i) * 3600e3, +(STABLE[row.sym] != null ? p.toFixed(3) : p.toFixed(row.price < 1 ? 4 : 2))]); }
    spark[row.sym] = s;
  }
  return { r, bar: pr[0], points, spark, missing: [] };
}

@Provide()
export class HoldingService {
  @InjectEntityModel(Holding, 'datasource1')
  holdingRepo: Repository<Holding>;

  @Inject()
  qtService: QtService;

  // 复盘格式输出:逐只(报价+PE/PB+120日K技术面+简评+逻辑标签)+ 市场概况 + 🎯四类 + 📌总结
  // 2026-09-22 用户要求:持仓板块不走缓存,每次实时直连(qt 传 fresh=true 跳过其 60s 层,回包仍灌入供他页用);demo=写死假数据
  async analysis(demo = false) {
    if (demo) return demoAnalysis();
    const rows: Array<{ code: string; name: string; market: string }> = await this.holdingRepo.find({ order: { id: 'ASC' } });
    const codes = rows.map(r => quoteCode(r.code, r.market));
    let qm: Record<string, any> = {}, idxm: Record<string, any> = {};
    try { qm = await this.qtService.quotes(codes, true); } catch { /* 缺列照常渲染 */ }
    try { idxm = await this.qtService.quotes(['sh000001', 'sz399001', 'sz399006'], true); } catch {}
    const out: any[] = await Promise.all(
      rows.map(async (r, i) => {
        const q = qm[codes[i]] || {};
        const isHk = String(r.market).indexOf('港') >= 0;
        const base = {
          code: r.code, name: r.name, market: r.market,
          price: q.price ?? null, chg: q.chg ?? null, chgPct: q.chgPct ?? null, time: q.time ?? '',
          pe: q.pe ?? null, pb: q.pb ?? null,
          // 2026-10-28 并入 A股页统一表:市值/成交额字段与 market.watch 行同名(qt f44/f37)。
          // ⚠️ 港股 qt 列位与 A股异构(f44/f37 在港行实测是别的量纲,曾显出「李宁成交 4万亿」)→ 港股恒 null 显 —,宁缺勿假
          mcap: isHk ? null : q.mcapYi ?? null, amt: isHk || q.amountWan == null ? null : q.amountWan / 1e4,
        };
        const tc = codes[i];
        return safe(async () => {
          // 分红(2026-10-12 用户要求入表):东财 datacenter RPT_SHAREBONUS_DET 免key、取最新除息一条。
          // 实测港股/ETF 该报表回空 → div=null;与日K并发、单独 safe,失败只让该列显 —
          const dvP: any = isHk ? null : safe(() => getJson(
            `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET&columns=ALL&pageSize=1&sortColumns=EX_DIVIDEND_DATE&sortTypes=-1&filter=(SECURITY_CODE%3D%22${tc.slice(2)}%22)`, 9000
          ));
          // 320 根 ≈ 覆盖 365 自然日(一年涨跌幅);rangeStats 截末 120 保持「120日区」语义不变
          const j = await getKlineJson(
            `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tc},day,,,320,qfq`, 9000
          );
          const raw = j?.data?.[tc]?.qfqday || j?.data?.[tc]?.day || [];
          const bars = parseTencentKline(raw);
          if (bars.length < 61) throw new Error(`日K不足(${bars.length} 根,klineInd 需 ≥61)`);
          const tech = klineInd(bars);
          const rs = rangeStats(bars.slice(-120));
          const st = stockTag(tech, rs);
          // 区间涨跌一律用复权序列(含分红):A股=腾讯 qfq;港股腾讯不复权(只回原始 day,除息被算成下跌)
          // → 走东财 fqt=1,挂则 pc=null 显 —(宁缺勿假,不给漏分红的数)
          let pc: any = periodChg(raw, q.price ?? null);
          if (isHk) {
            const em: any = await safe(() =>
              // ⚠️ beg=0 必带(实测省略 beg 时 200 也回空 klines 空壳;带上后 lmt 失效回全量,periodChg 自会按日期窗取基准)
              getJson(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=116.${tc.slice(2)}&klt=101&fqt=1&beg=0&end=20500101&fields1=f1,f2,f3&fields2=f51,f53`, 9000)
            );
            pc = em.ok && em.data?.data?.klines?.length ? periodChg(emHkRows(em.data.data.klines), q.price ?? null) : null;
          }
          const dv: any = dvP ? await dvP : { ok: false };
          const div = dv.ok ? emDiv(dv.data?.result?.data?.[0], q.price ?? null) : null;
          return { tech, rs, pc, div, verdict: stockVerdict(tech, rs), tag: st.tag, tagWhy: st.why };
        }).then((x: any) => (x.ok ? { ...base, ...x.data } : { ...base, error: x.error }));
      })
    );
    const ana = out.filter(r => r.tech);
    const focus = focusOf(ana);
    const idxPick = (n: string, c: string) => ({ n, pct: idxm[c]?.chgPct ?? null });
    return {
      rows: out,
      overview: {
        idx: [idxPick('上证', 'sh000001'), idxPick('深成', 'sz399001'), idxPick('创业板', 'sz399006')],
        up: out.filter(r => (r.chgPct ?? 0) > 0).length,
        down: out.filter(r => (r.chgPct ?? 0) < 0).length,
        changed: ana.filter(r => r.tag !== 'flat').length,
      },
      focus,
      digest: digestOf(ana, focus),
    };
  }

  // 子账号余额(独立账户,不计入主总资产,仅页面标注):list→逐个 /account/subaccount/balances 的 totalEq
  async okxSubBalances(c: any) {
    const list = await okxGet(c, '/api/v5/users/subaccount/list?limit=100');
    const subs = (list?.data || []).filter((s: any) => s.enable !== false);
    const rows = await Promise.all(
      subs.map(async (s: any) => {
        const name = String(s.subAcct || s.label || '?');
        const bal: any = await safe(() => okxGet(c, `/api/v5/account/subaccount/balances?subAcct=${encodeURIComponent(name)}`));
        const eq = Number(bal.ok ? bal.data?.data?.[0]?.totalEq : null);
        return { name, usd: isFinite(eq) ? eq : null };
      })
    );
    return { count: subs.length, usd: rows.reduce((a: number, r: any) => a + (r.usd || 0), 0), rows };
  }

  // OKX 实时账户(只读 key):现货余额 + 合约持仓,数量/开仓价/浮盈/强平全是账户真值
  async okxLive() {
    const c = okxCreds();
    if (!c) throw new Error('未配置 OKX 只读 key(~/.okx_apikey)');
    const bal = await okxGet(c, '/api/v5/account/balance');
    const pos = await okxGet(c, '/api/v5/account/positions?instType=SWAP');
    // 资金账户 + 活期理财 + 质押赚币/OKUSD + 公开价表并发、各自 safe:任何一路挂只少一块,不拖垮交易账户主数据
    const [fundJ, earnJ, stkJ, valJ, pxJ, subJ] = await Promise.all([
      safe(() => okxGet(c, '/api/v5/asset/balances')),
      safe(() => okxGet(c, '/api/v5/finance/savings/balance?savingType=ordinary')),
      // 2026-09-21 用户抓包「赚币/闪赚没取到」:SOL/ETH 质押赚币与 OKUSD 不在 savings/balance,是独立端点。
      // 行归一成 savings 形态({ccy,amt,earnings})复用 mapOkxEarn;OKSOL/BETH 有 OKX 现货对可折价,OKUSD 未上现货(有持仓则 value=null 只缺市值不缺口径)
      safe(async () => {
        const out: any[] = [];
        for (const p of [
          '/api/v5/finance/staking-defi/sol/balance',
          '/api/v5/finance/staking-defi/eth/balance',
          '/api/v5/finance/okusd/account',
        ]) {
          const j = await okxGet(c, p).catch(() => null);
          for (const d of j?.data || []) out.push({ ccy: d.ccy, amt: d.amt, earnings: d.totalInterestAccrual });
        }
        if (!out.length) throw new Error('质押/OKUSD 端点无行');
        return out;
      }),
      // 理财全盘总额(闪赚无余额 API 的兜底口径,见 earnResidual)
      safe(() => okxGet(c, '/api/v5/asset/asset-valuation?ccy=USDT')),
      safe(okxPxMap),
      safe(() => this.okxSubBalances(c)),
    ]);
    const px = pxJ.ok ? pxJ.data : {};
    // 质押币种与资金账户余额是同笔资产的两个视图(见 mapOkxFund exclude 注释),资金账户行去重
    const stkSyms = new Set((stkJ.ok ? stkJ.data : []).filter((d: any) => Number(d.amt) > 0).map((d: any) => String(d.ccy).toUpperCase()));
    const fund: any[] = fundJ.ok ? mapOkxFund(fundJ.data, px, stkSyms) : [];
    // 资金账户原始合计(未剔质押币,<1U 尘埃仍剔)与质押双视图行——2026-10-08 用户拍板照 App:
    // 资金格显原始合计、总资产大字/环图把被去重的质押行再计一次(fundDup);持仓列表/排行仍只一行(09-24 防双行,勿动)
    const fundRawRows: any[] = fundJ.ok ? mapOkxFund(fundJ.data, px) : [];
    const fundRaw = fundJ.ok ? +fundRawRows.reduce((s: number, r: any) => s + (r.value || 0), 0).toFixed(2) : null;
    const fundDup = fundRawRows.filter((r: any) => stkSyms.has(String(r.sym).toUpperCase()));
    const priced: any[] = [
      ...(earnJ.ok ? mapOkxEarn(earnJ.data, px) : []),
      ...(stkJ.ok ? mapOkxEarn({ data: stkJ.data }, px) : []),
    ];
    const earn = priced
      .concat(earnResidual(priced, valJ.ok ? Number(valJ.data?.data?.[0]?.details?.earn) : null))
      .sort((a, b) => (b.value || 0) - (a.value || 0));
    const spot = await Promise.all(
      mapOkxBalance(bal).map(async h => {
        // 24h 涨跌/30日区间/加权成本单价逐个并发,safe 包住——挂项留空不拖累整行(现价市值本就是账户真值)
        const [q, rg, cost] = await Promise.all([
          safe(() => spotQuote(h.sym)),
          safe(() => (h.sym === 'OKB' ? okxRange('OKB-USDT') : binRange(h.sym + 'USDT'))),
          safe(async () => {
            // ⚠️ 成本字段是 accAvgPx 且只在 /account/balance?ccy=单币 时回(balance/details 端点不存在=404);
            // 转入/空投币 OKX 无买入成本记录 → 空,属正常,不是 bug
            const d = await okxGet(c, `/api/v5/account/balance?ccy=${h.sym}`);
            const a = Number(d?.data?.[0]?.details?.[0]?.accAvgPx);
            return a > 0 ? a : null;
          }),
        ]);
        const price = h.price ?? (q.ok ? (q.data as any).price : null);
        return {
          sym: h.sym, acct: 'trading', qty: h.qty, price,
          chgPct: q.ok ? (q.data as any).chgPct : null,
          value: h.value ?? (price != null && h.qty ? price * h.qty : null),
          upl: h.upl, // 合约浮盈已摊入 eqUsd,透传给走势扣减(勿双加)
          cost: cost.ok ? cost.data : null, // 成本单价,与台账口径一致(前端 (price-cost)*qty 算浮盈)
          rng: rg.ok ? rg.data : null,
        };
      })
    );
    const fut = await Promise.all(
      mapOkxPositions(pos).map(async f => {
        const instId = `${f.sym}-USDT-SWAP`;
        const [fr, rg] = await Promise.all([
          safe(async () => Number((await getJson(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`, 6000))?.data?.[0]?.fundingRate)),
          safe(() => okxRange(instId)),
        ]);
        return { ...f, funding: fr.ok && isFinite(fr.data) ? fr.data : null, rng: rg.ok ? rg.data : null };
      })
    );
    // 列表区间涨跌(2026-10-08 用户要求 1D/7/30/90/180/1年,与 A股表同 periodChg 口径):OKX 公共日K 300 根,
    // 满 290 再翻 1 页 history-candles 凑够 365 天;稳定币/非代码 sym(闪赚估算)不拉;逐币失败只让 pc=null 显 —
    const pcAll: any[] = (spot as any[]).concat(fund, earn, fut);
    const pcSyms = Array.from(new Set(
      pcAll.map((r: any) => String(r.sym || ''))
        .filter(s => /^[A-Z][A-Z0-9]{1,9}$/.test(s) && !/^(USDT|USDC|USD1|DAI|FDUSD|TUSD|PYUSD|EURT)$/.test(s))
    ));
    const pcMap: Record<string, any> = {};
    for (let i = 0; i < pcSyms.length; i += 5) {
      await Promise.all(pcSyms.slice(i, i + 5).map(async s => {
        const pr = await safe(async () => {
          const j1: any = await getJson(`https://www.okx.com/api/v5/market/candles?instId=${s}-USDT&bar=1D&limit=300`, 8000);
          const raw: any[] = j1?.data || []; // ⚠️ getJson 回裸 body {code,data:[行]}——勿按 safe() 的 {ok,data=body} 双剥(曾 pc 恒 null)
          let rows = okxToPcRows(raw);
          if (raw.length >= 290) {
            const j2: any = await getJson(`https://www.okx.com/api/v5/market/history-candles?instId=${s}-USDT&bar=1D&limit=100&after=${raw[raw.length - 1][0]}`, 8000);
            rows = rows.concat(okxToPcRows(j2?.data || [])); // 同 j1:getJson 回裸 body,勿按 safe() 双剥(曾致 300 根外的 180日/1年恒 null)
          }
          if (!rows.length) throw new Error('无日K');
          return periodChg(rows, px[s]?.price ?? null);
        });
        pcMap[s] = pr.ok ? pr.data : null;
      }));
    }
    for (const r of pcAll) r.pc = futPcTrim(pcYield(pcMap[String(r.sym)] ?? null, r), r);
    // 总资产口径(2026-09-30 用户三改:页面 = Σ各行权益,eqUsd 已含浮盈、勿再另加 futUpnl;
    // 09-24 版「按币种、不管在哪个账户」不变)——不再下发 acct(app valuation details.{trading,funding,earn} 之和双计质押币:
    // details.funding≈同一笔 OKSOL+尘埃、details.earn 又含 OKSOL,三账户和虚高 ≈整笔质押额。
    // 教训保留:totalEq=ΣeqUsd=cash+已摊未实现盈亏(「另加 futUpnl」是双计);资金/赚币同笔资产已由 mapOkxFund exclude 去重。
    return { spot, fut, fund, earn, fundRaw, fundDup, sub: subJ.ok ? subJ.data : null };
  }

  // 手填台账(data/crypto_holdings.json)→ 与 okxLive 同形状的 {spot,fut}(兜底路径,cost=单价)
  // cfg 可注入(演示账号传假台账 DEMO_CRYPTO,不读真实文件)
  ledgerCrypto(cfg?: { spot?: any[]; fut?: any[] }) {
    const raw = cfg || JSON.parse(readFileSync(CRYPTO_FILE, 'utf8'));
    const spot: any[] = Array.isArray(raw.spot) ? raw.spot : [];
    const fut: any[] = Array.isArray(raw.fut) ? raw.fut : [];
    const spotRows: any[] = spot.map(p => ({
      sym: String(p.sym || '?').toUpperCase(), qty: Number(p.qty) || 0,
      price: null, chgPct: null, value: null,
      cost: p.cost != null ? Number(p.cost) : null, rng: null,
      error: '报价随实时路径获取(台账兜底无价)',
    }));
    const futRows: any[] = fut.map(f => {
      const fm = futMetrics(
        { dir: f.dir, entry: Number(f.entry) || 0, qty: Number(f.qty) || 0, lev: Number(f.lev) || 0 }, null
      );
      return {
        sym: String(f.sym || '').toUpperCase(), dir: fm.dir, entry: Number(f.entry) || null,
        qty: Number(f.qty) || 0, lev: Number(f.lev) || null, mark: null, funding: null,
        upnl: null, margin: fm.margin, roe: null, liq: fm.liq, rng: null, error: '待实时价(走 okxLive)',
      };
    });
    return { spot: spotRows, fut: futRows };
  }

  // 币圈持仓:优先 OKX 实时账户,未配 key/请求失败 → 手填台账 × 公开报价兜底
  // 2026-09-22 用户要求:不走缓存,每次实时直连;demo=演示账号回写死假数据(零上游请求)
  private cryFly: Promise<any> | null = null; // 单飞合并:/crypto 与 history 端点内部 crypto() 同刻并发时只打一发上游(合并发请求,非缓存,先后请求仍各自重取)
  async crypto(demo = false) {
    if (demo) return demoCrypto();
    if (!this.cryFly) this.cryFly = this.cryptoLive().finally(() => (this.cryFly = null));
    return this.cryFly;
  }

  private async cryptoLive() {
    const num = (x: any) => (x == null || !isFinite(x) ? 0 : x);
    // fx = OKX 快捷买币同源的法币汇率(USDT→CNY,公共免签);挂了就 null,前端退回美元显示
    const [sent, live, fxEnv]: any[] = await Promise.all([
      safe(fngNow),
      safe(() => this.okxLive()),
      safe(() => getJson('https://www.okx.com/api/v5/market/exchange-rate?baseCcy=USDT&quoteCcy=CNY', 6000)),
    ]);
    const sentiment: any = sent.ok ? sent.data : null;
    const fx = fxEnv.ok ? Number(fxEnv.data?.data?.[0]?.usdCny) || null : null;
    let spotRows: any[]; let futRows: any[]; let earnRows: any[] = [];
    if (live.ok) {
      // 现货表 = 交易账户 + 资金账户(行带 acct 标记);理财单表
      spotRows = live.data.spot.concat(live.data.fund || []); futRows = live.data.fut;
      earnRows = live.data.earn || [];
    } else {
      // 兜底:台账数量/开仓价 × 公开报价(逐币并发,区间失败不拖累报价)
      const lg = this.ledgerCrypto();
      spotRows = await Promise.all(
        lg.spot.map(async r => {
          const q: any = await safe(() => spotQuote(r.sym));
          const rg: any = await safe(() => (r.sym === 'OKB' ? okxRange('OKB-USDT') : binRange(r.sym + 'USDT')));
          if (!q.ok) return { ...r, rng: rg.ok ? rg.data : null, error: q.error };
          return {
            ...r, chgPct: q.data.chgPct, price: q.data.price,
            value: q.data.price * (r.qty || 0), rng: rg.ok ? rg.data : null, error: undefined,
          };
        })
      );
      futRows = await Promise.all(
        lg.fut.map(async r => {
          let env = await safe(async () => {
            const j = await getJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${r.sym}USDT`, 6000);
            return { mark: j?.markPrice != null ? +j.markPrice : null, funding: j?.lastFundingRate != null ? +j.lastFundingRate : null };
          });
          if (!env.ok || env.data.mark == null) {
            env = await safe(async () => ({ mark: (await spotQuote(r.sym)).price, funding: null })); // fapi 挂 → 现货价兜底
          }
          const px = env.ok ? env.data.mark : null;
          const rg: any = await safe(() => binRange(r.sym + 'USDT'));
          const fm = futMetrics(
            { dir: r.dir, entry: r.entry || 0, qty: r.qty || 0, lev: r.lev || 0 }, px
          );
          return {
            ...r, mark: px, funding: env.ok ? env.data.funding : null,
            upnl: fm.upnl, roe: fm.roe, liq: fm.liq, rng: rg.ok ? rg.data : null,
            error: px == null ? (!env.ok ? (env as any).error : '无价') : undefined,
          };
        })
      );
    }
    spotRows = dropDust(spotRows); futRows = dropDust(futRows); earnRows = dropDust(earnRows); // 尘埃 <1U 统一剔除(合计/走势/列表同一口径)
    const spotUsd = spotRows.reduce((a, r) => a + num(r.value), 0);
    for (const r of spotRows) r.share = r.value != null && spotUsd > 0 ? (r.value / spotUsd) * 100 : null;
    return {
      source: live.ok ? 'okx' : 'ledger',
      liveError: live.ok ? undefined : (live as any).error, // 兜底时告诉前端为什么不是实时账户
      fx, // 1 USDT 兑 CNY;前端全部金额按此折人民币
      sub: live.ok ? live.data.sub || null : null, // 子账号余额(仅标注,未计入总资产)
      fundRaw: live.ok ? live.data.fundRaw ?? null : null, // 资金账户原始合计(含质押,对 App 用;台账/演示路径无)
      fundDup: live.ok ? live.data.fundDup || [] : [], // 质押双视图行(总资产大字/环图再计一次;列表/排行不含)
      spot: spotRows,
      fut: futRows,
      earn: earnRows,
      sentiment,
      totals: {
        spotUsd,
        futUpnl: futRows.reduce((a, r) => a + num(r.upnl), 0),
        futMargin: futRows.reduce((a, r) => a + num(r.margin), 0),
        earnUsd: earnRows.reduce((a, r) => a + num(r.value), 0),
        earnGnc: earnRows.reduce((a, r) => a + num(r.earnUsd), 0),
        partial: spotRows.some(r => r.error) || futRows.some(r => r.error) || !sentiment,
      },
    };
  }

  // ⑤ 总资产走势:r=1d(1H×25)/7d(4H)/30d(1D)/1y(1W),OKX 公共K线 × 当前持仓回溯估算,实时无缓存。
  // spark 字段回各币原始 [ts,close] 序列,前端画持仓列表的小走势线(恒取 1d)。
  async cryptoHistory(r: string, demo = false) {
    if (demo) return demoHistory(r);
    const P: Record<string, [string, number]> = { '1d': ['1H', 25], '7d': ['4H', 43], '30d': ['1D', 32], '1y': ['1W', 54] };
    const pr = P[r] || P['1d'];
    const bar = pr[0], limit = pr[1];
    const d: any = await this.crypto(false); // 单飞合并会接住与 /crypto 端点的同刻并发
    const qty: Record<string, number> = {};
    const val: Record<string, number> = {}; // 逐币种市值合计(含闪赚估算这类 qty 为 null 的行)
    let usdtQty = 0;
    for (const row of [...(d.spot || []), ...(d.earn || [])]) {
      // USDT 走账户真值(eqUsd 可能与 avail+frozen 有差,如全仓负债),走势末端才贴总资产;
      // eq 已摊入当前合约浮盈,须先扣掉 upl——曲线逐期自行建模浮盈,带上就是双计(2026-09-30)
      if (row.sym === 'USDT') { usdtQty += row.value != null ? row.value - (row.upl || 0) : row.qty || 0; continue; }
      if (row.qty > 0) qty[row.sym] = (qty[row.sym] || 0) + row.qty;
      if (row.value != null) val[row.sym] = (val[row.sym] || 0) + row.value;
    }
    const syms = Array.from(new Set(Object.keys(qty).concat((d.fut || []).map((f: any) => f.sym))));
    const ser: Record<string, Array<[number, number]>> = {};
    await Promise.all(
      syms.map(async s => {
        const j: any = await safe(() => getJson(`https://www.okx.com/api/v5/market/candles?instId=${s}-USDT&bar=${bar}&limit=${limit}`, 8000));
        if (j.ok) ser[s] = ((j.data?.data || []) as any[]).map((k: any) => [Number(k[0]), Number(k[4])] as [number, number]).sort((a, b) => a[0] - b[0]); // ⚠️ OKX K线收=下标4(2=最高价,曾致走势/spark 中段偏高)
      })
    );
    const hasK = (s: string) => !!(ser[s] && ser[s].length);
    const coins = Object.keys(qty).filter(hasK).map(s => ({ qty: qty[s], series: ser[s] }));
    // 无K线可建模的行(闪赚估算=USDT 理财、缺线新币)按当前市值并入常量项 → 走势末端与总资产同口径(2026-09-24 用户要求)
    for (const s of Object.keys(val)) if (!hasK(s)) usdtQty += val[s];
    // 质押双视图常量:资金格原始合计(fundRaw)与去重后资金行的差额(=OKSOL)并入常量 → 曲线末端=页头三格相加总资产(2026-10-08)
    const num = (x: any) => (x == null || !isFinite(x) ? 0 : x);
    const dupFund = (d.fundDup || []).reduce((s: number, x: any) => s + num(x.value), 0);
    usdtQty += dupFund;
    const fut = (d.fut || [])
      .filter((f: any) => f.entry && ser[f.sym] && ser[f.sym].length)
      .map((f: any) => ({ qty: f.qty, entry: f.entry, dir: f.dir, margin: f.margin || 0, series: ser[f.sym] }));
    const points = equityFromCandles(coins, usdtQty, fut);
    // 末端锚回实时净值(Σ行权益,eqUsd 已含摊入浮盈;「+futUpnl」是双计,2026-09-30 用户抓包删除):
    // K线收盘价与账户真值有分钟级时点差,不锚的话曲线终点和总资产会差 ≈1%,用户视为口径不一致(2026-09-24)
    if (points.length) points[points.length - 1] = { t: points[points.length - 1].t, v: +(d.totals.spotUsd + d.totals.earnUsd + dupFund).toFixed(2) };
    return { r, bar, points, spark: ser, missing: syms.filter(s => !ser[s] || !ser[s].length) };
  }
}
