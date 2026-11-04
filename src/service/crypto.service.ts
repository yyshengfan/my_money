import { Provide } from '@midwayjs/core';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { getJson, getBuffer, cached } from '../util/net';
import { dedupeNews } from '../util/news';
import { periodChg } from './market.service'; // CG 备源的区间涨跌本地算(与持仓页/股票观察同口径,勿双实现)

// 币圈公开接口全部免 key(bit_news_wool 同款数据源)。
// 响应形状固定为 {源名:{ok,data}|{ok:false,error}}:单源失败不拖垮整页,前端逐源标 ✗。
// overview 的 spot 拆 binance/okx 两个子源:币安给 BTC/ETH/SOL/BNB/DOGE(2026-09-23 用户要求列表加币),OKB 只在 OKX(CP 同日曾加、2026-10-08 用户要求去掉)。
// ETF 资金流(etfFlows)唯一免费机器源是第三方 Supabase 免费函数,只给最近 3 条、延后 1 日、
// SOL/BNB/OKB 无 ETF → 只做 BTC/ETH;曲线由服务端在 runtime/etf-flows.json 逐日本地累积。
function safe<T>(fn: () => Promise<T>) {
  return fn().then(
    data => ({ ok: true as const, data }),
    e => ({ ok: false as const, error: String(e?.message || e) })
  );
}

// 同一语义的多基座(fetchBest):逐 URL 至多试 2 次,全败抛最后一次错误。
// 币安现货 data-api.binance.vision(大陆镜像)更稳,挂了自动回退国际站 api.binance.com。
// monitor.service 1m 采样复用(export 2026-10-18),勿双实现;注意其调用绝不包 cached()
export async function fetchBest<T>(
  urls: string[],
  parse: (j: any) => T,
  ms = 8000
): Promise<T> {
  let lastErr: unknown;
  for (const url of urls) {
    for (let i = 0; i < 2; i++) {
      try {
        return parse(await getJson(url, ms));
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr;
}
export async function binance24h(sym: string) { // holding.service 币圈持仓复用,勿双实现
  return fetchBest(
    [
      `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${sym}`,
      `https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`,
    ],
    (r: any) => ({
      sym: r.symbol.replace('USDT', ''),
      price: +r.lastPrice,
      chgPct: +r.priceChangePercent,
      high: +r.highPrice,
      low: +r.lowPrice,
      quoteVol: +r.quoteVolume,
    })
  );
}

const USDT_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'DOGEUSDT'];
const FUND_COINS = ['BTC', 'ETH', 'BNB']; // 资金费率对比的币种
const DOM_IDS = ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'okb', 'bitget-token'];
const OI_COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'OKB']; // OI 趋势对比的币种;BGB 仅 Bitget 本所有交易、无免费历史接口,不入图

