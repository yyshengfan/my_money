import { Controller, Get, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';

@Controller('/')
export class HomeController {
  @Inject()
  ctx: Context;

  // GET / → 首页(hub.html)。静态页挂在 /public,裸路径直接 302 过去
  @Get('/')
  async home(): Promise<void> {
    this.ctx.redirect('/public/hub.html');
  }
}
