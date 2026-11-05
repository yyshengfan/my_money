import { createHmac } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { postJson, getBuffer } from '../util/net';
import { fetchBest } from './crypto.service';
import { parseTencent, QtRow } from './qt.service';

/*
 * 币圈异动监控(2026-10-18 用户要求):BTC/BNB/ETH/SOL/OKB 一分钟一轮采样,三条规则——
 *   quick  = 窗口分钟(winMin,默认 5)内涨跌 |Δ| ≥ 阈值(默认 3%)
 *   dayChg = 日内涨跌 |现价−今开|/今开 ≥ 阈值(默认 5%)
 *   dayAmp = 日内振幅 (日高−日低)/今开 ≥ 阈值(默认 5%)
 * 2026-10-19 扩 A股板块:南山铝业/森马服饰/西安旅游/朗姿股份/迈瑞医疗 五只,quick/dayChg 与币圈同参
 * (振幅规则默认关,页面可开),推「A股大舞台」群(LARK_WEBHOOK_ASTOCK env → ~/.lark_webhook_astock)。
 * 源=腾讯 ifzq minute query(当日1分钟线出窗口涨跌,内嵌 qt 行出今开/日高/日低/现价);
 * ⚠️ qt 时间戳非北京今日(周末/节假日/盘前)整只回 null 不判定——防休市日拿旧行情误触发。
 * 达标即推 Lark「币圈小剧场」群机器人(LARK_WEBHOOK env → ~/.lark_webhook,chmod 600,与 ~/.mx_apikey
 * 同路数,不入库不入仓库;文件容忍 `webhook:`/`sign:` 标签粘贴,有 sign 密钥自动加签)。去重=状态机按跃变推送:一段异动只在 正常→越限 报一次、
 * 越限→回落 再报一次恢复(用户没要冷却,这就是冷却)。
 * 数据源:BTC/BNB/ETH/SOL=币安 K 线(vision→intl 走 crypto.service fetchBest);OKB=OKX(币安无 OKB 现货)。
 * 每币每分钟两次拉取:1m×(winMin+2) 出快速窗口,1H×26 出北京日今开/日高/日低(现价涨跌用 1m 末收盘,日高日低最长滞后 1h,页面注记)。
 * 配置 data/monitor_config.json(缺文件回代码默认,每 tick 重读盘 → 页面保存免重启);
 * 状态 runtime/monitor_state.json;推送台账 runtime/monitor_alerts.json(留 200 条)。
 * ⚠️ 采样调用绝不包 cached():effTtl 会把 <5min 的 TTL 一律抬到 5min,1 分钟循环必须直连。
 * 双进程(dev+prod 同跑)去重靠推送前重读状态文件;极端并发竞态窗口极小,个人自用可接受。MONITOR_OFF=1 整个不启循环。
 */

export const SYMS = ['BTC', 'BNB', 'ETH', 'SOL', 'OKB'] as const;
// A股监控清单(2026-10-19 用户点名;森马即上市公司森马服饰,西安旅游现 *ST西旅 000610)
export const ASTOCKS = [
  { code: 'sh600219', sym: '600219', name: '南山铝业' },
  { code: 'sz002563', sym: '002563', name: '森马服饰' },
  { code: 'sz000610', sym: '000610', name: '西安旅游' },
  { code: 'sz002612', sym: '002612', name: '朗姿股份' },
  { code: 'sz300760', sym: '300760', name: '迈瑞医疗' },
] as const;
export const ALL_SYMS: string[] = [...SYMS, ...ASTOCKS.map(a => a.sym)];
export const isAStock = (sym: string): boolean => /^\d{6}$/.test(sym);
export const asName = (sym: string): string => ASTOCKS.find(a => a.sym === sym)?.name || sym;
export type Mkt = 'crypto' | 'astock';
export const RULES = ['quick', 'dayChg', 'dayAmp'] as const;
export type Rule = (typeof RULES)[number];

/*
 * ETF 暴量监控(2026-10-29 用户要求):盯上证宽基 ETF 的成交额异动 —— 本意是「官方入场抄底」的信号。
 * 指标=腾讯 qt 量比 f49(今日每分钟均量 ÷ 前5日每分钟均量,天然做了时段归一,不必自己折分钟进度),
 * 且今日成交额 ≥ minAmt 亿(小 ETF 量比飙高但金额不值一提,加绝对额兜底)。开盘 20 分钟内量比失真不判。
 * 清单 data/etf_watch.json(增删免重启,缺文件回 ETF_DEF),阈值 cfg.etf 全局一套。
 * 状态机 key `${sym}.vol`,跨日自动清零(昨天的 fire 不该压住今天的第一波)。
 */