// 90日涨跌幅:CoinGecko /coins/markets 的 price_change_percentage 不支持 90d 档(官方仅
// 1h/24h/7d/14d/30d/200d/1y,传了恒回 null),改逐币 market_chart(days=90)按(末值/首值-1)现算。
// 90 日首值一日内几乎不动 → 按币缓存 20h(失败 1h 后重试),省免费档配额。
const CHG90: Record<string, { at: number; pct: number | null }> = {};
async function chg90(id: string): Promise<number | null> {
  const g = CHG90[id];
  if (g && Date.now() - g.at < (g.pct != null ? 20 : 1) * 3600e3) return g.pct;
  let pct: number | null = null;
  try {
    const mj = await getJson(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=90&interval=daily`);
    const ps = mj?.prices;
    if (Array.isArray(ps) && ps.length > 60 && ps[0][1] > 0) pct = ((ps[ps.length - 1][1] - ps[0][1]) / ps[0][1]) * 100;
  } catch { /* CG 挂了落交易所日K备算(2026-10-20) */ }
  if (pct == null) {
    const r = await exchDayRows(DOM_SYM[id] || '', 95); // 95 根覆盖 90 自然日,periodChg 锚定与整行备源同口径
    pct = r ? periodChg(r, null).d90 : null;
  }
  CHG90[id] = { at: Date.now(), pct };
  return pct;
}
const DOM_SYM: Record<string, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  solana: 'SOL',
  binancecoin: 'BNB',
  okb: 'OKB',
  'bitget-token': 'BGB',
  dogecoin: 'DOGE',
};
// 现货表 7d/30d/90d/1y/市值按 dom 查表,DOGE(币安现货)不在 DOM_IDS,
// 只喂查表、不进市值结构饼图(2026-09-23 用户要求列表加狗狗币;CP 2026-10-08 用户要求去掉)
const SPOT_EXT_IDS = ['dogecoin'];

// CoinGecko markets 行(dom 市值结构与现货补充币共用同一解析,勿双实现)
async function cgMarketRows(ids: string[]) {
  // CG 免费档偶发超时:fetchBest 同 URL 重一次,比整列空着强
  const j = await fetchBest(
    [`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(',')}&order=market_cap_desc&price_change_percentage=24h,7d,30d,1y`],
    (r: any) => r
  );
  const byId: Record<string, any> = {};
  for (const c of j || []) byId[c.id] = c;
  return (
    await Promise.all(
      ids.map(async id => {
        const c = byId[id];
        return c
          ? {
              chg90: await chg90(id),
              sym: DOM_SYM[id],
              price: c.current_price ?? null,
              high: c.high_24h ?? null,
              low: c.low_24h ?? null,
              quoteVol: c.total_volume ?? null,
              cap: c.market_cap ?? null,
              rank: c.market_cap_rank ?? null,
              chgPct: c.price_change_percentage_24h ?? c.price_change_percentage_24h_in_currency ?? null,
              chg7: c.price_change_percentage_7d ?? c.price_change_percentage_7d_in_currency ?? null,
              chg30: c.price_change_percentage_30d ?? c.price_change_percentage_30d_in_currency ?? null,
              chg1y: c.price_change_percentage_1y ?? c.price_change_percentage_1y_in_currency ?? null,
            }
          : null;
      })
    )
  ).filter(Boolean);
}

// ---------- CoinGecko 备源(2026-10-20 全站基线调查:CG 免费档 429 一挂就是几小时,而币安/OKX/Bitget 与
// CMC global-metrics 全健康)。行情=与现货槽同源的交易所现价盘;区间涨跌=同所日K本地算(periodChg,与持仓页同口径)。
// 市值/排行无任何免费备源(CMC data-api 的 listing/quotes 实测 system busy/404),如实 null → 前端显 —、饼图自藏。宁缺勿假。
// 日K收盘序列(行形 [YYYY-MM-DD, 0, close] 喂 periodChg):BTC/ETH/SOL/BNB/DOGE=币安 vision→intl;OKB=OKX(单呼上限300根→1年档缺历史落 null);BGB=Bitget 现货
async function exchDayRows(sym: string, limit = 366): Promise<any[] | null> {
  try {
    if (sym === 'OKB') {
      const d = (await getJson(`https://www.okx.com/api/v5/market/candles?instId=OKB-USDT&bar=1D&limit=${Math.min(limit, 300)}`, 8000))?.data || [];
      return d.length ? [...d].reverse().map((k: any[]) => [new Date(+k[0]).toISOString().slice(0, 10), 0, +k[4]]) : null;
    }
    if (sym === 'BGB') {
      const d = (await getJson(`https://api.bitget.com/api/v2/spot/market/candles?symbol=BGBUSDT&granularity=1day&limit=${limit}`, 8000))?.data || [];
      return d.length ? d.map((k: any[]) => [new Date(+k[0]).toISOString().slice(0, 10), 0, +k[4]]) : null;
    }
    return await fetchBest(
      [
        `https://data-api.binance.vision/api/v3/klines?symbol=${sym}USDT&interval=1d&limit=${limit}`,
        `https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=1d&limit=${limit}`,
      ],
      (r: any) => ((r || []).length ? (r as any[]).map(k => [new Date(+k[0]).toISOString().slice(0, 10), 0, +k[4]]) : null)
    );
  } catch {
    return null; // 备源也挂只缺该币区间列,不炸整槽
  }
}
// dom/spotExt 整槽备源:行形与 cgMarketRows 同键(前端零改动);src:'exch' 供徽标如实改名
async function exchFallbackRows(ids: string[]) {
  const rows = await Promise.all(
    ids.map(async id => {
      const sym = DOM_SYM[id];
      if (!sym) return null;
      const [px, day] = await Promise.all([
        sym === 'OKB'
          ? getJson('https://www.okx.com/api/v5/market/ticker?instId=OKB-USDT', 6000)
              .then(j => { const d = j?.data?.[0]; return d ? { price: +d.last, chgPct: ((+d.last - +d.open24h) / +d.open24h) * 100, high: +d.high24h, low: +d.low24h, quoteVol: +d.volCcy24h } : null; })
              .catch(() => null)
          : sym === 'BGB'
          ? getJson('https://api.bitget.com/api/v2/spot/market/tickers?symbol=BGBUSDT', 6000)
              .then(j => { const d = (j?.data || [])[0]; return d ? { price: +d.lastPr, chgPct: ((+d.lastPr - +d.open) / +d.open) * 100, high: +d.high24h, low: +d.low24h, quoteVol: +d.quoteVolume } : null; }) // Bitget open=当日开盘(非滚动24h,口径微差属备源如实)
              .catch(() => null)
          : binance24h(`${sym}USDT`).catch(() => null),
        exchDayRows(sym),
      ]);
      if (!px && !day) return null;
      const pc = day ? periodChg(day, px ? px.price : null) : {};
      return {
        sym, src: 'exch',
        price: px ? px.price : null, high: px ? px.high : null, low: px ? px.low : null, quoteVol: px ? px.quoteVol : null,
        chgPct: px ? px.chgPct : null, chg7: pc.d7 ?? null, chg30: pc.d30 ?? null, chg90: pc.d90 ?? null, chg1y: pc.d365 ?? null,
        cap: null, rank: null,
      };
    })
  );
  const out = rows.filter(Boolean);
  if (!out.length) throw new Error('CoinGecko 与交易所备源均不可用');
  return out;
}

// 活动/机会关键词:Binance/Bybit/Bitget 标题命中则排前,补足 3 条
const ACT_RE =
  /launchpool|megadrop|hodler|上币|上线|活动|奖池|空投|奖励|reward|campaign|airdrop|giveaway|earn|festival|competition|trading/i;
function actFirst<T extends { title: string }>(rows: T[]): T[] {
  const act: T[] = [];
  const rest: T[] = [];
  for (const r of rows) (ACT_RE.test(String(r.title)) ? act : rest).push(r);
  return act.concat(rest);
}

