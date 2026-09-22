import { Provide } from '@midwayjs/core';
import { getBuffer, getJson, cached } from '../util/net';

// 全球宏观四资产(纳指100 / 美债10Y / 伦敦金XAU / WTI原油)近30日日线,公开端点 /api/macro。
// 源为 2026-09 本机实测免key直连可达:新浪美股日K(.NDX 真指数)、新浪全球期货日K(XAU/CL——
// 黄金用现货口径,用户盯伦敦金,GC 期货有几十美元基差,勿换回)、美国财政部CSV。
// (Yahoo 大陆封禁、stooq/FRED 直连 000;纳指曾用 NQ 期货代理,周末/隔夜期货与现货指数
// 分化会误导,2026-09 用户反馈后换成 .NDX 真指数,勿再换回;腾讯美股K线只回 1 行历史已弃。)
// 响应形状同 crypto:逐资产 {ok,data}|{ok:false,error},任一源挂不拖垮整块。

function safe<T>(fn: () => Promise<T>) {
  return fn().then(
    data => ({ ok: true as const, data }),
    e => ({ ok: false as const, error: String(e?.message || e) })
  );
}

export interface Day {
  t: string; // YYYY-MM-DD
  c: number;
}

// 新浪全球期货日K JSONP:`/*...*/ var t=([{date,close,...}]);` → 剥壳取尾部 n 行
export function parseSinaDays(text: string, n = 35): Day[] {
  const m = text.match(/\((\[[\s\S]*\])\)/);
  if (!m) throw new Error('新浪日K格式异常');
  const arr = JSON.parse(m[1]);
  if (!Array.isArray(arr) || !arr.length) throw new Error('新浪日K空');
  return arr.slice(-n).map((r: any) => ({ t: String(r.date), c: +r.close }));
}

// 新浪美股日K JSONP(symbol=.NDX 这类指数):{d,o,h,l,c,v} → 尾部 n 行
export function parseSinaUsDays(text: string, n = 35): Day[] {
  const m = text.match(/\((\[[\s\S]*\])\)/);
  if (!m) throw new Error('新浪美股日K格式异常');
  const arr = JSON.parse(m[1]);
  if (!Array.isArray(arr) || !arr.length) throw new Error('新浪美股日K空');
  return arr.slice(-n).map((r: any) => ({ t: String(r.d), c: +r.c }));
}

// 美国财政部日收益率曲线 CSV:表头定位「10 Yr」列,Date 为 MM/DD/YYYY,滤 '--';
// ⚠️ 文件实测按日期降序(新→旧),解析后须升序排,否则 slice(-n) 取到的是最老一段;
// 只拉当年文件 → 1 月初回看不足 30 天时按实际天数算(前端标近30日,属数据节奏非bug)
export function parseTsy10(csv: string, n = 35): Day[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',').indexOf('"10 Yr"');
  if (head < 0) throw new Error('财政部CSV无10Y列');
  const out: Day[] = [];
  for (const ln of lines.slice(1)) {
    const f = ln.split(',');
    const v = +f[head];
    const dm = (f[0] || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!dm || !Number.isFinite(v) || v === 0) continue;
    const [, mm, dd, yyyy] = dm;
    out.push({ t: `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`, c: v });
  }
  if (!out.length) throw new Error('财政部CSV无有效10Y数据');
  out.sort((a, b) => (a.t < b.t ? -1 : 1)); // 升序后取尾部 = 最近 n 天
  return out.slice(-n);
}

// 30自然日窗:末日往前 ≤30 天的首个点作基准;返回 {pct, bp}(bp 给 10Y 收益率用)
export function chgOf(series: Day[]): { pct: number | null; bp: number | null } {
  if (series.length < 2) return { pct: null, bp: null };
  const last = series[series.length - 1];
  const from = new Date(last.t).getTime() - 30 * 864e5;
  const base = series.find(d => new Date(d.t).getTime() >= from) || series[0];
  return { pct: +(((last.c / base.c) - 1) * 100).toFixed(2), bp: Math.round((last.c - base.c) * 100) };
}

// 上一份成功数据:全源/半源失败时兜底返回(日频数据,陈旧比空白有用),用 stale 标出
let lastGood: Record<string, any> | null = null;

const SINA_SYM: Record<string, string> = { gold: 'XAU', oil: 'CL' }; // XAU=伦敦金现货(用户看的是现货价,GC期货常有几十美元基差)

