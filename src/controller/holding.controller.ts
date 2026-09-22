import { Controller, Get, Inject, Query } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { Holding } from '../entity/entities/Holding';
import { QtService, quoteCode } from '../service/qt.service';
import { HoldingService } from '../service/holding.service';
import { DEMO_STOCKS } from '../service/demo';

@Controller('/api/holding')
export class HoldingController {
  @Inject()
  ctx: Context;

  @InjectEntityModel(Holding, 'datasource1')
  holdingRepo: Repository<Holding>;

  @Inject()
  qtService: QtService;

  @Inject()
  holdingService: HoldingService;

  // 演示账号(tianhui 之外的登录):自选清单换假股、分析/币圈走 demo 路径(行情仍是公开真值)
  private get isDemo(): boolean {
    return !!(this.ctx as any).session?.user?.demo;
  }

  @Get('/list')
  async list() {
    const rows = this.isDemo ? DEMO_STOCKS : await this.holdingRepo.find({ order: { id: 'ASC' } });
    return { success: true, message: 'OK', data: rows };
  }

  // 逐行 {code,name,market,...行情} 或 {...,error}:行情整体挂时不白屏
  @Get('/quotes')
  async quotes(@Query('fresh') fresh?: string) {
    const rows: Array<{ code: string; name: string; market: string }> = this.isDemo
      ? DEMO_STOCKS
      : await this.holdingRepo.find({ order: { id: 'ASC' } });
    let map: Record<string, any> = {};
    let err: string | null = null;
    try {
      map = await this.qtService.quotes(
        rows.map(r => quoteCode(r.code, r.market)),
        fresh === '1' // 页面「刷新」按钮强制跳过 60s 缓存
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

  // ③ A股/港股技术面简评(逐只 {tech,rs,verdict} 或 {error},60s 缓存)
  @Get('/analysis')
  async analysis(@Query('fresh') fresh?: string) {
    try {
      return { success: true, message: 'OK', data: await this.holdingService.analysis(fresh === '1', this.isDemo) };
    } catch (e: any) {
      return { success: false, message: String(e?.message || e), data: [] };
    }
  }

  // ④ 币圈持仓(现货+合约,台账 data/crypto_holdings.json;演示账号用假台账)
  @Get('/crypto')
  async crypto(@Query('fresh') fresh?: string) {
    try {
      return { success: true, message: 'OK', data: await this.holdingService.crypto(fresh === '1', this.isDemo) };
    } catch (e: any) {
      return { success: false, message: String(e?.message || e), data: null };
    }
  }

  // ⑤ 币圈总资产走势(OKX 公共K线 × 当前持仓回溯估算;r=1d|7d|30d|1y)
  @Get('/crypto/history')
  async cryptoHistory(@Query('r') r: string) {
    try {
      return { success: true, message: 'OK', data: await this.holdingService.cryptoHistory(r || '1d', this.isDemo) };
    } catch (e: any) {
      return { success: false, message: String(e?.message || e), data: null };
    }
  }
}
