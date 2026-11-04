import { Provide, Inject } from '@midwayjs/core';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getBuffer, getJson, cached } from '../util/net';
import { dedupeNews } from '../util/news';
import { QtService, quoteCode } from './qt.service';

/*
 * A股行情聚合:腾讯 qt(指数行情,直连)+ 东方财富(涨跌家数/板块/涨停池/全A列表/资讯,走系统代理)。
 * 东方财富 push2 的 clist 接口在本网络偶发空返/断连(疑似边缘限流),统一:
 *   https + &cb=cb(JSONP)拉取,失败隔 ~0.9s 重试一次,再失败整源标 {ok:false,error};
 *   push2 被限流时 emJsonp 自动改走延迟镜像 push2delay(约滞后 15 分钟,同构字段)兜底;
 * 绝不因单一上游不可用让整页白屏。行情按北京时间算日期(收盘后取当日)。
 */
const REF = { referer: 'https://quote.eastmoney.com/', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };
const UT = 'ut=7eea3edcaed734bea9cbfc24409ed989';

// ---------- 纯函数(可单测) ----------

// cb({...});  → {...}(JSONP 解包)
export function stripJsonp(text: string): string {
  const m = text.match(/^[\w.$]*\(([\s\S]*)\)\s*;?\s*$/);
  return m ? m[1] : text;
}

// 东财字段 → number;'-'/空/非数 → null(上游偶发占位符,永不吐 NaN;注意 Number('')===0)
export function num(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------- 资金流向(fflow kline)纯函数 ----------

// 分时行 "2026-09-10 09:31,936944,小单,中单,大单,超大单" → {t:'09:31',d:'2026-09-10',main}
// (主力净额单位元,为该日累计值)
export function parseFlowMin(line: string) {
  const p = String(line || '').split(',');
  const main = num(p[1]);
  const ts = String(p[0] || '');
  const t = ts.slice(11, 16), d = ts.slice(0, 10);
  return (main == null || !/^\d\d:\d\d$/.test(t)) ? null : { t, d, main };
}

// 日线行 "2026-09-10,-3146166272,小单,中单,大单,超大单,..." → {t:'2026-09-10',main}
export function parseFlowDay(line: string) {
  const p = String(line || '').split(',');
  const main = num(p[1]);
  const t = String(p[0] || '').slice(0, 10);
  return (main == null || !/^\d{4}-\d\d-\d\d$/.test(t)) ? null : { t, main };
}

// trends2 分时行 "2026-09-10 09:30,量(手),额(元)"(fields2=f51,f56,f57)→ {t:'09:30', amt}
export function parseTrendMin(line: string) {
  const p = String(line || '').split(',');
  const amt = num(p[2]);
  const t = String(p[0] || '').slice(11, 16);
  return (amt == null || !/^\d\d:\d\d$/.test(t)) ? null : { t, amt };
}

// 两市每分钟成交额对齐相加 → 逐分钟累计 [{t, cum}](单位元;口径与 mergeFlow 一致)
export function cumAmt(a: any[], b: any[]): Array<{ t: string; cum: number }> {
  const m = new Map<string, number>();
  for (const r of [...(a || []), ...(b || [])]) {
    if (!r || typeof r.t !== 'string') continue;
    m.set(r.t, (m.get(r.t) || 0) + r.amt);
  }
  let acc = 0;
  return [...m.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([t, v]) => ({ t, cum: (acc += v) }));
}

// 两市按时间对齐相加(任一边缺该时刻就用另一边;都缺才没有)——分时/日线通用
// 沪深日线主力净额按日期对齐相加(单边缺 → 该边 null,合计只含可用边),升序取最后 n 天
export function mergeDays(
  a: Array<{ t: string; main: number }>, b: Array<{ t: string; main: number }>, n = 7
): Array<{ t: string; main: number; sh: number | null; sz: number | null }> {
  const m = new Map<string, { t: string; main: number; sh: number | null; sz: number | null }>();
  const put = (rows: any[], k: 'sh' | 'sz') => {
    for (const r of rows || []) {
      if (!r || r.main == null) continue;
      const x = m.get(r.t) || { t: r.t, main: 0, sh: null, sz: null };
      x[k] = r.main; x.main += r.main; m.set(r.t, x);
    }
  };
  put(a, 'sh'); put(b, 'sz');
  return [...m.values()].sort((x, y) => (x.t < y.t ? -1 : 1)).slice(-n);
}

// 本地逐日台账:把某市一边按日期写入 store(push2his 在本网络整段拒连时,用分时日终累计补上当日值;
// 日线恢复后官方值自动覆盖本地值)。行取 {t} 或 {d,t}:先找 d(分时),再 t(日线)。只保留最后 n 天。
export type FlowDay = {
  sh: number | null; sz: number | null;
  amt?: { sh: number | null; sz: number | null }; // 当日沪深各自成交额(元):腾讯 qt 记当日,东财官方日K通了回填历史
  hrs?: Record<string, { sh: number | null; sz: number | null }>;
};
export function applyFlowStore(store: Record<string, FlowDay>, k: 'sh' | 'sz', rows: Array<{ t?: string; d?: string; main: number | null }>, n = 7) {
  for (const r of rows || []) {
    const day = r?.d || r?.t;
    if (!day || r.main == null) continue;
    const x = store[day] || (store[day] = { sh: null, sz: null });
    x[k] = r.main;
  }
  const keys = Object.keys(store).sort();
  for (const key of keys.slice(0, Math.max(0, keys.length - n))) delete store[key];
}

// 小时快照:东财 fflow 分钟线只有当日(klt=60 指数不支持),按 A股四个整点(10:30/11:30/14:00/15:00)
// 从分钟累计序列取「该小时末累计值」。整点行缺失时用该小时前最后一行;小时尚未走完(序列里没有其后的行)则不记。
export const FLOW_HOURS = ['10:30', '11:30', '14:00', '15:00'];
export function applyFlowHours(store: Record<string, FlowDay>, k: 'sh' | 'sz', rows: Array<{ t: string; d: string; main: number | null }>) {
  for (const r of rows || []) { if (r?.main != null && r.d) store[r.d] = store[r.d] || { sh: null, sz: null }; }
  for (const [day, x] of Object.entries(store)) {
    const rs = (rows || []).filter(r => r?.d === day && r.main != null).sort((a, b) => (a.t < b.t ? -1 : 1));
    if (!rs.length) continue;
    x.hrs = x.hrs || {};
    for (const h of FLOW_HOURS) {
      const atOrBefore = rs.filter(r => r.t <= h);
      const passed = rs.some(r => r.t > h); // 该小时之后还有行 → 小时已收口
      if (!atOrBefore.length || (!passed && !atOrBefore.some(r => r.t === h))) continue;
      const v = atOrBefore[atOrBefore.length - 1].main;
      (x.hrs[h] = x.hrs[h] || { sh: null, sz: null })[k] = v;
    }
  }
}

const FLOW_FILE = join(process.cwd(), 'data', 'moneyflow_daily.json');
function loadFlowStore(): Record<string, FlowDay> {
  try { return JSON.parse(readFileSync(FLOW_FILE, 'utf8')); } catch { return {}; }
}
function saveFlowStore(s: object) {
  try { writeFileSync(FLOW_FILE, JSON.stringify(s)); } catch { /* 落盘失败下次再记,不影响本次返回 */ }
}

export function mergeFlow(a: any[], b: any[]): Array<{ t: string; main: number }> {
  const m = new Map<string, number>();
  for (const r of [...(a || []), ...(b || [])]) {
    if (!r || typeof r.t !== 'string') continue;
    m.set(r.t, (m.get(r.t) || 0) + r.main);
  }
  return [...m.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([t, main]) => ({ t, main }));
}

// 北向资金 RPT_MUTUAL_DEAL_HISTORY 行 → [{d, sh, sz, total}](新→旧,单位亿元)
// ⚠️ 净买入/买入额自 2024-08 起官方停发(该接口 NET_DEAL_AMT/BUY_AMT 恒为 null),只剩 DEAL_AMT(成交额);
//    DEAL_AMT 原始单位百万元 → /100 得亿元(以「北向日成交额 ~2000-2500 亿」量级校准过)。
export function northRows(rows: any[]) {
  const byDate = new Map<string, any>();
  for (const r of rows || []) {
    const d = String(r?.TRADE_DATE || '').slice(0, 10);
    const v = num(r?.DEAL_AMT);
    if (!/^\d{4}-\d\d-\d\d$/.test(d) || v == null) continue;
    const o = byDate.get(d) || {};
    const t = String(r?.MUTUAL_TYPE || '');
    if (t === '001') o.sh = v / 100; // 沪股通
    else if (t === '003') o.sz = v / 100; // 深股通
    else if (t === '005') o.total = v / 100; // 北向合计
    byDate.set(d, o);
  }
  return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([d, o]) => ({ d, ...o }));
}

