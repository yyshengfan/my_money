import { Provide } from '@midwayjs/core';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getJson, postJson, cached } from '../util/net';
import { dedupeNews } from '../util/news';
import { parseTencentKline, klineInd } from './market.service';

/*
 * 妙想 MX 兜底网关:东财 clist/np-listapi 被限流时的换源(机会候选 + 中文资讯)。
 * - 网关 https://mkapi2.dfcfs.com/finskillshub/api/claw/{stock-screen,news-search}:POST JSON,
 *   Content-Type + apikey header;key 从环境变量 MX_APIKEY 读,env 没有则回退 ~/.mx_apikey 文件
 *   (launchd 起的生产进程不继承 shell rc,实测价值派因此长期红卡「未启用」);两处都不入库不入仓库。
 * - 成功缓存 60s;失败(含配额 code=113)进 mxDown 冷却 ~60s,不连打烧配额;未设 key → 恒「MX 未启用」,不发起网络。
 * - MX 是 LLM 语义选股,表结构不固定:多数走 data.data.partialResults(Markdown 表),
 *   也可能走 data.data.result.columns+dataList;两路都解。探不到数字列就把字段留 null,绝不造假。
 * - 顶层纯函数(mxMdTable/mxStockRows/mxNewsRows/numOf)可 node/jest 直测。
 */

// env 优先;launchd/生产不继承 shell rc → 回退 ~/.mx_apikey(chmod 600,仓库外,内容即 key 一行)
function mxKey(): string {
  const v = (process.env.MX_APIKEY || '').trim();
  if (v) return v;
  try {
    return readFileSync(join(homedir(), '.mx_apikey'), 'utf8').trim();
  } catch {
    return '';
  }
}
const MX_OK = mxKey();
const MX_SCREEN = 'https://mkapi2.dfcfs.com/finskillshub/api/claw/stock-screen';
const MX_NEWS = 'https://mkapi2.dfcfs.com/finskillshub/api/claw/news-search';
let mxDownUntil = 0; // 上次失败时刻 +60s:期间直接返回冷却,不再请求

// 选股启发式问句(对齐页面 opp 思路:剔除涨停过热,要主力净流入为正、放量)
const SCREEN_KW =
  '选出今日涨幅在2%到6%之间、主力资金净流入为正、量比大于1的沪深A股,' +
  '按主力净流入降序,返回前10只,列出代码、名称、最新价、涨跌幅、主力净额、量比即可';
const NEWS_KW = 'A股市场今日政策与资金面最新资讯';

// 与 emStockRow 同形状(机会评分/异动渲染零改动);amount/mcap 无源给 null
// 后 6 项为价值派基本面字段(MX 选股列),老消费方忽略即可
export interface MxStockRow {
  code: string | null; name: string | null; price: number | null; pct: number | null;
  amount: number | null; turn: number | null; pe: number | null; volRatio: number | null;
  mcap: number | null; pb: number | null; mainNet: number | null; ind: string | null;
  dvd: number | null;     // 股息率 %
  roe: number | null;     // 净资产收益率 %
  gross: number | null;   // 销售毛利率 %
  dedtYoy: number | null; // 扣非净利润同比 %
  debt: number | null;    // 资产负债率 %
  hi52: number | null;    // 52周最高价(元)
}
function blankRow(): MxStockRow {
  return { code: null, name: null, price: null, pct: null, amount: null, turn: null,
    pe: null, volRatio: null, mcap: null, pb: null, mainNet: null, ind: null,
    dvd: null, roe: null, gross: null, dedtYoy: null, debt: null, hi52: null };
}

// 中文表头/标签 → 语义字段(MX 列名带单位与日期后缀,包含匹配;命中取顺序靠前者)
const CN_PAT: Array<[keyof MxStockRow, RegExp]> = [
  ['code', /代码/],
  ['name', /名称|简称/],
  ['price', /最新价|现价|收盘价/], // MX 输出列常写作「日线不复权收盘价(元)」
  ['hi52', /52周.*(最高|高)|区间最高价/], // MX 实测把「52周最高价」回成「区间最高价(日线不复权)」;先于 pct
  ['pct', /涨跌幅/],
  ['mainNet', /主力净额|主力净流入|主力净/],
  ['volRatio', /量比/],
  ['turn', /换手率|换手/],
  ['pe', /市盈率/],
  ['pb', /市净率/],
  ['dvd', /股息率/],
  ['roe', /净资产收益率|ROE/i],
  ['gross', /毛利率/],
  ['dedtYoy', /扣非.*同比|扣除非经常性.*同比/],
  ['debt', /资产负债率/],
  ['ind', /所属行业|行业|板块/],
];
function fieldOf(label: string): keyof MxStockRow | null {
  const l = String(label || '');
  if (/市场/.test(l)) return null; // 「市场代码简称」列(SH/SZ)会撞 /代码/、/简称/,丢弃之(2026-09 实测污染)
  for (const [k, re] of CN_PAT) if (re.test(l)) return k;
  return null;
}