export const ETF_DEF = [
  { sym: '510300', name: '沪深300ETF华泰柏瑞' }, // 国家队抄底最核心的载体
  { sym: '510050', name: '上证50ETF华夏' },
  { sym: '510310', name: '沪深300ETF易方达' },
  { sym: '510210', name: '上证指数ETF富国' }, // 字面「上证指数」
  { sym: '510500', name: '中证500ETF南方' },
  { sym: '588000', name: '科创50ETF华夏' },
];
const ETF_FILE = join(process.cwd(), 'data', 'etf_watch.json');

const CFG_FILE = join(process.cwd(), 'data', 'monitor_config.json');
const STATE_FILE = join(process.cwd(), 'runtime', 'monitor_state.json');
const ALERTS_FILE = join(process.cwd(), 'runtime', 'monitor_alerts.json');

export interface TaskCfg {
  on: boolean; // 该币检测总开关
  winMin: number; // quick 窗口(分钟)
  quickPct: number; // quick 阈值 %
  chgOn: boolean; chgPct: number; // 日内涨跌规则开关/阈值
  ampOn: boolean; ampPct: number; // 日内振幅规则开关/阈值
}
export interface EtfCfg {
  on: boolean; // ETF 暴量监控总开关
  ratio: number; // 量比阈值(倍数)
  minAmt: number; // 今日成交额下限(亿元),防「量比高但没几个钱」的噪声
}
export interface MonitorCfg {
  paused: boolean; // 全局暂停(看板照常刷新,只不评估不推送)
  recovery: boolean; // 回落/恢复通知
  tasks: Record<string, TaskCfg>;
  etf: EtfCfg;
}
export interface Reading {
  price: number | null;
  quick: number | null;
  day: { open: number; hi: number; lo: number; chg: number; amp: number } | null;
}
export interface RuleState { st: 'ok' | 'fire'; ts: number; lastV: number; lastP?: number } // lastP=上次真推出去的时刻
// 同一标的同一规则 30 分钟内最多推一条(2026-11-03 用户要求)。阈值附近抖动 fire→ok→fire 不再刷屏;
// 被压住的跃变状态照常转(看板仍显示越限),只是不发消息。缺 lastP 的旧状态视为"从未推过",立即放行。
export const COOL_MS = 30 * 60e3;
const coolOk = (ns: Record<string, RuleState>, key: string, nowMs: number) => nowMs - (ns[key]?.lastP || 0) >= COOL_MS;

const DEF_TASK: TaskCfg = { on: true, winMin: 5, quickPct: 3, chgOn: true, chgPct: 5, ampOn: true, ampPct: 5 };
// A股默认:用户只点名「5分钟涨跌+日内涨跌」两条,与币圈同参;振幅给开关不默认开
const DEF_TASK_AS: TaskCfg = { ...DEF_TASK, ampOn: false };
// ETF 暴量默认:量比 3 倍 + 今日成交额 ≥ 20 亿。宽基 ETF 平时量比 0.5~1,3 倍已是历史级别的放量
const DEF_ETFC: EtfCfg = { on: true, ratio: 3, minAmt: 20 };

function loadJson(f: string): any {
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}
function saveJson(f: string, o: any) {
  try {
    mkdirSync(join(f, '..'), { recursive: true });
    writeFileSync(f, JSON.stringify(o));
  } catch { /* 落盘失败下次再记(events.service 同款),不影响本轮 */ }
}