// 北京日历 YYYYMMDD(+8h 取其 UTC 日历即北京日历)
function bjDate(): string {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
}

// ulist 涨跌家数(secids=1.000001 沪 / 0.399001 深) → {sh,sz,up,down,flat,ratio}
export function parseBreadth(j: any) {
  const by = (sec: string) => {
    const d = (j?.data?.diff || []).find((x: any) => x?.f12 === sec);
    return d
      ? { up: num(d.f104), down: num(d.f105), flat: num(d.f106) }
      : { up: null, down: null, flat: null };
  };
  const sh = by('000001');
  const sz = by('399001');
  const up = (sh.up ?? 0) + (sz.up ?? 0);
  const down = (sh.down ?? 0) + (sz.down ?? 0);
  const flat = (sh.flat ?? 0) + (sz.flat ?? 0);
  const ratio = up + down > 0 ? up / (up + down) : null; // 上涨占比,温度用
  return { sh, sz, up, down, flat, ratio };
}

// 板块行(行业板块 m:90+t:2)→ 干净对象
export function emBoardRow(r: any) {
  return {
    code: r?.f12,
    name: r?.f14,
    pct: num(r?.f3), // 涨跌幅 %
    mainNet: num(r?.f62), // 主力净流入(元)
    mainPct: num(r?.f184), // 主力净流入净占比 %
    leadUp: r?.f128 || null, // 领涨股名(东财板块自带)
    leadPct: num(r?.f136), // 领涨股涨幅 %
  };
}

// 全A个股行 → 干净对象(机会评分与异动共用)
export function emStockRow(r: any) {
  return {
    code: r?.f12,
    name: r?.f14,
    price: num(r?.f2),
    pct: num(r?.f3),
    amount: num(r?.f6), // 成交额(元)
    turn: num(r?.f8), // 换手 %
    pe: num(r?.f9), // 市盈率(动)
    volRatio: num(r?.f10), // 量比(上市首日 '-')
    mcap: num(r?.f20), // 总市值(元)
    pb: num(r?.f23),
    mainNet: num(r?.f62), // 主力净流入(元)
    ind: r?.f100, // 所属行业
  };
}

// 涨停/跌停池行 → {name,code,pct,mainNet,amount,board,lb(连板数),hs}
export function emPoolRow(r: any) {
  return {
    code: r?.c,
    name: r?.n,
    pct: num(r?.zdp),
    mainNet: num(r?.fund), // 主力净流入(元)
    amount: num(r?.amount), // 成交额(元)
    hs: num(r?.hs), // 换手 %
    lb: num(r?.lbc), // 连板数
    board: r?.hybk, // 所属行业
  };
}

// ---------- 趋势投资派(腾讯日K + 本地技术指标,纯函数可单测) ----------

// 腾讯 fqkline 行 [date,开,收,高,低,量,...] → 升序 bars;不足 61 根抛错(算不了 MA60/量能基准)
export function parseTencentKline(rows: any[]): Array<{ c: number; h: number; v: number }> {
  const bars = (rows || [])
    .map(r => ({ c: num(r?.[2]), h: num(r?.[3]), v: num(r?.[5]) }))
    .filter((b): b is { c: number; h: number; v: number } => b.c != null && b.h != null && b.v != null);
  if (bars.length < 61) throw new Error('日K不足60根,无法计算趋势指标');
  return bars;
}

const sma = (xs: number[], n: number, i = xs.length - 1) =>
  i + 1 >= n ? xs.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n : null;