// 新浪美股日K指数表(总览改版 2026-09-20 补标普500 .INX,同端点同格式)
const SINA_US_IDX: Record<string, string> = { ndx: '.NDX', spx: '.INX' };
// 雅虎指数图表端(免 key 带 UA;海外走系统代理,CD20 兜底同源实测可达):DXY 美元指数 / VIX 恐慌指数
const YAHOO_SYM: Record<string, string> = { dxy: 'DX-Y.NYB', vix: '%5EVIX' };
async function yahooDays(sym: string): Promise<Day[]> {
  const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=1mo&interval=1d`, 12000, {
    'User-Agent': 'Mozilla/5.0',
  });
  const r = j?.chart?.result?.[0];
  const ts: number[] = r?.timestamp || [];
  const cl: number[] = r?.indicators?.quote?.[0]?.close || [];
  // cl 有 null 空洞(雅虎休市段),+null=0 会混进序列把末值打成 0 → 必须显式滤
  const out = ts
    .map((t, i) => ({ t: new Date(t * 1000).toISOString().slice(0, 10), c: +cl[i] }))
    .filter(d => Number.isFinite(d.c) && d.c > 0)
    .map(d => ({ t: d.t, c: +d.c.toFixed(2) }));
  if (out.length < 5) throw new Error('雅虎日K不足');
  return out.slice(-35);
}

async function getSeries(key: string): Promise<Day[]> {
  if (SINA_US_IDX[key]) {
    // 纳指100/标普500 用新浪美股日K真指数(.NDX/.INX)——NQ 期货周末/隔夜会带偏,勿换回
    const buf = await getBuffer(
      `https://stock.finance.sina.com.cn/usstock/api/jsonp_v2.php/var%20t=/US_MinKService.getDailyK?symbol=${SINA_US_IDX[key]}`,
      15000,
      { referer: 'https://finance.sina.com.cn/' }
    );
    return parseSinaUsDays(Buffer.from(buf).toString('utf8'), 35);
  }
  if (YAHOO_SYM[key]) return yahooDays(YAHOO_SYM[key]);
  if (SINA_SYM[key]) {
    // 新浪全球期货主力连续日K(全史,取尾 35)
    const buf = await getBuffer(
      `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20t=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=${SINA_SYM[key]}`,
      15000,
      { referer: 'https://finance.sina.com.cn/' }
    );
    return parseSinaDays(Buffer.from(buf).toString('utf8'), 35);
  }
  const buf = await getBuffer(
    `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${new Date().getFullYear()}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${new Date().getFullYear()}&page&_format=csv`,
    12000
  );
  return parseTsy10(Buffer.from(buf).toString('utf8'), 35);
}

const META: Record<string, { name: string; tag: string; fmt: string }> = {
  ndx: { name: '纳斯达克100', tag: 'US TECH · NDX', fmt: 'idx' },
  spx: { name: '标普500', tag: 'US S&P · INX', fmt: 'idx' },
  y10: { name: '美债 10Y', tag: 'TREASURY', fmt: 'pct' },
  gold: { name: '伦敦金', tag: 'SPOT GOLD · XAU', fmt: 'usd' },
  oil: { name: 'WTI 原油', tag: 'ENERGY · CL', fmt: 'usd' },
  dxy: { name: 'DXY 美元指数', tag: 'FX · DXY', fmt: 'idx' },
  vix: { name: 'VIX 恐慌指数', tag: 'VOL · VIX', fmt: 'idx' },
};
const KEYS = Object.keys(META); // 剩余 key(y10)走 else 分支 = 财政部CSV

@Provide()
export class MacroService {
  // 15min 内存缓存:宏观日频,页面常刷也不跟上游要账
  async macro() {
    return cached('macro:overview', 900_000, async () => {
      const rs = await Promise.all(
        KEYS.map(k => safe(async () => ({ ...META[k], ...(await this.one(k)) })))
      );
      const out: Record<string, any> = {};
      let stale = false;
      KEYS.forEach((k, i) => {
        const r = rs[i] as { ok: boolean; data?: any; error?: string }; // strict:false 下联合类型不收窄
        if (r.ok) out[k] = r;
        else if (lastGood?.[k]?.ok) {
          out[k] = { ...lastGood[k], error: r.error }; // 回退旧数据并留本次错误
          stale = true;
        } else out[k] = r;
      });
      if (Object.values(out).some(v => v.ok)) lastGood = out;
      out.stale = stale || undefined;
      return out;
    });
  }

  private async one(key: string) {
    const series = await getSeries(key);
    const last = series[series.length - 1];
    const prev = series[series.length - 2] || last;
    const chg = key === 'y10' ? { bp: chgOf(series).bp, pct: null } : { ...chgOf(series), bp: null };
    // chg24=末两根环比(总览磁贴「日涨跌」用;y10 另给 bp)
    const chg24: { pct: number | null; bp: number | null } = {
      pct: prev.c ? +(((last.c / prev.c) - 1) * 100).toFixed(2) : null,
      bp: key === 'y10' ? Math.round((last.c - prev.c) * 100) : null,
    };
    return { last: last.c, asOf: last.t, chg24, chg30: chg, series };
  }
}