// OKX 公告 details 混三类(latest-events/earn-and-loan/new-listings…),活动优先挑 3
const OKX_TYPE_PRI: Record<string, number> = {
  'latest-events': 0,
  'announcements-earn-and-loan': 1,
  'announcements-new-listings': 2,
};
function okxTop3(details: any[]) {
  return details
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (OKX_TYPE_PRI[a.d.annType] ?? 3) - (OKX_TYPE_PRI[b.d.annType] ?? 3) || a.i - b.i)
    .slice(0, 3)
    .map(x => x.d);
}

// 非中文标题(币安 list / Bybit 公告 / Cointelegraph 资讯)统一译简体,已含汉字的直接放行。
// 双引擎:Google gtx 优先(整段简中质量最好),被 429/超时就落 MyMemory(免 key,偶发保留部分英文)。
// gtx 命中 429 → 冷却 2 分钟再碰,避免每 60s 刷新硬刚死接口把配额打爆;
// 全失败不缓存(下轮可再试),翻译失败只回退该条原文,不拖垮整源。
const HAS_CJK = /[㐀-鿿]/;
let gtxDownUntil = 0;
async function trGtx(t: string): Promise<string | null> {
  if (Date.now() < gtxDownUntil) return null;
  try {
    const j = await getJson(
      'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=' +
        encodeURIComponent(t),
      8000
    );
    const zh = ((j?.[0] || []).map((x: any) => x?.[0]).filter(Boolean) as string[]).join('');
    return zh || null;
  } catch {
    gtxDownUntil = Date.now() + 2 * 60_000; // 大概率 429,先冷却
    return null;
  }
}
async function trMyMemory(t: string): Promise<string | null> {
  try {
    const j = await getJson(
      'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(t) + '&langpair=en|zh-CN',
      12_000
    );
    const out: string = j?.responseData?.translatedText;
    return out && HAS_CJK.test(out) ? out : null; // 回显全英文视为失败
  } catch {
    return null;
  }
}
export async function zhTitle(t: string): Promise<string> { // events.service 复用(事件标题译简体),勿双实现
  if (!t || HAS_CJK.test(t)) return t;
  return cached('zh:' + t, 7 * 24 * 3600e3, async () => {
    const zh = (await trGtx(t)) || (await trMyMemory(t));
    if (!zh) throw new Error('翻译不可用'); // 不缓存,下轮刷新再试
    return zh;
  });
}
async function translateRows(r: any): Promise<any> {
  if (!r.ok) return r;
  r.data = await Promise.all(
    (r.data as any[]).map(async row => ({
      ...row,
      title: await zhTitle(row.title).catch(() => row.title),
    }))
  );
  return r;
}

// RSS 无 XML 库:极简正则切 <item> + 实体解码(CDATA 解包、&amp;/&#8217; 等)。够用即止
const ENT: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  '#39': "'", '#x27': "'", '#x2F': '/', '#x2f': '/', '#160': ' ',
  '#8216': '‘', '#8217': '’', '#8220': '“', '#8221': '”',
  '#8211': '–', '#8212': '—', '#8230': '…',
};
function htmlUnescape(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#[xX]?[0-9a-zA-Z]+|amp|lt|gt|quot|apos|nbsp);/g, (m, e) => ENT[e.toLowerCase()] ?? m);
}

// 日涨幅纯函数(2026-09-21 用户要求,对齐 OKX App「日涨幅」):OKX 日K bar=1D 以北京 00:00 开盘
// (1Dutc 才是 UTC 零点,勿混),行=[ts,o,h,l,c,...],c 为当下价 → (c-o)/o×100;行缺/价非法 null
export function okxDayPct(row: any[]): number | null {
  const o = +row?.[1], c = +row?.[4];
  return o > 0 && isFinite(c) ? ((c - o) / o) * 100 : null;
}

// ④ 合约挂单簿纯函数:币安永续 depth 千档 {bids,asks}=[[价,量]字符串数组] → 买/卖名义(USDT≈$)、买盘%、中间价、一档价差bp;无有效盘口 null
export function bookCalc(d: any) {
  const sum = (legs: any[]) => (legs || []).reduce((t: number, l: any) => t + (+l[0] * +l[1]), 0);
  const bid = sum(d?.bids), ask = sum(d?.asks);
  const b0 = +(d?.bids?.[0] || [])[0], a0 = +(d?.asks?.[0] || [])[0];
  if (!(bid > 0 && ask > 0 && b0 > 0 && a0 > b0)) return null;
  const mid = (a0 + b0) / 2;
  return { px: mid, bidUsd: bid, askUsd: ask, bidPct: (bid / (bid + ask)) * 100, spreadBp: ((a0 - b0) / mid) * 1e4 };
}