// '8.78亿'→8.78e8、'1.2万'→1.2e4、'3.80'→3.8、'-'(占位)或非数 → null。千分位逗号先剔除
export function numOf(v: any): number | null {
  if (v == null) return null;
  const m = String(v).replace(/,/g, '').trim().match(/^(-?\d+(?:\.\d+)?)\s*(亿|万)?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (m[2] === '亿') return n * 1e8;
  if (m[2] === '万') return n * 1e4;
  return n;
}

// 矩形表(表头 + 行单元格)→ MxStockRow 数组
export function mxRows(headers: string[], matrix: string[][]): MxStockRow[] {
  const out: MxStockRow[] = [];
  for (const cells of matrix) {
    const r = blankRow();
    for (let i = 0; i < headers.length && i < cells.length; i++) {
      const f = fieldOf(headers[i]);
      const v = (cells[i] ?? '').trim();
      if (!f || !v || v === '-') continue;
      if (f === 'code') r.code = v;
      else if (f === 'name') r.name = v;
      else if (f === 'ind') r.ind = v;
      else (r as any)[f] = numOf(v);
    }
    out.push(r);
  }
  return out;
}

// 解 MX Markdown 表(partialResults):首行表头,跳过 |---|---| 分隔行
export function mxMdTable(md: string): { headers: string[]; rows: MxStockRow[] } {
  const cell = (l: string) => l.split('|').map(s => s.trim()).filter(s => s !== '');
  const lines = (md || '').split('\n').map(s => s.trim()).filter(s => s.startsWith('|'));
  if (!lines.length) return { headers: [], rows: [] };
  const headers = cell(lines[0]);
  const matrix: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    if (/^\|[\s\-|]+\|?$/.test(lines[i])) continue;
    const c = cell(lines[i]);
    if (c.length) matrix.push(c);
  }
  return { headers, rows: mxRows(headers, matrix) };
}

// result.columns + dataList 路:字段名 → 展示名对齐后同样归一
export function mxStockRows(list: any[], columns: any[]): MxStockRow[] {
  const col = (columns || []).map(c => ({
    f: String(c?.field || c?.name || c?.key || ''),
    l: String(c?.displayName || c?.title || c?.label || c?.field || c?.name || ''),
  }));
  const headers = col.map(c => c.l);
  const matrix = (list || []).map(row => col.map(c => (row ? row[c.f] : undefined)));
  return mxRows(headers, matrix);
}

// 资讯 → 与 market.service news 行同形状 {title,summary,time,url,media,tag}
export interface MxNewsRow {
  title: string; summary: string; time: string; url: string | null; media: string; tag: string;
}
function newsTag(t: string): string {
  return /央行|证监会|国务院|发改委|财政部|国常会|外汇局|监管|部长|总理|政治局|中央金融/.test(t) ? '政策'
    : /A股|沪指|深成|创业板|主力|涨停|跌停|板块|北向|成交|券商|基金|机构|资金/.test(t) ? '市场'
    : /增持|回购|股份|集团|公司|业绩|定增|并购|上市/.test(t) ? '公司' : '要闻';
}
export function mxNewsRows(list: any[]): MxNewsRow[] {
  return (list || [])
    .filter(x => x && x.title)
    .map(x => {
      const title = String(x.title || '').slice(0, 120);
      return {
        title,
        summary: String(x.content || x.summary || '').replace(/\s+/g, ' ').trim().slice(0, 110),
        time: String(x.date || x.showTime || ''),
        url: x.jumpUrl || x.url || null,
        media: String(x.source || x.mediaName || ''),
        tag: newsTag(title),
      };
    });
}

// ---------- 价值投资派(MX 语义选股 + 本地打分) ----------