// MACD 12/26/9(柱 = 2*(DIF-DEA),A股红绿柱惯例);初值取首收盘(>100根后误差可忽略)
export function macdSeries(closes: number[]) {
  const e12: number[] = [], e26: number[] = [], dif: number[] = [], dea: number[] = [];
  closes.forEach((c, i) => {
    e12.push(i ? e12[i - 1] * 11 / 12 + c / 12 : c);
    e26.push(i ? e26[i - 1] * 25 / 26 + c / 26 : c);
    dif.push(e12[i] - e26[i]);
  });
  dif.forEach((d, i) => dea.push(i ? dea[i - 1] * 8 / 9 + d / 9 : d));
  return { dif, dea, hist: dif.map((d, i) => 2 * (d - dea[i])) };
}

// RSI14(Wilder 平滑);全平盘给 50(中性)
export function rsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= 14; i++) {
    const d = closes[i] - closes[i - 1];
    gain += Math.max(d, 0); loss += Math.max(-d, 0);
  }
  gain /= 14; loss /= 14;
  for (let i = 15; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * 13 + Math.max(d, 0)) / 14;
    loss = (loss * 13 + Math.max(-d, 0)) / 14;
  }
  if (gain + loss === 0) return 50;
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

// bars(升序,≥61)→ 趋势流派指标:MA 多头/站线/MACD/RSI/量能5÷60/20日涨幅/60日新高
export function klineInd(bars: Array<{ c: number; h: number; v: number }>) {
  const closes = bars.map(b => b.c), vols = bars.map(b => b.v), n = bars.length - 1;
  const ma5 = sma(closes, 5), ma10 = sma(closes, 10), ma20 = sma(closes, 20), ma60 = sma(closes, 60);
  const ma20Prev = sma(closes, 20, n - 1);
  const { dif, dea, hist } = macdSeries(closes);
  const L = hist.length - 1;
  const redGrow = hist[L] > 0 && hist[L] > hist[L - 1] && hist[L - 1] > hist[L - 2]; // 红柱连2根放大
  const vol5 = sma(vols, 5), vol60 = sma(vols, 60);
  const hi60Prev = Math.max(...bars.slice(n - 60, n).map(b => b.h)); // 前60根最高(不含今)
  return {
    ma5, ma10, ma20, ma60,
    maBull: !!ma5 && !!ma10 && !!ma20 && !!ma60 &&
      ma5 > ma10 && ma10 > ma20 && ma20 > ma60 && ma20 > (ma20Prev ?? ma20),
    aboveMa20: !!ma20 && closes[n] > ma20,
    dif: +dif[L].toFixed(3), dea: +dea[L].toFixed(3), hist: +hist[L].toFixed(3),
    macdUp: (dif[L] > 0 && dif[L] > dea[L]) || redGrow, // 零轴上金叉态 或 红柱放大
    rsi: rsi14(closes),
    vol5_60: vol60 && vol60 > 0 ? (vol5 as number) / vol60 : null,
    chg20: closes[n - 20] ? (closes[n] / closes[n - 20] - 1) * 100 : null,
    newHigh60: closes[n] >= hi60Prev,
  };
}

// 区间涨跌%(原在 holding.service,2026-10-14 挪来此处与股票观察 watch() 共用;holding.service re-export 保调用方/单测不动):
// 每只 1/7/30/90/180/365 自然日(d1 为币圈列表追加,A股只用 d7+);基准=最后一根K日期往前 N 自然日内最后一个收盘价;
// 现价优先用实时报价(盘中K末根可能滞后),取不到落K末根;历史不足该周期(次新股)回 null,不编数
export function periodChg(rows: any[], priceNow: number | null) {
  const bars = (rows || [])
    .map((r: any) => ({ t: Date.parse(`${String(r?.[0])}T00:00:00`), c: +r?.[2] }))
    .filter((b: any) => isFinite(b.t) && b.c > 0)
    .sort((a: any, b: any) => a.t - b.t);
  const last = bars[bars.length - 1];
  const cur = priceNow && priceNow > 0 ? priceNow : last ? last.c : null;
  const out: Record<string, number | null> = {};
  for (const N of [1, 7, 30, 90, 180, 365]) {
    let pct: number | null = null;
    if (last && cur != null) {
      const target = last.t - N * 864e5;
      for (let i = bars.length - 1; i >= 0; i--) {
        if (bars[i].t <= target) { pct = +((cur / bars[i].c - 1) * 100).toFixed(1); break; }
      }
    }
    out[`d${N}`] = pct;
  }
  return out;
}

// ---------- 基金观察(A股页小模块,2026-09-22 用户要求) ----------
// 源:东财 fundmobapi(免key无referer,实测直连)——
//   区间收益 FundMNPeriodIncrease Datas[].{title,syl}:Z周/Y月/3Y季/1N年/3N三年/LN成立以来(均净值口径);成立不足3年 3N 为空 → 前端落 LN(成立以来)。
//   行情列(24h最高/最低/成交额/总市值)只有场内 ETF 有,取腾讯 qt 同一行,场外回 null。
//   今日涨跌:场内 ETF 走腾讯 qt 成交价(与指数同源);场外无实时价,落 HisNetList 首行 JZZZL(最新净值涨跌幅,QDII T+1 属基金口径)。
// 基金清单一行一只,编辑 data/fund_watch.json 即增删(代码6位,ex=是否场内)。

// FundMNPeriodIncrease Datas[] → 区间收益(净值口径);空串/'--'/脏值 → null
// title 码:Z=近1周 Y=近1月 3Y=近3月 1N=近1年 3N=近3年 LN=成立以来(2026-09-22 实测)
export function fundPeriods(datas: any[]) {
  const g = (t: string) => num((datas || []).find((d: any) => d && d.title === t)?.syl);
  return { r7d: g('Z'), r30d: g('Y'), r90d: g('3Y'), r1y: g('1N'), r3y: g('3N'), ln: g('LN') };
}

// FundMNHisNetList Datas[0] → 最新净值日 + 当日涨跌幅
export function fundNavLatest(datas: any[]): { date: string | null; chg: number | null } {
  const r = (datas || [])[0];
  return r ? { date: r.FSRQ ? String(r.FSRQ) : null, chg: num(r.JZZZL) } : { date: null, chg: null };
}

