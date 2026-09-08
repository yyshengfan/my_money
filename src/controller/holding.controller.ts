import { Controller, Get, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { Holding } from '../entity/entities/Holding';
import { QtService, quoteCode } from '../service/qt.service';

@Controller('/api/holding')
export class HoldingController {
  @InjectEntityModel(Holding, 'datasource1')
  holdingRepo: Repository<Holding>;

  @Inject()
  qtService: QtService;

  @Get('/list')
  async list() {
    const rows = await this.holdingRepo.find({ order: { id: 'ASC' } });
    return { success: true, message: 'OK', data: rows };
  }

  // 逐行 {code,name,market,...行情} 或 {...,error}:行情整体挂时不白屏
  @Get('/quotes')
  async quotes() {
    const rows = await this.holdingRepo.find({ order: { id: 'ASC' } });
    let map: Record<string, any> = {};
    let err: string | null = null;
    try {
      map = await this.qtService.quotes(
        rows.map(r => quoteCode(r.code, r.market))
      );
    } catch (e: any) {
      err = String(e?.message || e);
    }
    const data = rows.map(r => {
      const q = map[quoteCode(r.code, r.market)];
      return q
        ? { code: r.code, name: r.name, market: r.market, ok: true, ...q }
        : { code: r.code, name: r.name, market: r.market, ok: false, error: err || '该源无数据' };
    });
    return { success: !err, message: err ? `行情源不可用:${err}` : 'OK', data };
  }
}