@Provide()
export class CryptoService {
  async overview() {
    return cached('crypto:overview', 30_000, async () => {
      const [binance, okx, fut, fng, global, dom, spotExt, cmc100, cd20, spark, domx, day] = await Promise.all([
        // 现货 24h × 4 币:Binance 大陆镜像优先,挂了回退国际站(fetchBest)
        safe(async () => {
          const rows = await Promise.all(USDT_PAIRS.map(s => binance24h(s)));
          return rows.map(r => ({ ...r }));
        }),
        // OKB 只在 OKX 有现货(24h 涨跌用 (last-open24h)/open24h 现算;CP 槽 2026-10-08 用户要求去掉,勿再加回)。
        // OKX ticker 的 volCcy24h 才是报价币(USDT)成交额(实测 ≈1850万),vol24h 是币数
        safe(async () => {
          return Promise.all(
            ['OKB'].map(async s => {
              const j = await getJson(`https://www.okx.com/api/v5/market/ticker?instId=${s}-USDT`);
              const d = j?.data?.[0];
              if (!d) throw new Error(`OKX ${s}-USDT ticker 为空`);
              return {
                sym: s,
                price: +d.last,
                chgPct: ((+d.last - +d.open24h) / +d.open24h) * 100,
                high: +d.high24h,
                low: +d.low24h,
                quoteVol: +d.volCcy24h, // 与币安 quoteVolume 同为 USDT 成交额口径
              };
            })
          );
        }),
        // 合约资金面(BTC/ETH):当下资金费率 + 未平仓价值 + 多空账户比(hub 徽标用)。
        // fapi 大陆要代理,失败单独 ✗,不影响现货;数据仅 payload,不进 spot 涨跌口径。
        safe(async () => {
          const coins = await Promise.all(
            ['BTC', 'ETH'].map(async sym => {
              const [pi, oi, ls] = await Promise.all([
                getJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}USDT`,  9000),
                getJson(
                  `https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}USDT&period=5m&limit=1`,
                   9000
                ),
                getJson(
                  `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}USDT&period=5m&limit=1`,
                   9000
                ),
              ]);
              const h = (oi || [])[0] || {};
              const l = (ls || [])[0] || {};
              return {
                sym,
                markPrice: pi && pi.markPrice != null ? +pi.markPrice : null,
                fundingRate: pi && pi.lastFundingRate != null ? +pi.lastFundingRate : null,
                oiUsd: h.sumOpenInterestValue != null ? +h.sumOpenInterestValue : null,
                longShortRatio: l.longShortRatio != null ? +l.longShortRatio : null,
              };
            })
          );
          if (!coins.length) throw new Error('合约面数据为空');
          return coins;
        }),
        // 恐慌贪婪指数(近 30 天,画折线)
        safe(async () => {
          const j = await getJson('https://api.alternative.me/fng/?limit=30');
          return (j?.data || []).map((d: any) => ({
            value: +d.value,
            label: d.value_classification,
            ts: +d.timestamp,
          }));
        }),
        // 全市场总市值 / BTC·ETH 占比
        safe(async () => {
          const j = await getJson('https://api.coingecko.com/api/v3/global');
          const d = j?.data || {};
          return {
            totalUsd: d.total_market_cap?.usd,
            mcapChgPct: d.market_cap_change_percentage_24h_usd,
            btcPct: d.market_cap_percentage?.btc,
            ethPct: d.market_cap_percentage?.eth,
          };
        }),
        // 市值结构六币:单币市值/排行 + 24h/7d/30d 涨幅(一次 markets 调用全带;现货表多出的币见下方 spotExt)。
        // 顺带回 price/high/low/vol:币安/欧易都没有现货的币(如 BGB,仅 Bitget 本所交易)由前端用这些字段补行
        // 占比前端用 cap ÷ global.totalUsd 现算
        safe(async () => {
          try { const r = await cgMarketRows(DOM_IDS); if (!r.length) throw new Error('CG markets 空返'); return r; }
          catch { return exchFallbackRows(DOM_IDS); } // 2026-10-20:CG 429 → 交易所行情+日K备源(市值如实缺)
        }),
        // 现货表补充两币(DOGE/OP):同 markets 调用,只进前端 domMap 查表,不入市值结构
        safe(async () => {
          try { const r = await cgMarketRows(SPOT_EXT_IDS); if (!r.length) throw new Error('CG markets 空返'); return r; }
          catch { return exchFallbackRows(SPOT_EXT_IDS); }
        }),
        // 币圈大盘指数(用户 2026-09-20 要求进首页币圈列):CMC100 = CoinMarketCap 官方免 key 端点,5min 级
        safe(async () => {
          const j = await getJson('https://pro-api.coinmarketcap.com/public-api/v3/index/cmc100-latest', 8000);
          const d = j?.data;
          if (!d || !isFinite(+d.value)) throw new Error('CMC100 免key端点无数据');
          return { value: +d.value, chgPct: +d.value_24h_percentage_change, t: d.last_update };
        }),
        // CD20 = CoinDesk 20:CNBC 免 key 行情(.CD20);挂则落雅虎 ^CDI20(带 UA,否则 429)
        safe(async () => {
          const q: any =
            (await getJson('https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=.CD20&requestMethod=itv&noform=1&partnerId=2&output=json', 8000))
              ?.FormattedQuoteResult?.FormattedQuote?.[0] || {};
          const v = parseFloat(String(q.last).replace(/,/g, ''));
          if (isFinite(v) && q.last_time) return { value: v, chgPct: parseFloat(String(q['change_pct'])) || 0, t: q.last_timedate };
          const y = (await getJson('https://query1.finance.yahoo.com/v8/finance/chart/%5ECDI20?range=5d&interval=1d', 8000, { 'User-Agent': 'Mozilla/5.0' }))
            ?.chart?.result?.[0]?.meta;
          if (!y || !isFinite(+y.regularMarketPrice)) throw new Error('CD20 CNBC 与雅虎均失败');
          return { value: +y.regularMarketPrice, chgPct: +y.regularMarketChangePercent || 0, t: y.regularMarketTime };
        }),
        // BTC/ETH 近35日日线(总览改版 2026-09-20:板块①走势与②迷你 spark 共用)。
        // vision 镜像免代理优先,挂回退国际站;klines 行[0]=开盘ms、[4]=收盘
        safe(async () => {
          const k = (sym: string) =>
            fetchBest(
              [
                `https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=1d&limit=35`,
                `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=35`,
              ],
              (r: any) => (r || []).map((x: any[]) => ({ t: new Date(+x[0]).toISOString().slice(0, 10), c: +x[4] }))
            );
          const [btc, eth] = await Promise.all([k('BTCUSDT'), k('ETHUSDT')]);
          if (btc.length < 5 || eth.length < 5) throw new Error('币安日K不足');
          return { btc, eth };
        }),
        // BTC.D 及其24h变化:CMC data-api 免key变体(pro-api 免key回500 busy,已实测)。
        // 2026-10-20 顺带带出总市值/24h变化/ETH.D,兼作 CoinGecko /global 429 时的备源(同一次调用,零新增上游)
        safe(async () => {
          const d = (await getJson('https://api.coinmarketcap.com/data-api/v3/global-metrics/quotes/latest', 8000))?.data;
          if (!d || !isFinite(+d.btcDominance)) throw new Error('CMC 全球指标无数据');
          const q = (d.quotes || [])[0] || {};
          return {
            btcD: +d.btcDominance,
            btcD24: +d.btcDominance24hPercentageChange || 0,
            ethD: +d.ethDominance || null,
            totalUsd: +q.totalMarketCap || null,
            mcapChgPct: +q.totalMarketCapYesterdayPercentageChange || null, // 对昨日收盘口径(CG 为滚动24h,备源差一点属如实)
          };
        }),
        // 日涨幅(2026-09-21 用户要求,和 OKX App「日涨幅」对齐):OKX 公共日K bar=1D=北京0点开盘价现算,
        // 与上面各源的「24h涨跌」(滚动24h)是两个口径,两列并存各自标明。逐币并发,单币挂只缺那格;全挂整槽 ✗
        safe(async () => {
          const out: Record<string, number> = {};
          await Promise.all(
            ['BTC', 'ETH', 'SOL', 'BNB', 'OKB', 'DOGE'].map(async s => {
              const j = await getJson(
                `https://www.okx.com/api/v5/market/candles?instId=${s}-USDT&bar=1D&limit=1`,
                6000
              ).catch(() => null);
              const v = okxDayPct(j?.data?.[0]);
              if (v != null) out[s] = v;
            })
          );
          if (!Object.keys(out).length) throw new Error('OKX 日K全失败');
          return out;
        }),
      ]);
      // 日涨幅挂进现货行的 dayPct 字段(缺币不挂,前端显 —)
      if (day.ok) for (const src of [binance, okx]) if (src.ok) for (const r of src.data as any[]) if (day.data[r.sym] != null) r.dayPct = day.data[r.sym];
      // CG /global 429 → 用同批 CMC 全球指标回填(2026-10-20;src 标记供前端徽标如实改名)
      const gsum = global.ok || !domx.ok || !Number.isFinite(+domx.data.totalUsd) ? global : {
        ok: true as const,
        data: { totalUsd: domx.data.totalUsd, mcapChgPct: domx.data.mcapChgPct, btcPct: domx.data.btcD, ethPct: domx.data.ethD, src: 'cmc' },
      };
      return { spot: { binance, okx }, fut: { binance: fut }, fng, global: gsum, dom, spotExt, bench: { cmc100, cd20 }, spark, domx };
    });
  }

  // ---------- 永续资金费率折线:每所历史结算费率 ----------

  // 各所费率均为小数口径(×100 为 %)。币安 fapi fundingRate / 欧易 funding-rate-history(取 realizedRate,
  // 实际结算值) / Bybit funding/history 都是每 8h 结算的历史档,足够画线;Bitget 无公开历史接口
  // (funding-time/ticker 只有当前下一档)→ 只给当前值一个点,前端虚线打点并注明。合约域(尤其 fapi)
  // 大陆常需代理,失败按源标 ✗。
  async fundingHistory(coin: string) {
    const c = (coin || 'BTC').toUpperCase();
    if (!FUND_COINS.includes(c)) throw new Error('不支持的币种:' + c);
    return cached(`crypto:fhist:${c}`, 30_000, async () => {
      // 每源取其最近 N 个结算档,升序给前端
      const TAKE = 90;
      const [binance, okx, bitget, bybit] = await Promise.all([
        safe(async () => {
          const j = await getJson(
            `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${c}USDT&limit=${TAKE}`
          );
          const rows = ((j || []).map((d: any) => ({
            t: +d.fundingTime,
            r: +d.fundingRate,
          }))).filter((x: any) => x.t && isFinite(x.r));
          return rows.sort((a: any, b: any) => a.t - b.t);
        }),
        safe(async () => {
          const j = await getJson(
            `https://www.okx.com/api/v5/public/funding-rate-history?instId=${c}-USDT-SWAP&limit=${TAKE}`
          );
          const rows = ((j?.data || []).map((d: any) => ({
            t: +d.fundingTime,
            r: +(d.realizedRate ?? d.fundingRate), // realizedRate 才是该档实际结算值
          }))).filter((x: any) => x.t && isFinite(x.r));
          return rows.sort((a: any, b: any) => a.t - b.t);
        }),
        // Bitget:无历史,取当前 ticker 费率 + funding-time 的所属档位时间,前端画单点
        safe(async () => {
          const [tk, ft] = await Promise.all([
            getJson(
              `https://api.bitget.com/api/v2/mix/market/ticker?symbol=${c}USDT&productType=usdt-futures`
            ),
            getJson(
              `https://api.bitget.com/api/v2/mix/market/funding-time?symbol=${c}USDT&productType=usdt-futures`
            ),
          ]);
          const rate = +tk?.data?.[0]?.fundingRate;
          const t = +(ft?.data?.[0]?.nextFundingTime ?? Date.now());
          if (!isFinite(rate)) throw new Error('Bitget 当前费率为空');
          return [{ t, r: rate }];
        }),
        safe(async () => {
          const j = await getJson(
            `https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${c}USDT&limit=${TAKE}`
          );
          const rows = ((j?.result?.list || []).map((d: any) => ({
            t: +d.fundingRateTimestamp,
            r: +d.fundingRate,
          }))).filter((x: any) => x.t && isFinite(x.r));
          return rows.sort((a: any, b: any) => a.t - b.t);
        }),
      ]);
      return { coin: c, series: { binance, okx, bitget, bybit } };
    });
  }

  // ---------- 未平仓合约 OI 折线:各所 USDT 名义额历史(2026-09-22 用户要求,全平台趋势) ----------
  // 口径逐所实测(2026-09-22):币安 openInterestHist 直接给 sumOpenInterestValue(USDT 名义);
  // OKX rubik data 行 [ts, oi, vol],oi 为 USDT 名义(BTC≈33亿、SOL≈4亿,量级吻合;合约数口径会到几十亿 BTC,不可能);
  // Bybit 只回币数 openInterest → 乘该所当前 markPrice 折 USDT(历史点用现价近似,页面注记)。
  // Bitget v2 open-interest 只有当前单点、无历史(实测)→ 不做第 4 线;BGB 各主流所无永续,故不在本图币种里。
  // 1d/7d 用 1h 档、30d 降 4h(限长:Binance≤500、Bybit≤200);OKX 恒 1H(单呼回 720 行=整 30 天)按窗口过滤。
  async oiHistory(coin: string, range: string) {
    const c = (coin || 'BTC').toUpperCase();
    if (!OI_COINS.includes(c)) throw new Error('不支持的币种:' + c);
    const r = ['1d', '7d', '30d'].includes(range) ? range : '7d';
    const span = ({ '1d': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5 } as Record<string, number>)[r];
    const per = r === '30d' ? '4h' : '1h';
    return cached(`crypto:oi:${c}:${r}`, 60_000, async () => {
      const since = Date.now() - span;
      const asc = (a: any, b: any) => a.t - b.t;
      const [binance, okx, bybit] = await Promise.all([
        safe(async () => {
          const j = await getJson(
            `https://fapi.binance.com/futures/data/openInterestHist?symbol=${c}USDT&period=${per}&limit=500`
          );
          const rows = ((j || [])
            .map((d: any) => ({ t: +d.timestamp, usd: +d.sumOpenInterestValue }))
            .filter((x: any) => x.t >= since && isFinite(x.usd)) as any[]).sort(asc);
          if (!rows.length) throw new Error('币安 OI 历史为空');
          return rows;
        }),
        safe(async () => {
          // rubik period 实测只支持 [5m,1H,1D](传 4H 回 51000),30d 也走 1H(单呼回 720 行=整 30 天),前端按桶合并
          const j = await getJson(
            `https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${c}&period=1H`
          );
          const rows = ((j?.data || [])
            .map((d: any) => ({ t: +d[0], usd: +d[1] }))
            .filter((x: any) => x.t >= since && isFinite(x.usd)) as any[]).sort(asc);
          if (!rows.length) throw new Error('OKX OI 历史为空');
          return rows;
        }),
        safe(async () => {
          const [oi, tk] = await Promise.all([
            getJson(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${c}USDT&intervalTime=${per}&limit=200`),
            getJson(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${c}USDT`),
          ]);
          const px = +tk?.result?.list?.[0]?.markPrice;
          if (!isFinite(px)) throw new Error('Bybit 标记价为空');
          const rows = ((oi?.result?.list || [])
            .map((d: any) => ({ t: +d.timestamp, usd: +d.openInterest * px }))
            .filter((x: any) => x.t >= since && isFinite(x.usd)) as any[]).sort(asc);
          if (!rows.length) throw new Error('Bybit OI 历史为空');
          return rows;
        }),
      ]);
      return { coin: c, range: r, series: { binance, okx, bybit } };
    });
  }

  // ---------- 相关新闻 & 宏观:Cointelegraph RSS(标题翻简体)----------
  async news() {
    return cached('crypto:news', 60_000, async () => {
      const news = await safe(async () => {
        const buf = await getBuffer('https://cointelegraph.com/rss', 12_000);
        const body = Buffer.from(buf).toString('utf8');
        const blocks = body.match(/<item>[\s\S]*?<\/item>/g) || [];
        if (!blocks.length) throw new Error('RSS 无内容');
        const field = (b: string, tag: string) =>
          (b.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] || '').trim();
        const rows = blocks.slice(0, 8).map(b => {
          const title = htmlUnescape(field(b, 'title')).slice(0, 200);
          const link = htmlUnescape(field(b, 'link')).trim();
          const ts = Date.parse(htmlUnescape(field(b, 'pubDate')));
          const snippet = htmlUnescape(field(b, 'description'))
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 140);
          return { title, link, ts: isNaN(ts) ? 0 : ts, snippet };
        });
        const data = dedupeNews(rows.filter(r => r.title && r.link).sort((a, b) => b.ts - a.ts));
        if (!data.length) throw new Error('RSS 无有效条目');
        // 标题逐条译简体(cached 7 天不复译);snippet 保留英文原文,省流量
        for (const r of data) r.title = await zhTitle(r.title).catch(() => r.title);
        return data;
      });
      return { news };
    });
  }

  // ---------- 链上数据:稳定币总供给(DefiLlama)+ BTC 链上实时手续费(mempool)----------
  // ④ 合约挂单量:重点币千档盘口快照(币安永续),逐币 {ok,data|error},60s 缓存
  async book() {
    return cached('crypto:book', 60_000, async () => {
      const coins = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'];
      return Promise.all(
        coins.map(async sym => {
          try {
            const v = bookCalc(await getJson(`https://fapi.binance.com/fapi/v1/depth?symbol=${sym}USDT&limit=1000`, 8000));
            if (!v) throw new Error('空盘口');
            return { sym, ok: true as const, data: v };
          } catch (e: any) {
            return { sym, ok: false as const, error: String(e?.message || e) };
          }
        })
      );
    });
  }

  async chain() {
    return cached('crypto:chain', 60_000, async () => {
      // 稳定币 = 场外弹药:总供给与其 24h/7d 增减;rows 取头部发行方。真实"聪明钱"明细
      // (交易所净流/巨鲸地址)需付费源,此处只给免 key 的可靠近似,前端会诚实标注。
      const stable = await safe(async () => {
        const j = await getJson('https://stablecoins.llama.fi/stablecoins?includePrices=true', 12_000);
        const assets: any[] = ((j?.peggedAssets) || []).filter((a: any) => a?.pegType === 'peggedUSD');
        const cap = (a: any) => +((a?.circulating?.peggedUSD) || 0);
        const prev = (a: any, k: string) => +((a?.[k]?.peggedUSD) || 0);
        const sum = (f: (a: any) => number) => assets.reduce((s: number, a: any) => s + f(a), 0);
        return {
          total: sum(cap),
          day: sum(a => cap(a) - prev(a, 'circulatingPrevDay')),
          week: sum(a => cap(a) - prev(a, 'circulatingPrevWeek')),
          rows: assets
            .map(a => ({ sym: a.symbol, cap: cap(a), day: cap(a) - prev(a, 'circulatingPrevDay') }))
            .filter(r => r.cap > 0)
            .sort((a, b) => b.cap - a.cap)
            .slice(0, 4),
        };
      });
      // mempool.space 实时推荐费档 = 链上拥挤度(顺带给风险监控用)
      const mempool = await safe(async () => {
        const j = await getJson('https://mempool.space/api/v1/fees/recommended');
        return { fast: +j?.fastestFee, econ: +j?.economyFee };
      });
      return { stable, mempool };
    });
  }

  async announcements() {
    return cached('crypto:ann', 30_000, async () => {
      const [binance, okx, bybit, bitget] = await Promise.all([
        // 币安活动目录 catalogId=93(即 Latest Activities);接口不出简体,标题走 zhTitle 翻
        safe(async () => {
          const j = await getJson(
            'https://www.binance.com/bapi/apex/v1/public/apex/cms/article/list/query?type=1&pageNo=1&pageSize=10&catalogId=93'
          );
          const rows = (((j?.data?.catalogs?.[0]?.articles) || []).map((a: any) => ({
            title: a.title,
            time: a.releaseDate,
            url: `https://www.binance.com/zh-CN/support/announcements/detail/${a.id}`,
          })));
          return actFirst(rows).slice(0, 3);
        }),
        // 欧易公告:Accept-Language: zh-CN 才是切中文的开关(实测不带 header 恒英文,locale 参数无效)
        safe(async () => {
          const j = await getJson(
            'https://www.okx.com/api/v5/support/announcements?locale=zh_CN',
            8000,
            { 'Accept-Language': 'zh-CN' }
          );
          const details = ((j?.data?.[0]?.details) || []).map((a: any) => ({
            title: a.title ?? a.annTitle,
            annType: a.annType,
            time: a.pTime,
            url: a.url,
          }));
          return okxTop3(details).map(({ title, time, url }: any) => ({ title, time, url }));
        }),
        // Bybit:简体 locale 恒返空、en/繁有内容 → 取 en-US,标题走 zhTitle 翻简体
        safe(async () => {
          const j = await getJson(
            'https://api.bybit.com/v5/announcements/index?locale=en-US&limit=10'
          );
          const rows = ((j?.result?.list) || []).map((a: any) => ({
            title: a.title,
            time: a.date,
            url: a.url,
          }));
          return actFirst(rows).slice(0, 3);
        }),
        // Bitget 公告(注意接口 URL 拼写就是 annoucements,少个 n);zh_CN 原生简体
        safe(async () => {
          const j = await getJson(
            'https://api.bitget.com/api/v2/public/annoucements?annType=latest_news&language=zh_CN&limit=10'
          );
          const rows = ((j?.data) || []).map((a: any) => ({
            title: a.annTitle,
            time: a.cTime,
            url: a.annUrl,
          }));
          return actFirst(rows).slice(0, 3);
        }),
      ]);
      // 四源统一过一次 zhTitle:英文标题翻简体,已是中文的原样返回
      return {
        binance: await translateRows(binance),
        okx: await translateRows(okx),
        bybit: await translateRows(bybit),
        bitget: await translateRows(bitget),
      };
    });
  }

  // ---------- ETF 资金流(BTC/ETH):本地 runtime/etf-flows.json 逐日累积 ----------

  async etfFlows() {
    await maybeRefresh(); // 刷新不缓存,读侧才缓存
    return cached('crypto:etf', 60_000, async () => etfView(readStore()));
  }

}