// Lark 机器人凭据:env → ~/.lark_webhook(同 mxKey 路数,不入库不入仓库)。
// 2026-10-19 起两群可写同一文件,用 `## 群名` 分段(A股也可放独立的 ~/.lark_webhook_astock,兼容旧格式)。
// 文件容错(2026-10-18 用户实贴为后台「自定义机器人」整段拷贝):允许 `webhook: <url>` 带标签、多组粘贴取首组;
// 同文件里还有 `sign: <密钥>` 时按飞书官方签名算法加签(key=timestamp+"\n"+secret,HMAC-SHA256 空消息,base64)。
export function parseWebhook(text: string, tag = ''): { url: string; secret: string } {
  let body = text;
  // tag=分组名(2026-10-19 用户把两群写进同一文件,`## 币圈小剧场`/`## A股大舞台` 分段):
  // 有标题段时只吃匹配段;段都不匹配→空(宁缺勿假,绝不把 A股 消息发到币圈群)
  if (tag) {
    const blocks: { h: string; b: string }[] = [];
    let cur: { h: string; b: string } | null = null;
    for (const l of text.split(/\r?\n/)) {
      if (/^\s*#/.test(l)) {
        cur = { h: l, b: '' };
        blocks.push(cur);
      } else if (cur) cur.b += l + '\n';
    }
    if (blocks.length) {
      const hit = blocks.find(x => x.h.includes(tag));
      if (!hit) return { url: '', secret: '' };
      body = hit.b;
    }
  }
  const um = body.match(/https?:\/\/\S+/); // 第一条 URL(剥尾部引号,兼容整行被引号包裹的粘贴)
  let secret = '';
  for (const l of body.split(/\r?\n/)) {
    const s = l.trim().replace(/^["'`]|["'`]$/g, '');
    if (s.includes('://') || /^(webhook|url)/i.test(s)) continue;
    const m = s.match(/^[^:：]{0,14}[:：]\s*([A-Za-z0-9_\-]{10,})$/);
    if (m && /^(sign|secret|签名|密钥)/i.test(s)) { secret = m[1]; break; }
  }
  return { url: um ? um[0].replace(/["'`,;]+$/, '') : '', secret };
}
export function larkSign(ts: number, secret: string): string {
  return createHmac('sha256', `${ts}\n${secret}`).update('').digest('base64');
}
export function larkCreds(mkt: Mkt = 'crypto'): { url: string; secret: string } {
  const env = (process.env[mkt === 'astock' ? 'LARK_WEBHOOK_ASTOCK' : 'LARK_WEBHOOK'] || '').trim();
  if (env) return parseWebhook(env);
  const tag = mkt === 'astock' ? 'A股' : '币圈';
  let shared = '';
  try { shared = readFileSync(join(homedir(), '.lark_webhook'), 'utf8'); } catch {}
  if (shared) {
    const r = parseWebhook(shared, tag);
    if (r.url || /^\s*#/m.test(shared)) return r; // 文件里有分段标题就信分段:段缺失返回空,绝不串群
  }
  if (mkt === 'astock') {
    try { return parseWebhook(readFileSync(join(homedir(), '.lark_webhook_astock'), 'utf8')); } catch {}
  }
  return shared ? parseWebhook(shared) : { url: '', secret: '' }; // 无分段的旧单群文件=币圈
}
// 统一出口:拼 body(带签就加 timestamp/sign)+ 判定 + 失败原因带 code/msg(台账排障用)
async function larkPush(text: string, nowMs: number, mkt: Mkt = 'crypto'): Promise<{ ok: boolean; err: string }> {
  const { url, secret } = larkCreds(mkt);
  if (!url) return { ok: false, err: `未配置 ~/.lark_webhook 的「${mkt === 'astock' ? 'A股大舞台' : '币圈小剧场'}」段(${mkt === 'astock' ? '或 ~/.lark_webhook_astock' : ''})` };
  try {
    const b: any = { msg_type: 'text', content: { text } };
    if (secret) { b.timestamp = String(Math.floor(nowMs / 1000)); b.sign = larkSign(Math.floor(nowMs / 1000), secret); }
    const r = await postJson(url, b, 10000);
    return larkSendOk(r) ? { ok: true, err: '' } : { ok: false, err: `Lark code=${r?.code ?? r?.StatusCode ?? '?'} ${String(r?.msg || r?.Message || '').slice(0, 80)}`.trim() };
  } catch (e: any) { return { ok: false, err: String(e?.message || e).slice(0, 120) }; }
}
export const larkSendOk = (body: any): boolean => !!body && (body.code === 0 || body.StatusCode === 0);

// 纯函数:北京日 0 点(UTC ms)。+8h 后取整日再减回,跨日/UTC 边界注入 nowMs 直测
export function beijingDayStart(nowMs: number): number {
  return Math.floor((nowMs + 8 * 3600e3) / 86400e3) * 86400e3 - 8 * 3600e3;
}
const BJ = 8 * 3600e3;
const fmtBJ = (ts: number) => new Date(ts + BJ).toISOString().slice(5, 16).replace('T', ' ');
const sp = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2); // 只补 +,负号自带(hub 教训:否则 --1%)
const fmtPx = (p: number) => '$' + (p >= 1000 ? p.toFixed(0) : p >= 1 ? p.toFixed(2) : p.toFixed(4));

export type KRow = { t: number; o: number; h: number; l: number; c: number };
// 纯函数:升序 1m 行取「最近 winMin 分钟涨跌%」。末根=当前分钟(未走完,收盘即现价),往前数 winMin 根为基期
export function quickChg(rows: KRow[], winMin: number): number | null {
  if (!rows || rows.length < winMin + 1) return null; // 预热不足(刚重启)属正常
  const a = rows[rows.length - 1 - winMin].c, b = rows[rows.length - 1].c;
  return a > 0 ? ((b - a) / a) * 100 : null;
}
// 纯函数:1H 行(升序)里筛北京日当日起的根 → 今开/日高/日低;chg 用调用方喂的 1m 现价
export function dayStats(rows: KRow[], dayStartMs: number, lastPx: number | null) {
  const bars = (rows || []).filter(r => r.t >= dayStartMs);
  if (!bars.length || lastPx == null) return null;
  const open = bars[0].o;
  if (!(open > 0)) return null;
  const hi = Math.max(...bars.map(r => r.h)), lo = Math.min(...bars.map(r => r.l));
  return { open, hi, lo, chg: ((lastPx - open) / open) * 100, amp: ((hi - lo) / open) * 100 };
}

// 纯函数:北京已交易分钟数(9:30-11:30 + 13:00-15:00=240)。喂行情时间戳的 HHMM,不认本机钟
export function tradedMin(hhmm: number): number {
  const h = Math.floor(hhmm / 100), m = hhmm % 100;
  const t = h * 60 + m;
  if (!(t > 0)) return 0;
  if (t < 570) return 0;
  if (t <= 690) return t - 570;
  if (t < 780) return 120;
  return Math.min(120 + (t - 780), 240);
}
export interface EtfReading {
  name: string;
  price: number | null;
  chgPct: number | null;
  amtYi: number | null; // 今日成交额(亿元)
  ratio: number | null; // 量比(倍数)
  min: number; // 已交易分钟(开盘 20 分钟内量比失真,不判)
}
// 纯函数:腾讯 qt 回包 → EtfReading。时间戳非北京今日(休市/盘前)→ null 整只不判定
export function etfParse(rows: Record<string, QtRow>, code: string, today: string): EtfReading | null {
  const q = rows[code];
  if (!q) return null;
  const tm = String(q.time || '');
  if (tm.slice(0, 8) !== today) return null;
  return {
    name: q.name,
    price: q.price > 0 ? q.price : null,
    chgPct: isFinite(q.chgPct) ? q.chgPct : null,
    amtYi: q.amountWan > 0 ? q.amountWan / 1e4 : null,
    ratio: q.volRatio ?? null,
    min: tradedMin(Number(tm.slice(8, 12))),
  };
}
// 清单:data/etf_watch.json(每 tick 重读,增删免重启)→ 缺文件/坏文件回 ETF_DEF
export function etfList(): { sym: string; name: string }[] {
  const raw = loadJson(ETF_FILE);
  if (Array.isArray(raw) && raw.length) {
    const out = raw.filter((x: any) => /^\d{6}$/.test(String(x?.sym))).map((x: any) => ({ sym: String(x.sym), name: String(x.name || x.sym) }));
    if (out.length) return out;
  }
  return ETF_DEF.slice();
}
async function etfQuotes(codes: string[]): Promise<Record<string, QtRow>> {
  if (!codes.length) return {};
  const buf = await getBuffer('https://qt.gtimg.cn/q=' + codes.join(','));
  const TD: any = (globalThis as any).TextDecoder;
  return parseTencent(new TD('gbk').decode(buf));
}

export function readCfg(): MonitorCfg {
  const raw = loadJson(CFG_FILE);
  const cfg: MonitorCfg = { paused: !!raw?.paused, recovery: raw?.recovery !== false, tasks: {} as any, etf: { ...DEF_ETFC, ...(raw?.etf || {}) } };
  for (const s of ALL_SYMS) cfg.tasks[s] = { ...(isAStock(s) ? DEF_TASK_AS : DEF_TASK), ...(raw?.tasks?.[s] || {}) };
  return cfg;
}
export function writeCfg(partial: Partial<MonitorCfg>): MonitorCfg {
  const cfg = readCfg();
  if (typeof partial.paused === 'boolean') cfg.paused = partial.paused;
  if (typeof partial.recovery === 'boolean') cfg.recovery = partial.recovery;
  for (const s of ALL_SYMS) if (partial.tasks?.[s]) cfg.tasks[s] = { ...cfg.tasks[s], ...partial.tasks[s] };
  if (partial.etf) cfg.etf = { ...cfg.etf, ...partial.etf };
  saveJson(CFG_FILE, cfg);
  return cfg;
}

// 纯函数核心:状态机跃变。返回 {pushes(待推), state(新状态)};不改传入对象。
export function evalTransitions(
  state: Record<string, RuleState>,
  readings: Record<string, Reading | null>,
  cfg: MonitorCfg,
  nowMs: number
): { pushes: Array<{ sym: string; rule: Rule; kind: 'fire' | 'recover'; val: number; thr: number; r: Reading }>; state: Record<string, RuleState> } {
  const ns: Record<string, RuleState> = JSON.parse(JSON.stringify(state || {}));
  const pushes: any[] = [];
  for (const sym of ALL_SYMS) {
    const t = cfg.tasks[sym];
    if (!t) continue; // 手搓 cfg(单测/旧文件)没有该标的键 → 跳过不判
    const r = readings[sym];
    for (const rule of RULES as readonly Rule[]) {
      const key = `${sym}.${rule}`;
      // 规则关 / 币关 / 无读数 → 清该键状态(重新打开后从"正常"起算,不补发),不推送
      const on = t.on && (rule === 'quick' || (rule === 'dayChg' ? t.chgOn : t.ampOn));
      const v = r ? (rule === 'quick' ? r.quick : rule === 'dayChg' ? r.day?.chg : r.day?.amp) : null;
      if (!on || v == null || !isFinite(v)) { delete ns[key]; continue; }
      const thr = rule === 'quick' ? t.quickPct : rule === 'dayChg' ? t.chgPct : t.ampPct;
      const over = rule === 'dayAmp' ? v >= thr : Math.abs(v) >= thr; // 振幅恒正,涨跌看绝对值
      const st = ns[key]?.st || 'ok';
      const cool = coolOk(ns, key, nowMs);
      if (over && st === 'ok') {
        if (cool) { pushes.push({ sym, rule, kind: 'fire', val: v, thr, r }); ns[key] = { st: 'fire', ts: nowMs, lastV: v, lastP: nowMs }; }
        else ns[key] = { st: 'fire', ts: ns[key]?.ts || nowMs, lastV: v, lastP: ns[key]?.lastP }; // 冷却中:转状态不推送
      } else if (over) {
        ns[key] = { st: 'fire', ts: ns[key].ts, lastV: v, lastP: ns[key].lastP }; // 持续越限不重推,只刷新读数(冷却戳要留住)
      } else if (st === 'fire') {
        if (cfg.recovery && cool) { pushes.push({ sym, rule, kind: 'recover', val: v, thr, r }); ns[key] = { st: 'ok', ts: nowMs, lastV: v, lastP: nowMs }; }
        else ns[key] = { st: 'ok', ts: nowMs, lastV: v, lastP: ns[key]?.lastP };
      }
    }
  }
  return { pushes, state: ns };
}

// 纯函数:推送文案(A股走 ¥/中文名/「A股异动」签,币圈保持 $/代码/「币圈异动」签)
export function larkText(p: { sym: string; rule: Rule; kind: 'fire' | 'recover'; val: number; thr: number; r: Reading }, t: TaskCfg, ts: number): string {
  const a = isAStock(p.sym);
  const tag = a ? '【A股异动】' : '【币圈异动】';
  const who = a ? `${asName(p.sym)}(${p.sym})` : p.sym;
  const px = (v: number | null) => (v == null || !isFinite(v) ? '—' : a ? '¥' + v.toFixed(2) : fmtPx(v));
  const label = p.rule === 'quick' ? `${t.winMin}分钟` : p.rule === 'dayChg' ? '日内涨跌' : '日内振幅';
  const bj = fmtBJ(ts);
  if (p.kind === 'recover') return `【回落恢复】${who} ${label}回到 ${sp(p.val)}%(阈值 ${p.thr}%)· ${bj}`;
  const day = p.r.day;
  if (p.rule === 'quick') return `${tag}${who} ${label}${p.val >= 0 ? '急涨' : '急跌'} ${sp(p.val)}%(阈值 ${p.thr}%)· 现价 ${px(p.r.price ?? null)} · ${bj}`;
  if (p.rule === 'dayChg') return `${tag}${who} ${p.val >= 0 ? '日内大涨' : '日内大跌'} ${sp(p.val)}%(阈值 ${p.thr}%)· 现价 ${px(p.r.price ?? null)} · 今开 ${px(day ? day.open : null)} · ${bj}`;
  return `${tag}${who} 日内振幅 ${p.val.toFixed(1)}%(阈值 ${p.thr}%)· 今开 ${px(day ? day.open : null)} / 高 ${px(day ? day.hi : null)} / 低 ${px(day ? day.lo : null)} · ${bj}`;
}

export type VolPush = { sym: string; kind: 'fire' | 'recover'; val: number; thr: number; r: EtfReading };
// 纯函数核心:ETF 暴量状态机。与 evalTransitions 同款跃变去重,但 key=`${sym}.vol`、跨日自动清零
export function evalVol(
  state: Record<string, RuleState>,
  readings: Record<string, EtfReading | null>,
  e: EtfCfg,
  list: { sym: string; name: string }[],
  nowMs: number
): { pushes: VolPush[]; state: Record<string, RuleState> } {
  const ns: Record<string, RuleState> = JSON.parse(JSON.stringify(state || {}));
  const pushes: VolPush[] = [];
  const today = bjYMD(nowMs);
  for (const it of list) {
    const key = `${it.sym}.vol`;
    // 跨日作废:昨天的 fire 不该压住今天的第一波(量比是日内指标)
    if (ns[key] && bjYMD(ns[key].ts) !== today) delete ns[key];
    const r = readings[it.sym];
    if (!e.on || !r || r.ratio == null) { delete ns[key]; continue; }
    if (r.min < 20) continue; // 开盘 20 分钟内量比失真,不判也不清态
    const over = r.ratio >= e.ratio && (r.amtYi ?? 0) >= e.minAmt;
    const st = ns[key]?.st || 'ok';
    const cool = coolOk(ns, key, nowMs);
    if (over && st === 'ok') {
      if (cool) { pushes.push({ sym: it.sym, kind: 'fire', val: r.ratio, thr: e.ratio, r }); ns[key] = { st: 'fire', ts: nowMs, lastV: r.ratio, lastP: nowMs }; }
      else ns[key] = { st: 'fire', ts: ns[key]?.ts || nowMs, lastV: r.ratio, lastP: ns[key]?.lastP };
    } else if (over) {
      ns[key] = { st: 'fire', ts: ns[key].ts, lastV: r.ratio, lastP: ns[key].lastP }; // 持续暴量不重推
    } else if (st === 'fire') {
      if (cool) { pushes.push({ sym: it.sym, kind: 'recover', val: r.ratio, thr: e.ratio, r }); ns[key] = { st: 'ok', ts: nowMs, lastV: r.ratio, lastP: nowMs }; }
      else ns[key] = { st: 'ok', ts: nowMs, lastV: r.ratio, lastP: ns[key]?.lastP };
    }
  }
  return { pushes, state: ns };
}
// 纯函数:推送文案(ETF 走 A股群,价格 3 位小数)
export function etfText(p: VolPush, ts: number): string {
  const amt = p.r.amtYi == null ? '—' : p.r.amtYi.toFixed(1) + '亿';
  const px = p.r.price == null ? '—' : '¥' + p.r.price.toFixed(3);
  const who = `${p.r.name || p.sym}(${p.sym})`;
  if (p.kind === 'recover') return `【ETF量能回落】${who} 量比 ${p.val.toFixed(2)} 回到阈值 ${p.thr} 下方 · 成交额 ${amt} · ${fmtBJ(ts)}`;
  return `【ETF暴量】${who} 量比 ${p.val.toFixed(2)}×(阈值 ${p.thr})· 今日成交额 ${amt} · ${p.r.chgPct == null ? '—' : sp(p.r.chgPct) + '%'} · 现价 ${px} · ${fmtBJ(ts)}`;
}

// —— K 线拉取(直连,勿 cached)——
async function bnK(sym: string, interval: '1m' | '1H', limit: number): Promise<KRow[]> {
  const pair = `${sym}USDT`;
  const bi = interval === '1H' ? '1h' : interval; // 币安 interval 小写(OKX 的 1H 别照抄)
  return fetchBest(
    [
      `https://data-api.binance.vision/api/v3/klines?symbol=${pair}&interval=${bi}&limit=${limit}`,
      `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${bi}&limit=${limit}`,
    ],
    (r: any) => (r || []).map((k: any) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }))
  );
}
async function okxK(sym: string, bar: '1m' | '1H', limit: number): Promise<KRow[]> {
  const j = await fetchBest(
    [`https://www.okx.com/api/v5/market/candles?instId=${sym}-USDT&bar=${bar}&limit=${limit}`],
    (r: any) => {
      if (r?.code !== '0' || !Array.isArray(r?.data)) throw new Error(`OKX ${r?.msg || '无数据'}`);
      return r.data.slice().reverse().map((k: any) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] })); // OKX 新在前→转升序;收盘在 k[4]
    }
  );
  return j;
}
export const bjYMD = (nowMs: number): string => new Date(nowMs + BJ).toISOString().slice(0, 10).replace(/-/g, '');
// 纯函数:腾讯 minute query 回包 → Reading。qt 行同 qt.gtimg.cn 列位(1名 3现价 5今开 30时间 33高 34低);
// 分钟行 "HHmm 价 累计量 额"。时间戳非北京今日(周末/节假日/盘前)→ null 整只不判定,防旧行情误触发。
export function aParse(j: any, code: string, winMin: number, today: string): Reading | null {
  const blk = j?.data?.[code];
  const q = blk?.qt?.[code];
  if (!Array.isArray(q) || q.length < 35) return null;
  if (String(q[30] || '').slice(0, 8) !== today) return null;
  const price = Number(q[3]), open = Number(q[5]), hi = Number(q[33]), lo = Number(q[34]);
  if (!(price > 0)) return null;
  const closes = (((blk?.data?.data || []) as string[])).map(r => Number(String(r).split(' ')[1])).filter(x => x > 0);
  const base = closes.length >= winMin + 1 ? closes[closes.length - 1 - winMin] : 0;
  const quick = base > 0 ? ((closes[closes.length - 1] - base) / base) * 100 : null;
  const day = open > 0 && hi >= lo ? { open, hi, lo, chg: ((price - open) / open) * 100, amp: ((hi - lo) / open) * 100 } : null;
  return { price, quick, day };
}
async function aReading(code: string, winMin: number, nowMs: number): Promise<Reading | null> {
  const j = await fetchBest([`https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${code}`], (r: any) => r);
  return aParse(j, code, winMin, bjYMD(nowMs));
}
async function coinReading(sym: string, t: TaskCfg, nowMs: number): Promise<Reading> {
  const limit = t.winMin + 2;
  const [m1, h1] = await Promise.all([
    sym === 'OKB' ? okxK(sym, '1m', limit) : bnK(sym, '1m', limit),
    sym === 'OKB' ? okxK(sym, '1H', 26) : bnK(sym, '1H', 26),
  ]);
  const price = m1.length ? m1[m1.length - 1].c : null;
  return { price, quick: quickChg(m1, t.winMin), day: dayStats(h1, beijingDayStart(nowMs), price) };
}