// 两档问句:严格档对齐 initial.md 口径;免费配额下硬 AND 常为 0 只(实测),空则落放宽档。
// 只筛选不改上游解析;字段缺失 → valueScore 该项 0 分,绝不臆造。
// 基本面档位选出后另过一道「企稳回升」硬确认(腾讯日K,见 valuePicks/stabOk):站回MA20 且 近20日上涨。
const VALUE_COLS =
  '列出代码、名称、行业、最新价、涨跌幅、市盈率、市净率、股息率、净资产收益率、销售毛利率、扣非净利润同比增长、资产负债率、52周最高价即可';
const VALUE_KW_STRICT =
  '筛选沪深A股:连续5年净资产收益率大于15%,销售毛利率大于30%,扣非净利润连续3年增长,资产负债率小于50%,' +
  '股息率大于3%,市盈率TTM大于0且小于20,市净率小于2,当前价较52周最高价回撤超过20%的股票,按市盈率升序取前20只,' + VALUE_COLS;
const VALUE_KW_LOOSE =
  '筛选沪深A股:净资产收益率大于12%,销售毛利率大于30%,扣非净利润同比增长大于0,股息率大于2%,' +
  '市盈率TTM大于0且小于25,市净率小于3的股票,按股息率降序取前20只,' + VALUE_COLS;

// 52周高点回撤 %(缺任一价格 → null)
export function ddFrom52(r: MxStockRow): number | null {
  if (r.price == null || r.hi52 == null || r.hi52 <= 0) return null;
  return ((r.hi52 - r.price) / r.hi52) * 100;
}

// 价值分(满 100):质地40(ROE15/毛利10/扣非10/负债5)+ 估值30(PE10/PB8/股息12)+ 错杀30(回撤分档)
export function valueScore(r: MxStockRow): number {
  let s = 0;
  if ((r.roe ?? 0) > 15) s += 15;
  if ((r.gross ?? 0) > 30) s += 10;
  if ((r.dedtYoy ?? 0) > 0) s += 10;
  if (r.debt != null && r.debt < 50) s += 5;
  if (r.pe != null && r.pe > 0 && r.pe <= 20) s += 10;
  if (r.pb != null && r.pb > 0 && r.pb <= 3) s += 8;
  if ((r.dvd ?? 0) >= 3) s += 12;
  const dd = ddFrom52(r);
  if (dd != null) s += dd >= 30 ? 20 : dd >= 20 ? 12 : dd >= 10 ? 6 : 0;
  return s;
}

// 企稳回升确认(2026-09-22 用户要求加进价值派硬条件):收盘站回 MA20 且近20交易日涨幅>0。
// tech 缺失(日K拉挂/不足60根)= 无法确认,不算达标。
export function stabOk(tech: { aboveMa20?: boolean | null; chg20?: number | null } | null | undefined): boolean {
  return !!tech && !!tech.aboveMa20 && tech.chg20 != null && tech.chg20 > 0;
}

@Provide()
export class MxService {
  // MX 选股通用路:POST → 两条解析(columns+dataList / Markdown 表)→ MxStockRow[]
  private async runScreen(cacheKey: string, keyword: string, ttlMs: number): Promise<MxStockRow[]> {
    return cached(cacheKey, ttlMs, async () => {
      const j: any = await postJson(MX_SCREEN, { keyword }, 45_000, { apikey: MX_OK });
      const inner = j?.data?.data || {};
      const res = inner.result || {};
      let out: MxStockRow[] = [];
      if (Array.isArray(res.dataList)) {
        out = mxStockRows(res.dataList, res.columns);
      } else if (Array.isArray(inner.allResults?.result?.dataList)) {
        out = mxStockRows(inner.allResults.result.dataList, inner.allResults.result.columns);
      } else if (typeof inner.partialResults === 'string') {
        out = mxMdTable(inner.partialResults).rows;
      }
      return out.filter(r => r.code && r.name);
    });
  }

