import { Controller, Get, Inject } from '@midwayjs/core';
import { AShareService } from '../service/market.service';
import { MxService } from '../service/mx.service';

// A股仪表盘(六块,全公开):数据来自 qt(腾讯,直连)+ 东财(涨跌家数/板块/涨停池/全A/资讯,走系统代理)。
// 每端点 data 里的源统一为 {ok,data}|{ok:false,error}:单源失败只红对应卡,不白屏。
// 机会/资讯在东财不可用时换妙想 MX 兜底(仅失败才调,60s 冷却,不烧配额),返回 {em, mx} 由前端择源。
@Controller('/api/stock')
export class StockController {
  @Inject()
  stock: AShareService;

  @Inject()
  mx: MxService;

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
      },
    };
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