// 场内 ETF → 腾讯代码:首位 5/6=沪(51/56/58 系),其余=深(15/16 系)。⚠️ 不能复用 quoteCode(A股 6→sh 规则会判错)
export function fundQtCode(code: string): string {
  return (/^[56]/.test(String(code)) ? 'sh' : 'sz') + code;
}

// 趋势分(封顶100):形态50 + 量能30 + 动量20 + 板块共振5。硬门槛(maBull/站线/量能/RSI 区间)在 trendPicks 里过滤。
export function trendScore(ind: ReturnType<typeof klineInd>, r: any, sameInd: number) {
  let s = 0;
  if (ind.maBull) s += 15;
  if (ind.aboveMa20) s += 5;
  if (ind.macdUp) s += 10;
  if (ind.rsi != null && ind.rsi >= 50 && ind.rsi <= 70) s += 10;
  if (ind.newHigh60) s += 10;
  const v = ind.vol5_60 ?? 0;
  s += v >= 2 ? 20 : v > 1.5 ? 12 : 0;
  const turn = num(r?.turn);
  if (turn != null && turn >= 5 && turn <= 15) s += 5;
  if ((num(r?.mainNet) ?? 0) >= 1e8) s += 5;
  const c = ind.chg20 ?? 0;
  s += c >= 30 ? 20 : c >= 15 ? 14 : c >= 5 ? 8 : 0;
  return Math.min(100, s + (sameInd >= 2 ? 5 : 0));
}

// ---------- 服务 ----------

function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}
function safe<T>(fn: () => Promise<T>) {
  return fn().then(
    data => ({ ok: true as const, data }),
    e => ({ ok: false as const, error: String(e?.message || e) })
  );
}
// clist 是本网络最容易被打限流的接口(实测连发 3-4 次后进入分钟级静默拒绝)。
// 全 service 的 clist 走同一条串行链,相邻间隔 380ms —— 整页一次加载共 ~5 次,
// 平铺在 ~2s 内,而不是同秒并发爆掉配额。push2ex(涨停池)/ulist/np-listapi 不受此限,仍可并行。
let clistChain: Promise<any> = Promise.resolve();
function qClist<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const p = clistChain.then(async () => {
    await sleep(380); // 每次 clist 之间留间隔
    return fn();
  });
  clistChain = p.then(() => undefined, () => undefined);
  return p;
}
// 东财接口被限流时会持续失败数分钟(本机实测有"秒断"与"挂到超时"两种形态)。
// emDown 记「主机冷却到何时」:限流按主机维度,一次 clist 失败意味着同主机其余调用大概率也失败,
// 冷却整主机让 boards 多路 clist 与板块请求快速红卡,而不是各自把 9s×2 超时吃满。
// push2(实时)被限流时,改走本网络可达的延迟镜像主机 push2delay.eastmoney.com(数据约滞后 15 分钟,
// 行情可用性优先);镜像兜底成功后把 push2 冷却拉长到 5 分钟,免得每 12s 撞一次超时,到点自动复测自愈。
const emDown = new Map<string, number>(); // host -> 冷却截止时间戳
const emHost = (url: string) => new URL(url).host;
const PUSH2 = 'push2.eastmoney.com';
const PUSH2D = 'push2delay.eastmoney.com';
async function emJsonp(url: string): Promise<any> {
  const host = emHost(url);
  // push2(实时)与 push2his(日线)都备延迟镜像:实测 push2delay 同样应答 daykline/clist(日线本无实时性,滞后无所谓)
  const alt = host === PUSH2 || host === 'push2his.eastmoney.com' ? url.replace(host, PUSH2D) : null;
  // 实时主机 push2 本网络时常整段不可达(http=000/超时):有延迟镜像备选时只试 1 次就切,省 ~10s 干等
  const cands: Array<[string, number]> = alt ? [[url, 1], [alt, 1]] : [[url, 2]]; // [url, 尝试次数]
  let lastErr: any = new Error('东方财富接口两次请求失败');
  for (const [u, tries] of cands) {
    const h = emHost(u);
    const cd = emDown.get(h);
    if (cd && Date.now() < cd) { lastErr = new Error('东方财富接口暂不可用(限流冷却中)'); continue; }
    for (let i = 0; i < tries; i++) {
      try {
        const buf = await getBuffer(u, 9000, REF);
        const j = JSON.parse(stripJsonp(Buffer.from(buf).toString('utf8')));
        emDown.delete(h); // 成功即解除该主机冷却
        if (alt && u !== url) emDown.set(host, Date.now() + 300_000); // 镜像兜底成功:主主机 5 分钟后再复测
        return j;
      } catch (e) {
        lastErr = e;
        if (i === 0) await sleep(900);
      }
    }
    emDown.set(h, Date.now() + 120_000); // 失败冷却 2 分钟(限流/整段不可达通常持续数分钟),到点自动复测
  }
  throw lastErr;
}
// 排序拉全A列表:取前 pz 行(po=1 降序,po=0 升序),串行走 clist 队列
async function clistSort(rank: string, pz: number, po: number, fields: string) {
  const url =
    `https://push2.eastmoney.com/api/qt/clist/get?${UT}&fltt=2&invt=2&fid=${rank}&po=${po}` +
    `&pn=1&pz=${pz}&np=1&fs=m%3A0%2Bt%3A6%2Cm%3A0%2Bt%3A80%2Cm%3A1%2Bt%3A2%2Cm%3A1%2Bt%3A23&fields=${fields}&cb=cb`;
  const j = await qClist(url, () => emJsonp(url));
  return ((j?.data?.diff) || []).map(emStockRow).filter((r: any) => r?.code && r?.name);
}

@Provide()
export class AShareService {
  @Inject()
  qtService: QtService;