// —— 循环与台账 ——
let lastRunTs = 0; // 最近一轮采样完成时刻(0=进程还没采过,status 会顺手补跑一次)
let LAST: Record<string, Reading | null> = {};
let LAST_ETF: Record<string, EtfReading | null> = {};
let ticking: Promise<void> | null = null; // 单飞:status 手动补跑与定时器撞车时共用一次

export async function tick(nowMs = Date.now()): Promise<void> {
  if (ticking) return ticking;
  ticking = (async () => {
    try {
      const cfg = readCfg();
      const readings: Record<string, Reading | null> = {};
      for (const s of ALL_SYMS) readings[s] = null;
      if (!cfg.paused) {
        await Promise.all([
          ...SYMS.map(async s => {
            if (!cfg.tasks[s].on) return;
            try { readings[s] = await coinReading(s, cfg.tasks[s], nowMs); } catch { /* 该币本轮没读数,状态键清理,下轮再来 */ }
          }),
          ...ASTOCKS.map(async a => {
            if (!cfg.tasks[a.sym].on) return;
            try { readings[a.sym] = await aReading(a.code, cfg.tasks[a.sym].winMin, nowMs); } catch { /* 同上 */ }
          }),
        ]);
      }
      LAST = readings;
      // ETF 暴量(2026-10-29):一批代码一次请求,与上面各标的同时段采样
      const list = etfList();
      const etfReadings: Record<string, EtfReading | null> = {};
      for (const e of list) etfReadings[e.sym] = null;
      if (!cfg.paused && cfg.etf.on) {
        try {
          const rows = await etfQuotes(list.map(e => 'sh' + e.sym));
          for (const e of list) etfReadings[e.sym] = etfParse(rows, 'sh' + e.sym, bjYMD(nowMs));
        } catch { /* 该批本轮没读数,下轮再来 */ }
      }
      LAST_ETF = etfReadings;
      const state = loadJson(STATE_FILE) || {};
      const { pushes, state: ns } = evalTransitions(state, readings, cfg, nowMs);
      const { pushes: vpushes, state: ns2 } = evalVol(ns, etfReadings, cfg.etf, list, nowMs);
      saveJson(STATE_FILE, ns2); // 先落态再推送:推送前重读+跃变判定天然去重(双进程同 tick 竞态窗口极小)
      for (const p of pushes) {
        const text = larkText(p, cfg.tasks[p.sym], nowMs);
        const { ok: sendOk, err } = await larkPush(text, nowMs, isAStock(p.sym) ? 'astock' : 'crypto');
        const alerts = loadJson(ALERTS_FILE) || [];
        alerts.push({ ts: nowMs, sym: p.sym, rule: p.rule, kind: p.kind, text, val: p.val, thr: p.thr, sendOk, err: sendOk ? '' : err });
        saveJson(ALERTS_FILE, alerts.slice(-200));
      }
      for (const p of vpushes) {
        const text = etfText(p, nowMs);
        const { ok: sendOk, err } = await larkPush(text, nowMs, 'astock');
        const alerts = loadJson(ALERTS_FILE) || [];
        alerts.push({ ts: nowMs, sym: p.sym, rule: 'vol', kind: p.kind, text, val: p.val, thr: p.thr, sendOk, err: sendOk ? '' : err, mkt: 'a' });
        saveJson(ALERTS_FILE, alerts.slice(-200));
      }
      lastRunTs = nowMs;
    } catch { /* 整轮异常吞掉,下轮重来,循环永不死 */ }
  })().finally(() => { ticking = null; });
  return ticking;
}

