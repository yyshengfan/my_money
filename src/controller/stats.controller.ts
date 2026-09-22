import { Body, Controller, Get, Inject, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { StatsService } from '../service/stats.service';

// 公开页小部件:浏览量(明文 IP 记入 MySQL stat_view,每 IP 一行)/点赞(data/stats.json,IP 哈希去重)。
// 页面 key 白名单式清洗(只留 /api/stock 风格的路径文件名),防脏 key 撑爆台账。
const clean = (p: unknown) => {
  const s = String(p ?? '').toLowerCase().replace(/^.*\//, '').replace(/\.html$/, '');
  return /^[a-z0-9_-]{1,40}$/.test(s) ? s : 'hub';
};

@Controller('/api/stats')
export class StatsController {
  @Inject()
  stats: StatsService;

  @Inject()
  ctx: Context;

  @Get('/')
  async get() {
    return { success: true, message: 'OK', data: await this.stats.get(clean(this.ctx.query.page)) };
  }

  @Post('/view')
  async view(@Body() body: { page?: string }) {
    // ctx.ip:prod 走隧道 + koa.proxy:true,取的是访客真实 IP(X-Forwarded-For)
    return { success: true, message: 'OK', data: await this.stats.view(clean(body?.page), this.ctx.ip) };
  }

  @Post('/like')
  async like(@Body() body: { page?: string }) {
    return { success: true, message: 'OK', data: await this.stats.like(clean(body?.page), this.ctx.ip) };
  }
}
