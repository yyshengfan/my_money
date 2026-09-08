import { Provide, Inject } from '@midwayjs/core';
import { getBuffer, cached } from '../util/net';
import { QtService } from './qt.service';

/*
 * A股行情聚合:腾讯 qt(指数行情,直连)+ 东方财富(涨跌家数/板块/涨停池/全A列表/资讯,走系统代理)。
 * 东方财富 push2 的 clist 接口在本网络偶发空返/断连(疑似边缘限流),统一:
 *   https + &cb=cb(JSONP)拉取,失败隔 ~0.9s 重试一次,再失败整源标 {ok:false,error};
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
// 失败结果按"域名"短缓存 12s —— 东财限流按主机维度,一次 clist 失败意味着同主机的其余调用
// 大概率也失败,冷却整主机让 boards 的 4 路 clist 与板块请求在 12s 内快速红卡,
// 而不是各自把 9s×2 超时吃满(最坏 ~76s)。连点刷新立即红卡不反复重打上游;到点自动重试自愈。
const emDown = new Map<string, number>();
const emHost = (url: string) => new URL(url).host;
async function emJsonp(url: string): Promise<any> {
  const host = emHost(url);
  const downAt = emDown.get(host);
  if (downAt && Date.now() - downAt < 12_000) throw new Error('东方财富接口暂不可用(限流冷却中)');
  // https+cb(JSONP);偶发断连 → 隔 0.9s 重试一次,再失败抛错由 safe() 接住
  for (let i = 0; i < 2; i++) {
    try {
      const buf = await getBuffer(url, 9000, REF);
      const j = JSON.parse(stripJsonp(Buffer.from(buf).toString('utf8')));
      emDown.delete(host); // 成功即解除该主机冷却
      return j;
    } catch {
      if (i === 0) await sleep(900);
    }
  }
  emDown.set(host, Date.now());
  throw new Error('东方财富接口两次请求失败');
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
      const qt = await safe(async () => {
        const q = await this.qtService.quotes(codes);
        return codes.map(code => {
          const r = q[code];
          return r
            ? { code, ok: true as const, name: r.name, price: r.price, chg: r.chg, chgPct: r.chgPct, amountWan: r.amountWan, time: r.time }
            : { code, ok: false as const, error: '该代码无行情' };
        });
      });
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
      return { qt, breadth, limit };
    });
  }

  // ② 板块行情 + ④ 资金同源:全行业板块一次拉回,排序交给前端 tab
  async boards() {
    return cached('stk:boards', 60_000, async () => {
      const url =
        `https://push2.eastmoney.com/api/qt/clist/get?${UT}&fltt=2&invt=2&fid=f3&po=1&pn=1&pz=500&np=1` +
        `&fs=m%3A90%2Bt%3A2&fields=f12,f14,f3,f62,f184&cb=cb`;
      const j = await qClist(url, () => emJsonp(url));
      const rows = ((j?.data?.diff) || []).map(emBoardRow).filter((r: any) => r?.code && r?.name);
      if (!rows.length) throw new Error('板块列表为空');
      return rows;
    });
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
      const rows: any[] = [];
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
