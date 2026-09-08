import { Provide } from '@midwayjs/core';
import { postJson, cached } from '../util/net';

/*
 * 妙想 MX 兜底网关:东财 clist/np-listapi 被限流时的换源(机会候选 + 中文资讯)。
 * - 网关 https://mkapi2.dfcfs.com/finskillshub/api/claw/{stock-screen,news-search}:POST JSON,
 *   Content-Type + apikey header;key 只从环境变量 MX_APIKEY 读,不入库不入仓库。
 * - 成功缓存 60s;失败(含配额 code=113)进 mxDown 冷却 ~60s,不连打烧配额;未设 key → 恒「MX 未启用」,不发起网络。
 * - MX 是 LLM 语义选股,表结构不固定:多数走 data.data.partialResults(Markdown 表),
 *   也可能走 data.data.result.columns+dataList;两路都解。探不到数字列就把字段留 null,绝不造假。
 * - 顶层纯函数(mxMdTable/mxStockRows/mxNewsRows/numOf)可 node/jest 直测。
 */

const MX_OK = (process.env.MX_APIKEY || '').trim();
const MX_SCREEN = 'https://mkapi2.dfcfs.com/finskillshub/api/claw/stock-screen';
const MX_NEWS = 'https://mkapi2.dfcfs.com/finskillshub/api/claw/news-search';
let mxDownUntil = 0; // 上次失败时刻 +60s:期间直接返回冷却,不再请求

// 选股启发式问句(对齐页面 opp 思路:剔除涨停过热,要主力净流入为正、放量)
const SCREEN_KW =
  '选出今日涨幅在2%到6%之间、主力资金净流入为正、量比大于1的沪深A股,' +
  '按主力净流入降序,返回前10只,列出代码、名称、最新价、涨跌幅、主力净额、量比即可';
const NEWS_KW = 'A股市场今日政策与资金面最新资讯';

// 与 emStockRow 同形状(机会评分/异动渲染零改动);amount/mcap 无源给 null
export interface MxStockRow {
  code: string | null; name: string | null; price: number | null; pct: number | null;
  amount: number | null; turn: number | null; pe: number | null; volRatio: number | null;
  mcap: number | null; pb: number | null; mainNet: number | null; ind: string | null;
}
function blankRow(): MxStockRow {
  return { code: null, name: null, price: null, pct: null, amount: null, turn: null,
    pe: null, volRatio: null, mcap: null, pb: null, mainNet: null, ind: null };
}

// 中文表头/标签 → 语义字段(MX 列名带单位与日期后缀,包含匹配;命中取顺序靠前者)
const CN_PAT: Array<[keyof MxStockRow, RegExp]> = [
  ['code', /代码/],
  ['name', /名称|简称/],
  ['price', /最新价|现价/],
  ['pct', /涨跌幅/],
  ['mainNet', /主力净额|主力净流入|主力净/],
  ['volRatio', /量比/],
  ['turn', /换手率|换手/],
  ['pe', /市盈/],
  ['pb', /市净/],
  ['ind', /所属行业|行业|板块/],
];
function fieldOf(label: string): keyof MxStockRow | null {
  const l = String(label || '');
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

@Provide()
export class MxService {
  // 机会候选兜底(东财 opportunity 失败时由 controller 调用)。返回 emStockRow 同形状数组
  async screen(): Promise<{ ok: boolean; data?: MxStockRow[]; error?: string }> {
    if (!MX_OK) return { ok: false, error: 'MX 未启用(无 MX_APIKEY)' };
    if (Date.now() < mxDownUntil) return { ok: false, error: 'MX 冷却中,稍后自动恢复' };
    try {
      const rows = await cached('mx:screen', 60_000, async () => {
        const j: any = await postJson(MX_SCREEN, { keyword: SCREEN_KW }, 45_000, { apikey: MX_OK });
        const inner = j?.data?.data || {};
        let out: MxStockRow[] = [];
        if (inner.result && Array.isArray(inner.result.dataList)) {
          out = mxStockRows(inner.result.dataList, inner.result.columns);
        } else if (typeof inner.partialResults === 'string') {
          out = mxMdTable(inner.partialResults).rows;
        }
        out = out.filter(r => r.code && r.name);
        if (!out.length) throw new Error('MX 选股结果为空或不可解析');
        return out;
      });
      return { ok: true, data: rows.slice(0, 10) };
    } catch (e) {
      mxDownUntil = Date.now() + 60_000;
      return { ok: false, error: String((e as any)?.message || e) };
    }
  }

  // 中文资讯兜底(东财 news 失败时由 controller 调用)
  async news(): Promise<{ ok: boolean; data?: MxNewsRow[]; error?: string }> {
    if (!MX_OK) return { ok: false, error: 'MX 未启用(无 MX_APIKEY)' };
    if (Date.now() < mxDownUntil) return { ok: false, error: 'MX 冷却中,稍后自动恢复' };
    try {
      const rows = await cached('mx:news', 60_000, async () => {
        const j: any = await postJson(MX_NEWS, { query: NEWS_KW }, 45_000, { apikey: MX_OK });
        const list = j?.data?.data?.llmSearchResponse?.data || [];
        const out = mxNewsRows(list).slice(0, 10);
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