  // ① 市场概况:指数行情(4卡 + 深证综指算两市成交额)+ 涨跌家数 + 涨跌停家数
  async market() {
    return cached('stk:market', 60_000, async () => {
      const codes = ['sh000001', 'sz399001', 'sz399006', 'sh000688', 'sz399106'];
      const rows = (q: Record<string, any>, cs: string[]) =>
        cs.map(code => {
          const r = q[code];
          return r
            ? { code, ok: true as const, name: r.name, price: r.price, chg: r.chg, chgPct: r.chgPct, amountWan: r.amountWan, time: r.time }
            : { code, ok: false as const, error: '该代码无行情' };
        });
      const qt = await safe(async () => rows(await this.qtService.quotes(codes), codes));
      // 港股指数(恒指/恒生科技):用户 2026-09-20 要求并入首页大盘带;qt hk 行列位与 A股指数同构
      // (f3价/f31涨跌/f32涨跌幅),时间格式是「YYYY-MM-DD HH:mm:ss」;单列信封,股票页 ① 不消费
      const hkCodes = ['hkHSI', 'hkHSTECH'];
      const hk = await safe(async () => rows(await this.qtService.quotes(hkCodes), hkCodes));
      // 涨跌家数:东财 ulist(https 直返 JSON,不需 cb)
      const breadth = await safe(async () => {
        const j = await emJsonp(
          `https://push2.eastmoney.com/api/qt/ulist.np/get?${UT}&fltt=2&secids=1.000001,0.399001&fields=f12,f14,f104,f105,f106`
        );
        return parseBreadth(j);
      });
      // 涨停/跌停家数:异动池总数(date 取北京当日;周末/盘前 tc=0 是有效零)
      const limit = await safe(async () => {
        const date = bjDate();
        const [zt, dt] = await Promise.all([
          emJsonp(`https://push2ex.eastmoney.com/getTopicZTPool?${UT}&dpt=wz.ztzt&Pageindex=0&pagesize=1&sort=fbt%3Aasc&date=${date}`),
          emJsonp(`https://push2ex.eastmoney.com/getTopicDTPool?${UT}&dpt=wz.ztzt&Pageindex=0&pagesize=1&sort=fbt%3Aasc&date=${date}`),
        ]);
        if (zt?.data == null && dt?.data == null) throw new Error('涨停池为空');
        return { date, zt: num(zt?.data?.tc) ?? 0, dt: num(dt?.data?.tc) ?? 0 };
      });
      // 上证指数近35日日线(总览改版 2026-09-20:②板块上证大卡面积 spark 用)。
      // 新浪 cn 日K 免key直连;只有成交量无成交额(成交额另走 moneyflow amt)
      const shK = await safe(async () => {
        const j = await getJson(
          'https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=sh000001&scale=240&ma=no&datalen=35',
          10000,
          { referer: 'https://finance.sina.com.cn/' }
        );
        const out = (j || []).map((r: any) => ({ t: String(r.day).slice(0, 10), c: +r.close }));
        if (out.length < 5) throw new Error('新浪上证日K不足');
        return out;
      });
      return { qt, hk, breadth, limit, shK };
    });
  }

  // 板块最近一次成功采集时刻(2026-10-20 东财 clist 路径级 502 调查后):cached 走缓存/故障回放时此值不变,
  // 控制器 asOf 带出,页面据「距今>10min」如实标「限流回放·截至 HH:mm」
  boardsOkAt = 0;

  // ② 板块行情 + ④ 资金同源:全行业板块分页拉回,排序交给前端 tab
  // ⚠️ 东财 clist 的 pz 硬上限 100(传 500 也只回 100 行,实测 2026-09-22):旧版单请求 pn=1 只拿到
  // 涨幅前 100(≈496 个行业的头部),跌幅榜只能在涨的里面挑「最不涨」——用户对照同花顺抓包。
  // 故按首页回的 total 逐页拉全;qClist 本就串行 + 380ms 间隔,限流风险与多路 clist 同量级。
  async boards() {
    return cached('stk:boards', 60_000, async () => {
      const mk = (pn: number) =>
        `https://push2.eastmoney.com/api/qt/clist/get?${UT}&fltt=2&invt=2&fid=f3&po=1&pn=${pn}&pz=100&np=1` +
        `&fs=m%3A90%2Bt%3A2&fields=f12,f14,f3,f62,f184,f128,f136&cb=cb`;
      const grab = async (pn: number) => {
        const u = mk(pn);
        const j = await qClist(u, () => emJsonp(u));
        return { total: Number(j?.data?.total) || 0, diff: (j?.data?.diff || []) as any[] };
      };
      const p1 = await grab(1);
      let diff = p1.diff;
      for (let pn = 2; (pn - 1) * 100 < p1.total && diff.length < p1.total; pn++) {
        const r = await grab(pn);
        if (!r.diff.length) break; // 空页=已到底(total 漂移时提前收)
        diff = diff.concat(r.diff);
      }
      // 剔「Ⅲ」后缀三级行业(如 游戏Ⅲ/证券Ⅲ):与二级父板块成分大量重合、数值常雷同,会白占榜单席位
      const rows = diff.map(emBoardRow).filter((r: any) => r?.code && r?.name && !/Ⅲ$/.test(String(r.name)));
      if (!rows.length) throw new Error('板块列表为空');
      this.boardsOkAt = Date.now(); // 只在真拉到数时更新;回放时不变=数据时刻
      return rows;
    });
  }

  // ② 榜单「原因」:按板块名搜东财新闻(sort=time),取 3 日内最新命中文章的标题当原因。
  // 免费口径里没有现成「板块涨跌解读」端点,新闻标题是最接近的事实原因;按板块缓存 10 分钟省配额,
  // 搜不到回 null(前端只展示领涨股/资金事实行)。单板块失败不拖整批。
  private reasonCache = new Map<string, { at: number; r: { title: string; date: string; url: string } | null }>();
  async boardReasons(names: string[]) {
    const out: Record<string, any> = {};
    await Promise.all((names || []).slice(0, 12).map(async n => {
      const c = this.reasonCache.get(n);
      if (c && Date.now() - c.at < 600_000) { out[n] = c.r; return; }
      let r: any = null;
      try {
        const param = JSON.stringify({
          uid: '', keyword: n, type: ['cmsArticleWebOld'], client: 'web', clientType: 'web', clientVersion: 'curr',
          param: { cmsArticleWebOld: { searchScope: 'default', sort: 'time', pageIndex: 1, pageSize: 3, preTag: '', postTag: '' } },
        });
        const j = await emJsonp(`https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=${encodeURIComponent(param)}`);
        const arts = (j?.result?.cmsArticleWebOld) || [];
        const t0 = Date.now() - 3 * 86400e3;
        const hit = arts.find((a: any) => a?.title && new Date(String(a.date).replace(' ', 'T') + '+08:00').getTime() > t0);
        if (hit) r = { title: String(hit.title), date: String(hit.date), url: String(hit.url || '').replace(/^http:/, 'https:') };
      } catch { /* 检索失败=无原因 */ }
      this.reasonCache.set(n, { at: Date.now(), r });
      out[n] = r;
    }));
    return out;
  }