const ETF_API = (t: string) =>
  `https://ubzimdhjaqeirdhhwzug.supabase.co/functions/v1/smooth-handler?ticker=${t}&limit=3`;
const ETF_FILE = resolve(process.cwd(), 'runtime/etf-flows.json');

export interface EtfRow {
  date: string;
  btc?: number | null;
  eth?: number | null;
}
interface EtfStore {
  updatedAt: number;
  rows: EtfRow[]; // 自动合并,按 date 升序
  manual: EtfRow[]; // 手填可信日值,覆盖自动行(ponytail: 免费源最新日常是占位 0,靠手填纠错)
}

function readStore(): EtfStore {
  try {
    const j = JSON.parse(readFileSync(ETF_FILE, 'utf8'));
    return { updatedAt: j.updatedAt || 0, rows: j.rows || [], manual: j.manual || [] };
  } catch {
    return { updatedAt: 0, rows: [], manual: [] };
  }
}
function writeStore(s: EtfStore) {
  mkdirSync(resolve(process.cwd(), 'runtime'), { recursive: true }); // 原子写:tmp + rename
  const tmp = ETF_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(s));
  renameSync(tmp, ETF_FILE);
}

// manual 覆盖自动行后,产出按 date 升序的有效日序列(仅保留有值的日)
function overlay(store: EtfStore): EtfRow[] {
  const m = new Map<string, EtfRow>();
  for (const r of store.rows) m.set(r.date, { date: r.date, btc: r.btc, eth: r.eth });
  for (const r of store.manual) {
    const cur = m.get(r.date) || { date: r.date };
    if (r.btc != null) cur.btc = +r.btc;
    if (r.eth != null) cur.eth = +r.eth;
    m.set(r.date, cur);
  }
  return [...m.values()]
    .filter(r => r.btc != null || r.eth != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// 北京日历时间的轻量换算:对当前时刻 +8h 后取其 UTC 日历即北京日历
function bjShift(): Date {
  return new Date(Date.now() + 8 * 3600e3);
}
function bjHour(): number {
  return bjShift().getUTCHours();
}
function bjDaysAgo(n: number): string {
  const d = bjShift();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function etfView(store: EtfStore) {
  const daily = overlay(store);
  const lastOf = (k: 'btc' | 'eth') => {
    for (let i = daily.length - 1; i >= 0; i--)
      if (daily[i][k] != null) return { date: daily[i].date, flow: +daily[i][k]! };
    return null;
  };
  const cum = (k: 'btc' | 'eth') =>
    daily.reduce((a, r) => (r[k] != null ? a + +r[k]! : a), 0);
  return {
    accumulatedFrom: daily.length ? daily[0].date : bjDaysAgo(0),
    updatedAt: store.updatedAt,
    daily,
    btc: { latest: lastOf('btc'), cum: cum('btc') },
    eth: { latest: lastOf('eth'), cum: cum('eth') },
  };
}

// 页面加载即按需刷新(免定时任务):北京 ≥14 点(美东收盘定稿后)且缺北京昨日且距上次 ≥60min
let refreshing = false;
async function maybeRefresh(): Promise<void> {
  if (refreshing || (bjHour() < 14 && !process.env.ETF_FORCE)) return;
  const store = readStore();
  if (Date.now() - store.updatedAt < 60_000) return;
  const hasYesterday = overlay(store).some(r => r.date === bjDaysAgo(1));
  if (hasYesterday) return;
  refreshing = true;
  try {
    const feeds = await Promise.all(
      ['btc', 'eth'].map(k =>
        safe(async () => {
          const j = await getJson(ETF_API(k.toUpperCase()));
          return j?.data || [];
        })
      )
    );
    const rowsByDate = new Map(store.rows.map(r => [r.date, { ...r }]));
    feeds.forEach((feed, i) => {
      if (!feed.ok || !feed.data.length) return;
      const key: 'btc' | 'eth' = i === 0 ? 'btc' : 'eth';
      const items = feed.data.filter(
        (d: any) => d && d.flow_date && d.net_flow_usd != null
      );
      if (!items.length) return;
      const maxDate = items.reduce(
        (m: string, d: any) => (d.flow_date > m ? d.flow_date : m),
        ''
      );
      for (const d of items) {
        const v = +d.net_flow_usd;
        // 占位 0 守卫:feed 最新一日为 0 多半未定稿,跳过不累计
        if (v === 0 && d.flow_date === maxDate) continue;
        const row = rowsByDate.get(d.flow_date);
        if (row) {
          if (row[key] == null) row[key] = v;
        } else {
          const fresh: EtfRow = { date: d.flow_date };
          fresh[key] = v;
          rowsByDate.set(d.flow_date, fresh);
        }
      }
    });
    const rows = [...rowsByDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    // 合并成功与否都推进 updatedAt,把拉取频率交给 60s 冷却
    writeStore({ updatedAt: Date.now(), rows, manual: store.manual });
  } catch {
    /* 拉取失败只影响本次,读侧照旧,绝不白屏 */
  } finally {
    refreshing = false;
  }
}
