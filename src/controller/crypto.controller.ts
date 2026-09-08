import { Controller, Get, Inject, Query } from '@midwayjs/core';
import { CryptoService } from '../service/crypto.service';

@Controller('/api/crypto')
export class CryptoController {
  @Inject()
  cryptoService: CryptoService;

  @Get('/overview')
  async overview() {
    const data = await this.cryptoService.overview();
    return { success: true, message: 'OK', data };
  }

  @Get('/announcements')
  async announcements() {
    const data = await this.cryptoService.announcements();
    return { success: true, message: 'OK', data };
  }

  @Get('/etf')
  async etf() {
    const data = await this.cryptoService.etfFlows();
    return { success: true, message: 'OK', data };
  }

  @Get('/funding/history')
  async fundingHistory(@Query('coin') coin?: string) {
    const data = await this.cryptoService.fundingHistory(coin || 'BTC');
    return { success: true, message: 'OK', data };
  }

  @Get('/news')
  async news() {
    const data = await this.cryptoService.news();
    return { success: true, message: 'OK', data };
  }

  @Get('/chain')
  async chain() {
    const data = await this.cryptoService.chain();
    return { success: true, message: 'OK', data };
  }
}