  // ③ 今日机会候选 + ⑥ 异动源:全A 四路排序(涨/资金/跌/量比),字段足够启发式评分
  async opportunity() {
    return cached('stk:opp', 60_000, async () => {
      const F = 'f2,f3,f6,f8,f9,f10,f12,f14,f20,f23,f62,f100';
      const bySort = (rank: string, pz: number, po: number) =>
        safe(() => clistSort(rank, pz, po, F));
      const [chgTop, fundTop, down, vol] = await Promise.all([
        bySort('f3', 40, 1), // 当日涨幅前 40
        bySort('f62', 40, 1), // 主力净流入前 40
        bySort('f3', 10, 0), // 当日跌幅前 10
        bySort('f10', 10, 1), // 量比前 10
      ]);
      const atLeastOne = [chgTop, fundTop, down, vol].some(r => r.ok);
      if (!atLeastOne) {
        const f = [chgTop, fundTop, down, vol].find((r): r is { ok: false; error: string } => !r.ok);
        throw new Error(f?.error || '全A列表不可用');
      }
      const cands: any[] = [];
      for (const r of [chgTop, fundTop]) {
        if (r.ok) for (const x of r.data) {
          if (!cands.some(y => y.code === x.code)) cands.push(x);
        }
      }
      return {
        cands: cands.sort((a, b) => (b.pct ?? -1e9) - (a.pct ?? -1e9)), // 评分取 top,排序参考涨幅
        down: down.ok ? down.data : [],
        vol: vol.ok ? vol.data : [],
        partial: { chg: chgTop.ok, fund: fundTop.ok, down: down.ok, vol: vol.ok },
      };
    });
  }

