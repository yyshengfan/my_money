import { Provide } from '@midwayjs/core';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getJson, cached } from '../util/net';
import { zhTitle } from './crypto.service';

// 全球事件雷达:过去 7 天(灰)+ 未来 14 天高/中级事件时间轴,公开端点 /api/events。
// 免key直连源实测(2026-09)只有 ForexFactory 官方周feed(nfs.faireconomy.media),且只给当周 →
// 学 moneyflow 台账先例:每小时拉一次合入 data/events_daily.json,周一自动滚入下一周,
// 随天数攒到 30 天覆盖;冷启动只有本周,页头按实际覆盖如实写「未来N天」,属预期非 bug。
// 上游挂 → 直接回台账(台账即兜底);无 500。标题走 crypto.service 的 zhTitle 机翻简体(带缓存)。

export interface EvRow {
  url: string; // 事件唯一键(ForexFactory 事件页)
  en: string; // 英文原题
  ts: number; // 事件时刻(UTC ms)
  impact: 'H' | 'M' | 'L';
  country: string;
  forecast: string;
  previous: string;
  kind?: 'macro' | 'crypto'; // 手动行可自带覆盖,服务内补齐
}

const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const FILE = join(process.cwd(), 'data', 'events_daily.json');
const MANUAL = join(process.cwd(), 'data', 'events_manual.json'); // 用户手记无源事件(token解锁/空投/监管截止日)

function loadJson(f: string): any {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}
function saveJson(f: string, o: any) {
  try {
    writeFileSync(f, JSON.stringify(o));
  } catch {
    /* 落盘失败下次再记,不影响本次返回(moneyflow 同款) */
  }
}

const IMP: Record<string, 'H' | 'M' | 'L'> = { high: 'H', medium: 'M', low: 'L' };

// ForexFactory 周feed → 行数组;行={title,country,date(带时区ISO),impact,forecast,previous,url}
export function parseFFRows(body: any): EvRow[] {
  if (!Array.isArray(body)) throw new Error('ForexFactory feed 非数组');
  const out: EvRow[] = body
    .map((r: any) => ({
      url: String(r.url || r.title || ''),
      en: String(r.title || ''),
      ts: Date.parse(r.date),
      impact: IMP[String(r.impact || '').toLowerCase()] || 'L',
      country: String(r.country || ''),
      forecast: String(r.forecast || ''),
      previous: String(r.previous || ''),
    }))
    .filter((r: EvRow) => r.en && Number.isFinite(r.ts));
  if (!out.length) throw new Error('ForexFactory feed 空');
  return out;
}

// 台账合并:按 url 去重(ff 每周重播同一事件时刷新 forecast/previous)、删过期(留上周8天,供回看)、窗尾40天
export function mergeLedger(store: Record<string, EvRow>, rows: EvRow[], nowMs: number) {
  const s: Record<string, EvRow> = { ...store };
  for (const r of rows) s[r.url] = { ...(s[r.url] || {}), ...r };
  const lo = nowMs - 8 * 864e5, hi = nowMs + 40 * 864e5;
  for (const k of Object.keys(s)) if (s[k].ts < lo || s[k].ts > hi) delete s[k];
  return s;
}

// 手动行:{date:'YYYY-MM-DD HH:MM'(北京),title,impact:'High'|'Medium',kind?};北京无DST,字符串+08:00解析
export function parseManual(arr: any): EvRow[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((m: any) => ({
      url: 'manual:' + m.title + ' ' + m.date,
      en: String(m.title || ''),
      ts: Date.parse(String(m.date || '').replace(' ', 'T') + '+08:00'),
      impact: IMP[String(m.impact || 'medium').toLowerCase()] || 'M',
      country: String(m.country || 'CRYPTO'),
      forecast: '',
      previous: '',
      kind: m.kind,
    }))
    .filter((r: EvRow) => r.en && Number.isFinite(r.ts));
}

// 币圈/宏观两线:币种或标题规则判;手动行缺 kind 时同样走规则
export function kindOf(r: { country?: string; en: string; kind?: string }): 'macro' | 'crypto' {
  if (r.kind === 'macro' || r.kind === 'crypto') return r.kind;
  if (/^(BTC|ETH)$/i.test(r.country || '')) return 'crypto';
  return /ETF|SEC|crypto|stablecoin|token|bitcoin|blockchain/i.test(r.en) ? 'crypto' : 'macro';
}

// 展示窗口:H/M 级、ts ∈ (now-7天, now+days](已过去一周保留供上滑回看,过去用灰色分层)、含手动、按时间排
export function upcoming(store: Record<string, EvRow>, manual: EvRow[], nowMs: number, days = 14) {
  const lo = nowMs - 7 * 864e5, hi = nowMs + days * 864e5;
  const rows = Object.values(store).filter(r => r.impact !== 'L' && r.ts > lo && r.ts <= hi);
  return [...rows, ...manual.filter(r => r.ts > lo && r.ts <= hi)].sort((a, b) => a.ts - b.ts);
}

// UTC ms → 北京(UTC+8)「MM-DD」「HH:mm」
export function fmtCn(ts: number) {
  const p = (n: number) => String(n).padStart(2, '0');
  const d = new Date(ts + 8 * 36e5);
  return { day: `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, hh: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` };
}

@Provide()
export class EventsService {
  // 1h 缓存:日历分钟级不变,省翻译与上游配额
  async events() {
    return cached('events:calendar', 3_600_000, async () => {
      let store: Record<string, EvRow> = loadJson(FILE) || {};
      let degraded = false;
      try {
        store = mergeLedger(store, parseFFRows(await getJson(FF_URL, 15000)), Date.now());
        saveJson(FILE, store);
      } catch (e: any) {
        if (!Object.keys(store).length) return { ok: false as const, error: String(e?.message || e) };
        degraded = true; // 上游挂,本轮回台账
      }
      const now = Date.now();
      const list = upcoming(store, parseManual(loadJson(MANUAL)), now);
      const events = await Promise.all(
        list.map(async r => {
          const { day, hh } = fmtCn(r.ts);
          return {
            ...r,
            kind: kindOf(r),
            day,
            hh,
            title: await zhTitle(r.en).catch(() => r.en), // Low 已在 upcoming 滤掉,只翻展示行
          };
        })
      );
      const coveredDays = list.length ? Math.max(0, Math.min(14, Math.ceil((list[list.length - 1].ts - now) / 864e5))) : 0;
      return { ok: true as const, data: { events, coveredDays, degraded: degraded || undefined } };
    });
  }
}
