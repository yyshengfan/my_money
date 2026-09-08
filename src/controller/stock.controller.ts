import { Controller, Get, Inject } from '@midwayjs/core';
import { AShareService } from '../service/market.service';

// A股仪表盘(六块,全公开):数据来自 qt(腾讯,直连)+ 东财(涨跌家数/板块/涨停池/全A/资讯,走系统代理)。
// 每端点 data 里的源统一为 {ok,data}|{ok:false,error}:单源失败只红对应卡,不白屏。
@Controller('/api/stock')
export class StockController {
  @Inject()
  stock: AShareService;

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
    return {
      success: true,
      message: 'OK',
      data: {
        em: await this.stock.opportunity().then(
          d => ({ ok: true as const, data: d }),
          (e: any) => ({ ok: false as const, error: String(e?.message || e) })
        ),
      },
    };
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
    return {
      success: true,
      message: 'OK',
      data: {
        em: await this.stock.news().then(
          rows => ({ ok: true as const, data: rows }),
          (e: any) => ({ ok: false as const, error: String(e?.message || e) })
        ),
      },
    };
  }
}