  // ③ 趋势投资派:全A候选粗筛(涨/换手/量比/主力净)→ 前12只拉腾讯日K(直连免key)→
  // 硬门槛 MA多头+站MA20+量5÷60>1.5+RSI∈[50,70] → trendScore 取前5。东财挂则整卡红 ✗(机会池同源)。
  async trendPicks() {
    return cached('stk:trend', 60_000, async () => {
      const opp = await this.opportunity(); // 命中 stk:opp 60s 缓存,不额外打 clist
      const pool = opp.cands.filter((r: any) =>
        r.pct > 0 && r.pct < 9.8 && r.turn >= 3 && r.turn <= 20 &&
        (r.volRatio ?? 0) >= 1.2 && (r.mainNet ?? 0) > 0);
      if (!pool.length) return { rows: [] as any[], pool: 0, screened: 0, passed: 0 };
      const pre = [...pool].sort((a, b) => (b.mainNet ?? 0) - (a.mainNet ?? 0)).slice(0, 12);
      const kl = await Promise.all(pre.map(r => {
        const t = String(r.code || '').startsWith('6') ? 'sh' : 'sz'; // A股首位判市,同 qt.service
        return safe(async () => {
          const j = await getJson(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${t}${r.code},day,,,120,qfq`, 9000);
          const d = j?.data?.[`${t}${r.code}`];
          return parseTencentKline(d?.qfqday || d?.day || []);
        });
      }));
      const withInd = pre
        .map((r, i) => ({ r, k: kl[i] }))
        .filter((x: any) => x.k.ok)
        .map((x: any) => ({ r: x.r, tech: klineInd(x.k.data) as any }));
      const pass = withInd.filter((x: any) =>
        x.tech.maBull && x.tech.aboveMa20 && (x.tech.vol5_60 ?? 0) > 1.5 &&
        x.tech.rsi != null && x.tech.rsi >= 50 && x.tech.rsi <= 70);
      const cnt: Record<string, number> = {};
      for (const x of pass) cnt[x.r.ind || ''] = (cnt[x.r.ind || ''] || 0) + 1; // 同行业入选数(板块共振代理)
      const rows = pass
        .map((x: any) => ({ ...x.r, tech: x.tech, sameInd: cnt[x.r.ind || ''] || 0, score: trendScore(x.tech, x.r, cnt[x.r.ind || ''] || 0) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      return { rows, pool: pool.length, screened: pre.length, passed: pass.length };
    });
  }

  // 基金观察:读 data/fund_watch.json 清单,区间收益(东财 fundmob)+ 今日涨跌(场内腾讯qt/场外净值),60s 缓存。
  // 逐只/逐路失败只让对应字段回 null(前端显示 —),单只挂不拖整排。
  async funds() {
    return cached('stk:funds', 60_000, async () => {
      const list = JSON.parse(readFileSync(join(process.cwd(), 'data', 'fund_watch.json'), 'utf8')) as
        Array<{ code: string; name: string; ex: boolean }>;
      if (!Array.isArray(list) || !list.length) throw new Error('fund_watch.json 为空');
      const mob = (api: string, code: string) =>
        getJson(`https://fundmobapi.eastmoney.com/FundMNewApi/${api}?FCODE=${code}&deviceid=Wap&plat=Wap&product=EFund&version=6.0.0`, 9000);
      const per = await Promise.all(list.map(f => safe(async () => fundPeriods((await mob('FundMNPeriodIncrease', f.code))?.Datas))));
      const nav = await Promise.all(list.map(f =>
        f.ex ? Promise.resolve(null as any) : safe(async () => fundNavLatest((await mob('FundMNHisNetList', f.code))?.Datas))));
      const exCodes = list.filter(f => f.ex).map(f => fundQtCode(f.code));
      const qtm: any = exCodes.length ? await safe(async () => this.qtService.quotes(exCodes)) : { ok: false };
      return list.map((f, i) => {
        const p = (per[i] as any).ok ? (per[i] as any).data : null;
        const n = nav[i] && (nav[i] as any).ok ? (nav[i] as any).data : null;
        const q = qtm.ok ? qtm.data[fundQtCode(f.code)] : null;
        return {
          code: f.code, name: f.name, ex: !!f.ex,
          day: f.ex ? (Number.isFinite(q?.chgPct) ? q.chgPct : null) : (n ? n.chg : null),
          dayDate: f.ex ? null : (n ? n.date : null),
          r7d: p ? p.r7d : null, r30d: p ? p.r30d : null, r90d: p ? p.r90d : null,
          r1y: p ? p.r1y : null, r3y: p ? p.r3y : null, ln: p ? p.ln : null,
          // 行情四列仅场内 ETF(qt)有:24h最高/最低=价、成交额=万元→亿、总市值=场内规模口径(亿)
          hi: q && Number.isFinite(q.high) ? q.high : null,
          lo: q && Number.isFinite(q.low) ? q.low : null,
          amt: q && q.amountWan != null ? q.amountWan / 1e4 : null,
          mcap: q && q.mcapYi != null ? q.mcapYi : null,
        };
      });
    });
  }

  // 股票观察(2026-10-14 用户要求,参考基金观察):清单 data/stock_watch.json {code,name,cat?},60s 缓存。
  // 现价/今日涨跌/PE/PB/高低/成交额/市值 = 腾讯 qt;7/30/90/180/365 日涨跌 = 前复权日K periodChg(含分红,与持仓复盘同口径)。
  // 逐路失败只让对应字段回 null(前端显 —);类别 cat 省略时由前端纯函数 stkCat 按名称关键词兜底归类(排序逻辑与基金一致)。
  async watch() {
    return cached('stk:watch', 60_000, async () => {
      const list = JSON.parse(readFileSync(join(process.cwd(), 'data', 'stock_watch.json'), 'utf8')) as
        Array<{ code: string; name: string; cat?: string }>;
      if (!Array.isArray(list) || !list.length) throw new Error('stock_watch.json 为空');
      const tc = (code: string) => quoteCode(code, 'A股');
      const qtm: any = await safe(async () => this.qtService.quotes(list.map(f => tc(f.code))));
      const pcs = await Promise.all(list.map(f =>
        safe(async () => {
          const j: any = await getJson(
            `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tc(f.code)},day,,,320,qfq`, 9000
          );
          const raw = j?.data?.[tc(f.code)]?.qfqday || j?.data?.[tc(f.code)]?.day || [];
          if (!raw.length) throw new Error('日K为空');
          return periodChg(raw, qtm.ok ? qtm.data[tc(f.code)]?.price ?? null : null);
        })
      ));
      return list.map((f, i) => {
        const q = qtm.ok ? qtm.data[tc(f.code)] : null;
        const pc = (pcs[i] as any).ok ? (pcs[i] as any).data : null;
        return {
          code: f.code, name: f.name, cat: f.cat || null,
          price: q && Number.isFinite(q.price) ? q.price : null,
          day: q && Number.isFinite(q.chgPct) ? q.chgPct : null,
          pe: q?.pe ?? null, pb: q?.pb ?? null,
          amt: q && q.amountWan != null ? q.amountWan / 1e4 : null,
          mcap: q && q.mcapYi != null ? q.mcapYi : null,
          pc,
        };
      });
    });
  }

  // ④ 市场资金:涨停池(主力聚焦;连板/异动前端从 rows 派生)——板块资金 Top 前端复用 /boards 数据
  async flow() {
    return cached('stk:flow', 60_000, async () => {
      const date = bjDate();
      const j = await emJsonp(
        `https://push2ex.eastmoney.com/getTopicZTPool?${UT}&dpt=wz.ztzt&Pageindex=0&pagesize=80&sort=fund%3Adesc&date=${date}`
      );
      const rows = ((j?.data?.pool) || []).map(emPoolRow).filter((r: any) => r?.code);
      return { date, rows };
    });
  }

  // ② 资金流向趋势:近 7 个交易日主力净额(沪=上证指数、深=深证成指,按日相加)
  // push2his 与 push2 分时在本网络常年时通时断(实测 502/reset/空返),emJsonp 落 push2delay 镜像且镜像日线只有最新 1 根;
  // 因此多路并试(官方日线→镜像日线→分时日终累计→板块f62合计),任一活着都记入本地台账 data/moneyflow_daily.json,
  // 逐日攒出近7日曲线,官方日线通了自动回填/覆盖更早日期。板块合计不分成沪深,记为 sh/sz 皆 null 的合计行(前端标「两市合计」)。
  async moneyflow() {
    return cached('stk:mf', 60_000, async () => {
      const store = loadFlowStore();
      const klines = (u: string, fn: (s: string) => any) =>
        emJsonp(u).then(j => (((j?.data?.klines) || []) as any[]).map(fn).filter(Boolean));
      const dayUrl = (secid: string, host: string) =>
        `https://${host}.eastmoney.com/api/qt/stock/fflow/daykline/get?${UT}&lmt=10&klt=101&secid=${secid}` +
        `&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56&cb=cb`;
      const day = (secid: string, k: 'sh' | 'sz') => safe(async () => {
        let rows = await klines(dayUrl(secid, 'push2his'), parseFlowDay);
        if (!rows.length) rows = await klines(dayUrl(secid, 'push2delay'), parseFlowDay); // 空返(rc:100)也算不可用,再试镜像
        if (!rows.length) throw new Error('日线空返(含镜像)');
        applyFlowStore(store, k, rows);
        return rows.length;
      });
      const min = (secid: string, k: 'sh' | 'sz') => safe(async () => { // 当日分钟累计:整点快照入台账,末值补当日线(镜像/收盘后常空,自动跳过)
        const rows = await klines(
          `https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?${UT}&lmt=0&klt=1&secid=${secid}&fields1=f1,f2,f3,f7&fields2=f51,f52&cb=cb`,
          parseFlowMin);
        if (!rows.length) throw new Error('分时空返');
        applyFlowHours(store, k, rows);
        applyFlowStore(store, k, [rows[rows.length - 1]]); // 当日日值随盘中分钟滚动;收盘后与官方日线同值,互覆无害
        return rows;
      });
      const board = safe(async () => { // 兜底:行业板块主力净额合计 ≈ 两市当日(拆不开沪深)
        const b = await this.boards();
        if (!Array.isArray(b) || !b.some((x: any) => x.mainNet != null)) throw new Error('板块净额空返');
        return { d: bjDate().replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'), main: b.reduce((a: number, x: any) => a + (x.mainNet || 0), 0) };
      });
      const amt = safe(async () => { // 两市成交额(腾讯 qt,稳定直连)记台账;「较昨日」隔日起自动生效
        const q = await this.qtService.quotes(['sh000001', 'sz399001']);
        const a = q['sh000001'] && q['sh000001'].amountWan, b = q['sz399001'] && q['sz399001'].amountWan;
        if (a == null || b == null) throw new Error('成交额缺值');
        const today = bjDate().replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
        (store[today] = store[today] || { sh: null, sz: null }).amt = { sh: a * 1e4, sz: b * 1e4 };
        return today;
      });
      const amtDay = (secid: string, k: 'sh' | 'sz') => safe(async () => { // push2his 通了即回填 10 日成交额(官方口径覆盖台账)
        const rows = await klines(
          `https://push2his.eastmoney.com/api/qt/stock/kline/get?${UT}&klt=101&fqt=0&lmt=10&secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f57&cb=cb`,
          (str: string) => { const [dt, a] = str.split(','); return dt && isFinite(+a) ? { d: dt, a: +a } : null; });
        if (!rows.length) throw new Error('日K成交空返');
        for (const r of rows) {
          const x = store[r.d] || (store[r.d] = { sh: null, sz: null });
          x.amt = x.amt || { sh: null, sz: null };
          x.amt[k] = r.a;
        }
        return rows.length;
      });
      const [shD, szD, shM, szM, bd] = await Promise.all([
        day('1.000001', 'sh'), day('0.399001', 'sz'), min('1.000001', 'sh'), min('0.399001', 'sz'), board,
        amt.then(() => 0), amtDay('1.000001', 'sh').then(() => 0), amtDay('0.399001', 'sz').then(() => 0), // 结果都写进 store
      ]);
      saveFlowStore(store);
      const toRows = (k: 'sh' | 'sz') =>
        Object.entries(store).filter(([, v]) => v[k] != null).map(([t, v]) => ({ t, main: v[k] as number }));
      const days = mergeDays(toRows('sh'), toRows('sz'));
      if (bd.ok && !days.some(x => x.t === bd.data.d)) days.push({ t: bd.data.d, main: bd.data.main, sh: null, sz: null });
      const errs = [shD, szD, shM, szM, bd].filter((r: any) => !r.ok).map((r: any) => r.error);
      if (!days.length) throw new Error(errs.join(' | ') || '东财资金流均不可用');
      // 有整点快照的日子带 hours(当日累计到该整点);没有就是单根日线,前端按「有多少画多少」渲染
      const withH = days.map(x => {
        const h = store[x.t] && store[x.t].hrs;
        const hours = h ? FLOW_HOURS.filter(t => h[t] && (h[t].sh != null || h[t].sz != null))
          .map(t => ({ t, sh: h[t].sh, sz: h[t].sz, main: (h[t].sh ?? 0) + (h[t].sz ?? 0) })) : [];
        return hours.length ? { ...x, hours } : x;
      });
      // 沪深成交额逐日序列(台账,含官方回填);要点卡用合计 较昨日
      const amtDays = Object.entries(store)
        .filter(([, v]) => v.amt && typeof v.amt === 'object')
        .map(([t, v]) => ({ t, sh: (v.amt as any).sh ?? null, sz: (v.amt as any).sz ?? null }))
        .sort((a, b) => (a.t < b.t ? -1 : 1)).slice(-7);
      const sumA = (x: any) => (x && x.sh != null && x.sz != null ? x.sh + x.sz : null);
      const LA = amtDays[amtDays.length - 1], PA = amtDays[amtDays.length - 2];
      const amtObj = LA ? { d: LA.t, today: sumA(LA), prev: PA ? sumA(PA) : null } : null;
      return {
        days: withH.slice(-7), amtDays, amt: amtObj,
        sh: days.some(x => x.sh != null), sz: days.some(x => x.sz != null),
      };
    });
  }

  // 北向资金(成交额口径;净买入已停发,见 northRows 注释)。日频数据,缓存 1 小时
  async northbound() {
    return cached('stk:nb', 3600_000, async () => {
      const j = await emJsonp(
        'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_MUTUAL_DEAL_HISTORY' +
        '&columns=ALL&sortColumns=TRADE_DATE&sortTypes=-1&pageSize=9&pageNumber=1&source=WEB&client=WEB'
      );
      const rows = northRows(j?.result?.data || []);
      if (!rows.length) throw new Error('北向成交额为空');
      return { latest: rows[0], prev: rows[1] || null };
    });
  }

  // ⑤ 重要资讯:346 要闻/宏观 353 盘面 355 公司;去重贴标
  async news() {
    return cached('stk:news', 60_000, async () => {
      const col = async (column: string) => {
        const j = await emJsonp(
          `https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?client=web&biz=web_news_col&column=${column}` +
          `&order=1&needInteractData=0&page_index=1&page_size=8&req_trace=stk`
        );
        return ((j?.data?.list) || []).filter((x: any) => x?.title);
      };
      const seen = new Set<string>();
      let rows: any[] = [];
      for (const c of ['346', '353', '355']) {
        for (const x of await col(c)) {
          const key = x.code || x.title;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(x);
          if (rows.length >= 16) break;
        }
        if (rows.length >= 16) break;
      }
      if (!rows.length) throw new Error('资讯列表为空');
      // 跨媒体近义改写去重(时间倒序=保留最新一条)
      rows.sort((a: any, b: any) => String(b.showTime || '').localeCompare(String(a.showTime || '')));
      rows = dedupeNews(rows);
      // 标题贴标签(仅展示位提示,不做真·影响对象分析——那需要内容理解/付费源)
      const tag = (t: string) =>
        /央行|证监会|国务院|发改委|财政部|国常会|外汇局|监管|部长|总理|政治局|中央金融/.test(t) ? '政策' :
        /A股|沪指|深成|创业板|主力|涨停|跌停|板块|北向|成交|券商|基金|机构|资金/.test(t) ? '市场' :
        /增持|回购|股份|集团|公司|业绩|定增|并购|上市/.test(t) ? '公司' : '要闻';
      return rows.slice(0, 14).map(x => ({
        title: x.title,
        summary: (x.summary || '').slice(0, 90),
        time: x.showTime,
        url: x.url || x.uniqueUrl,
        media: x.mediaName,
        tag: tag(String(x.title)),
      }));
    });
  }
}
