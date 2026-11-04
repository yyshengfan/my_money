import { Controller, Get, Inject, Query } from '@midwayjs/core';
import { AShareService } from '../service/market.service';
import { MxService } from '../service/mx.service';
import { HoldingService } from '../service/holding.service';
import { cached } from '../util/net';

// A股仪表盘(六块,全公开):数据来自 qt(腾讯,直连)+ 东财(涨跌家数/板块/涨停池/全A/资讯,走系统代理)。
// 每端点 data 里的源统一为 {ok,data}|{ok:false,error}:单源失败只红对应卡,不白屏。
// 机会/资讯在东财不可用时换妙想 MX 兜底(仅失败才调,60s 冷却,不烧配额),返回 {em, mx} 由前端择源。
@Controller('/api/stock')
export class StockController {
  @Inject()
  stock: AShareService;

  @Inject()
  mx: MxService;

  @Inject()
  holding: HoldingService;

  @Get('/market')
  async market() {
    return { success: true, message: 'OK', data: await this.stock.market() };
  }

  @Get('/boards')
  async boards() {
    return {
      success: true,
      message: 'OK',
      data: {
        em: await this.stock.boards().then(
          rows => ({ ok: true as const, data: rows }),
          (e: any) => ({ ok: false as const, error: String(e?.message || e) })
        ),
        asOf: this.stock.boardsOkAt, // 最近成功采集时刻;距今>10min=限流回放,页面如实标日期(2026-10-20)
      },
    };
  }

    @Get('/board-reasons')
  async boardReasons(@Query('names') names = '') {
    const arr = String(names).split(',').map(x => x.trim()).filter(Boolean).slice(0, 12);
    const data = await this.stock.boardReasons(arr).catch(() => ({}));
    return { success: true, message: 'OK', data };
  }

@Get('/opportunity')
  async opportunity() {
    const em = await this.stock.opportunity().then(
      d => ({ ok: true as const, data: d }),
      (e: any) => ({ ok: false as const, error: String(e?.message || e) })
    );
    // 东财 clist 限流才请妙想兜底;MX 行转成与 em 相同的 {cands,down,vol,partial} 形状,前端择源零改动
    let mx = null;
    if (!em.ok) {
      const m = await this.mx.screen().catch((e: any) => ({ ok: false as const, error: String(e?.message || e) }));
      mx = m.ok
        ? { ok: true as const, data: { cands: m.data || [], down: [], vol: [], partial: { mx: true as const } } }
        : m;
    }
    return { success: true, message: 'OK', data: { em, mx } };
  }

  // ③ 价值投资派:妙想 MX 语义选股(基本面免费源唯一路),缓存 3600s;失败只红本卡
  @Get('/value')
  async value() {
    const mx = await this.mx.valuePicks().catch((e: any) => ({ ok: false as const, error: String(e?.message || e) }));
    return { success: true, message: 'OK', data: { mx } };
  }

  // 基金观察:固定清单(data/fund_watch.json)区间收益 + 今日涨跌,60s 缓存
  @Get('/funds')
  async funds() {
    const em = await this.stock.funds().then(
      d => ({ ok: true as const, data: d }),
      (e: any) => ({ ok: false as const, error: String(e?.message || e) })
    );
    return { success: true, message: 'OK', data: { em } };
  }

  // 股票观察:固定清单(data/stock_watch.json)腾讯实时行情 + 前复权日K区间涨跌,60s 缓存
  @Get('/watch')
  async watch() {
    const qt = await this.stock.watch().then(
      d => ({ ok: true as const, data: d }),
      (e: any) => ({ ok: false as const, error: String(e?.message || e) })
    );
    return { success: true, message: 'OK', data: { qt } };
  }

  // 持仓复盘(2026-10-28 用户要求并入股票观察面板,公开免登录:行只有标的/行情/技术事实,无数量成本价)
  // analysis 内部是 qt fresh + 逐只日K 的重活,公开流量靠 cached()(数据分层自动抬至≥5min)+ 前端 SWR 吸收;
  // ?fresh=1 手动刷新穿透。受保护的 /api/holding/analysis 原样保留(页面已不调用)
  @Get('/recap')
  async recap() {
    const ana = await cached('stk:recap', 60_000, () => this.holding.analysis(false)).then(
      d => ({ ok: true as const, data: d }),
      (e: any) => ({ ok: false as const, error: String(e?.message || e) })
    );
    return { success: true, message: 'OK', data: { ana } };
  }

  // ③ 趋势投资派:东财候选 + 腾讯日K本地算指标(MA/MACD/RSI/量能),60s 缓存
  @Get('/trend')
  async trend() {
    const em = await this.stock.trendPicks().then(
      d => ({ ok: true as const, data: d }),
      (e: any) => ({ ok: false as const, error: String(e?.message || e) })
    );
    return { success: true, message: 'OK', data: { em } };
  }

  @Get('/flow')
  async flow() {
    return {
      success: true,
      message: 'OK',
      data: {
        pool: await this.stock.flow().then(
          d => ({ ok: true as const, data: d }),
          (e: any) => ({ ok: false as const, error: String(e?.message || e) })
        ),
      },
    };
  }

  @Get('/moneyflow')
  async moneyflow() {
    const wrap = (p: Promise<any>) =>
      p.then(
        d => ({ ok: true as const, data: d }),
        (e: any) => ({ ok: false as const, error: String(e?.message || e) })
      );
    // em = 两市分时/沪市日线主力净额;nb = 北向成交额(净买入已停发)——两源各自 ok/error,互不拖累
    const [em, nb] = await Promise.all([wrap(this.stock.moneyflow()), wrap(this.stock.northbound())]);
    return { success: true, message: 'OK', data: { em, nb } };
  }

  @Get('/news')
  async news() {
    const em = await this.stock.news().then(
      rows => ({ ok: true as const, data: rows }),
      (e: any) => ({ ok: false as const, error: String(e?.message || e) })
    );
    let mx = null;
    if (!em.ok) {
      const m = await this.mx.news().catch((e: any) => ({ ok: false as const, error: String(e?.message || e) }));
      mx = m.ok ? { ok: true as const, data: m.data || [] } : m;
    }
    return { success: true, message: 'OK', data: { em, mx } };
  }
}