  // 价值派企稳确认:腾讯前复权日K120根 → klineInd 取两项(首位判市,同 trendPicks);不足60根会 throw,由调用方 catch
  private async stabTech(raw: string): Promise<{ aboveMa20: boolean; chg20: number | null }> {
    const code = String(raw || '').match(/\d{6}/)?.[0] || ''; // MX 代码列可能带 .SH/SH 前后缀,只取6位数字
    if (code.length !== 6) throw new Error(`代码无法解析:${raw}`);
    const t = code.startsWith('6') ? 'sh' : 'sz';
    const j: any = await getJson(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${t}${code},day,,,120,qfq`, 9000);
    const d = j?.data?.[`${t}${code}`];
    const { aboveMa20, chg20 } = klineInd(parseTencentKline(d?.qfqday || d?.day || []));
    return { aboveMa20, chg20 };
  }

  // 机会候选兜底(东财 opportunity 失败时由 controller 调用)。返回 emStockRow 同形状数组
  async screen(): Promise<{ ok: boolean; data?: MxStockRow[]; error?: string }> {
    if (!MX_OK) return { ok: false, error: 'MX 未启用(缺 MX_APIKEY / ~/.mx_apikey)' };
    if (Date.now() < mxDownUntil) return { ok: false, error: 'MX 冷却中,稍后自动恢复' };
    try {
      const rows = await this.runScreen('mx:screen', SCREEN_KW, 60_000);
      if (!rows.length) throw new Error('MX 选股结果为空或不可解析');
      return { ok: true, data: rows.slice(0, 10) };
    } catch (e) {
      mxDownUntil = Date.now() + 60_000;
      return { ok: false, error: String((e as any)?.message || e) };
    }
  }

  // 价值投资派 TOP5:缓存 3600s(盘中每小时,省配额)。
  // 两档均"成功但零只"是事实而非故障 → level:'none' 正常缓存,不进冷却不烧配额。
  async valuePicks(): Promise<{
    ok: boolean;
    data?: {
      rows: Array<MxStockRow & { score: number; dd: number | null; tech: { aboveMa20: boolean; chg20: number | null } | null }>;
      level: 'strict' | 'loose' | 'none';
    };
    error?: string;
  }> {
    if (!MX_OK) return { ok: false, error: 'MX 未启用(缺 MX_APIKEY / ~/.mx_apikey)' };
    if (Date.now() < mxDownUntil) return { ok: false, error: 'MX 冷却中,稍后自动恢复' };
    try {
      return await cached('mx:value', 3600_000, async () => {
        let rows = await this.runScreen('mx:value:strict', VALUE_KW_STRICT, 3600_000);
        let level: 'strict' | 'loose' | 'none' = 'strict';
        if (!rows.length) {
          rows = await this.runScreen('mx:value:loose', VALUE_KW_LOOSE, 3600_000);
          level = rows.length ? 'loose' : 'none';
        }
        const scored = rows
          .map(r => ({ ...r, score: valueScore(r), dd: ddFrom52(r) }))
          .sort((a, b) => b.score - a.score || (b.dvd ?? 0) - (a.dvd ?? 0));
        // 企稳回升硬条件(2026-09-22 用户要求):腾讯前复权日K(与趋势派同源)确认「站回MA20 且 20日涨幅>0」。
        // 取基本面前10只逐只确认、留下达标的取前5;若10只K线全部拉挂(腾讯源整段不可用)→
        // 回退按基本面出前5(tech:null,前端不挂企稳chip),基本面结果不因行情源抖动清空。
        const top10 = scored.slice(0, 10);
        const techs = await Promise.all(top10.map(r => this.stabTech(r.code).catch(() => null)));
        const enr = top10.map((r, i) => ({ ...r, tech: techs[i] }));
        const pass = enr.filter(x => stabOk(x.tech));
        return {
          ok: true as const,
          data: { rows: (pass.length || enr.some(x => x.tech) ? pass : enr).slice(0, 5), level },
        };
      });
    } catch (e) {
      mxDownUntil = Date.now() + 60_000;
      return { ok: false, error: String((e as any)?.message || e) };
    }
  }

  // 中文资讯兜底(东财 news 失败时由 controller 调用)
  async news(): Promise<{ ok: boolean; data?: MxNewsRow[]; error?: string }> {
    if (!MX_OK) return { ok: false, error: 'MX 未启用(缺 MX_APIKEY / ~/.mx_apikey)' };
    if (Date.now() < mxDownUntil) return { ok: false, error: 'MX 冷却中,稍后自动恢复' };
    try {
      const rows = await cached('mx:news', 60_000, async () => {
        const j: any = await postJson(MX_NEWS, { query: NEWS_KW }, 45_000, { apikey: MX_OK });
        const list = j?.data?.data?.llmSearchResponse?.data || [];
        // 检索结果常同事件多来源:时间倒序去重后取前 10
        const out = dedupeNews(mxNewsRows(list).sort((a, b) => b.time.localeCompare(a.time))).slice(0, 10);
        if (!out.length) throw new Error('MX 资讯为空或不可解析');
        return out;
      });
      return { ok: true, data: rows };
    } catch (e) {
      mxDownUntil = Date.now() + 60_000;
      return { ok: false, error: String((e as any)?.message || e) };
    }
  }
}
