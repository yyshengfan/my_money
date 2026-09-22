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

  // GET /api/fortune → 今日财运分(娱乐功能:50~100 随机整数,公开免登录)
  @Get('/api/fortune')
  async fortune(): Promise<{ score: number }> {
    return { score: 50 + Math.floor(Math.random() * 51) };
  }
}