export async function status() {
  // 读数超过 55s(刚重启/MONITOR_OFF/循环在别的进程)→ 顺手补采一次,页面永远有数且单飞防挤
  if (!lastRunTs || Date.now() - lastRunTs > 55_000) await tick();
  const cfg = readCfg();
  const state = loadJson(STATE_FILE) || {};
  const allAlerts: any[] = loadJson(ALERTS_FILE) || [];
  const alerts = allAlerts.slice(-8).reverse(); // 页面只留最近 8 条,台账仍存 200
  const day0 = beijingDayStart(Date.now());
  const rows = ALL_SYMS.map(sym => {
    const t = cfg.tasks[sym];
    const r = LAST[sym];
    const one = (rule: Rule, thr: number) => {
      const s: RuleState | undefined = state[`${sym}.${rule}`];
      return { thr, st: s?.st || 'ok', since: s?.ts || null };
    };
    return {
      sym, name: asName(sym), mkt: isAStock(sym) ? 'a' : 'c', on: t.on, winMin: t.winMin, quickPct: t.quickPct, chgOn: t.chgOn, chgPct: t.chgPct, ampOn: t.ampOn, ampPct: t.ampPct,
      price: r?.price ?? null, quick: r?.quick ?? null, day: r?.day ?? null,
      quickS: one('quick', t.quickPct), dayChgS: one('dayChg', t.chgPct), dayAmpS: one('dayAmp', t.ampPct),
    };
  });
  const wh = (m: Mkt) => { const c = larkCreds(m); return { configured: !!c.url, tail: c.url ? c.url.slice(-8) : '', signed: !!c.secret }; };
  const etfRows = etfList().map(e => {
    const r = LAST_ETF[e.sym];
    const s: RuleState | undefined = state[`${e.sym}.vol`];
    return {
      sym: e.sym, name: r?.name || e.name,
      price: r?.price ?? null, chgPct: r?.chgPct ?? null, amtYi: r?.amtYi ?? null, ratio: r?.ratio ?? null, min: r?.min ?? 0,
      st: s?.st || 'ok', since: s?.ts || null,
    };
  });
  return {
    cfg,
    rows,
    etf: { cfg: cfg.etf, rows: etfRows },
    alerts,
    todayFire: allAlerts.filter(a => a.kind === 'fire' && a.ts >= day0).length,
    firing: rows.filter(x => x.quickS.st === 'fire' || x.dayChgS.st === 'fire' || x.dayAmpS.st === 'fire').length + etfRows.filter(x => x.st === 'fire').length,
    webhooks: { crypto: wh('crypto'), astock: wh('astock') },
    running: { lastRunTs, paused: cfg.paused, loopOff: process.env.MONITOR_OFF === '1', pid: process.pid },
  };
}

export async function testSend(mkt: Mkt = 'crypto') {
  const text = `【监控自检】my_money ${mkt === 'astock' ? 'A股' : '币圈'}异动监控连接正常 · ${fmtBJ(Date.now())} · 来自本机 ${process.pid}`;
  const r = await larkPush(text, Date.now(), mkt);
  const alerts = loadJson(ALERTS_FILE) || [];
  alerts.push({ ts: Date.now(), sym: '—', rule: 'test', kind: 'fire', text, val: null, thr: null, sendOk: r.ok, err: r.err, mkt: mkt === 'astock' ? 'a' : 'c' });
  saveJson(ALERTS_FILE, alerts.slice(-200));
  return { ok: r.ok, error: r.ok ? '' : r.err || 'Lark 返回非成功(检查地址/机器人是否被移出群)' };
}

let started = false;
export function startMonitor() {
  if (started || process.env.MONITOR_OFF === '1' || process.env.NODE_ENV === 'unittest') return;
  started = true;
  const t = setInterval(() => { void tick(); }, 60_000);
  t.unref?.(); // 不拦退出(jest/正常 shutdown);服务本身有 listen 保活
}
