import { Provide } from '@midwayjs/core';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { getJson, getBuffer, cached } from '../util/net';

// 币圈公开接口全部免 key(bit_news_wool 同款数据源)。
// 响应形状固定为 {源名:{ok,data}|{ok:false,error}}:单源失败不拖垮整页,前端逐源标 ✗。
// overview 的 spot 拆 binance/okx 两个子源:币安给 BTC/ETH/SOL/BNB,OKB 只在 OKX。
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
async function fetchBest<T>(
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
async function binance24h(sym: string) {
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

const USDT_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
const FUND_COINS = ['BTC', 'ETH', 'BNB']; // 资金费率对比的币种
const DOM_IDS = ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'okb'];
const DOM_SYM: Record<string, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  solana: 'SOL',
  binancecoin: 'BNB',
  okb: 'OKB',
};

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
async function zhTitle(t: string): Promise<string> {
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

@Provide()
export class CryptoService {
  async overview() {
    return cached('crypto:overview', 30_000, async () => {
      const [binance, okx, fut, fng, global, dom] = await Promise.all([
        // 现货 24h × 4 币:Binance 大陆镜像优先,挂了回退国际站(fetchBest)
        safe(async () => {
          const rows = await Promise.all(USDT_PAIRS.map(s => binance24h(s)));
          return rows.map(r => ({ ...r }));
        }),
        // OKB 只在 OKX 交易;24h 涨跌用 (last-open24h)/open24h 现算。
        // OKX ticker 的 volCcy24h 才是报价币(USDT)成交额(实测 ≈1850万),vol24h 是 OKB 币数
        safe(async () => {
          const j = await getJson(
            'https://www.okx.com/api/v5/market/ticker?instId=OKB-USDT'
          );
          const d = j?.data?.[0];
          if (!d) throw new Error('OKX OKB ticker 为空');
          return [
            {
              sym: 'OKB',
              price: +d.last,
              chgPct: ((+d.last - +d.open24h) / +d.open24h) * 100,
              high: +d.high24h,
              low: +d.low24h,
              quoteVol: +d.volCcy24h, // 与币安 quoteVolume 同为 USDT 成交额口径
            },
          ];
        }),
        // 合约资金面(BTC/ETH):当下资金费率 + 未平仓价值 + 多空账户比(hub 徽标用)。
        // fapi 大陆要代理,失败单独 ✗,不影响现货;数据仅 payload,不进 spot 涨跌口径。
        safe(async () => {
          const coins = await Promise.all(
            ['BTC', 'ETH'].map(async sym => {
              const [pi, oi, ls] = await Promise.all([
                getJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}USDT`, 6000),
                getJson(
                  `https://fapi.binance.com/fapi/v1/futures/data/openInterestHist?symbol=${sym}USDT&period=5m&limit=1`,
                  6000
                ),
                getJson(
                  `https://fapi.binance.com/fapi/v1/futures/data/globalLongShortAccountRatio?symbol=${sym}USDT&period=5m&limit=1`,
                  6000
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
        // 市值结构五币:单币市值/排行;占比前端用 cap ÷ global.totalUsd 现算
        safe(async () => {
          const j = await getJson(
            `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${DOM_IDS.join(',')}&order=market_cap_desc`
          );
          const byId: Record<string, any> = {};
          for (const c of j || []) byId[c.id] = c;
          return DOM_IDS.map(id => {
            const c = byId[id];
            return c
              ? {
                  sym: DOM_SYM[id],
                  cap: c.market_cap ?? null,
                  rank: c.market_cap_rank ?? null,
                  chgPct: c.price_change_percentage_24h ?? null,
                }
              : null;
          }).filter(Boolean);
        }),
      ]);
      return { spot: { binance, okx }, fut: { binance: fut }, fng, global, dom };
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
        const data = rows.filter(r => r.title && r.link);
        if (!data.length) throw new Error('RSS 无有效条目');
        // 标题逐条译简体(cached 7 天不复译);snippet 保留英文原文,省流量
        for (const r of data) r.title = await zhTitle(r.title).catch(() => r.title);
        return data;
      });
      return { news };
    });
  }

  // ---------- 链上数据:稳定币总供给(DefiLlama)+ BTC 链上实时手续费(mempool)----------
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
