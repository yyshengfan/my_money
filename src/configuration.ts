import { Configuration, App } from '@midwayjs/core';
import * as koa from '@midwayjs/koa';
import * as validate from '@midwayjs/validate';
import * as info from '@midwayjs/info';
import { join } from 'path';
import { ReportMiddleware } from './middleware/report.middleware';
import { AuthMiddleware } from './middleware/auth.middleware';
import { HoldingService } from './service/holding.service';
import * as orm from '@midwayjs/typeorm';
import * as staticFile from '@midwayjs/static-file';
import * as session from '@midwayjs/session';

@Configuration({
  imports: [
    orm,
    koa,
    validate,
    staticFile,
    session,
    {
      component: info,
      enabledEnvironment: ['local'],
    },
  ],
  importConfigs: [join(__dirname, './config')],
})
export class MainConfiguration {
  @App('koa')
  app: koa.Application;

  async onReady() {
    // add middleware
    this.app.useMiddleware([ReportMiddleware, AuthMiddleware]);
  }

  async onServerReady() {
    // 演示数据启动预热(2026-09-20):冷路径并发拉上游 ≈14s,会打爆前端 10s 超时→「持仓不可用」。
    // 开跑就后台把 demo 的 analysis/crypto/4 档 history 灌进 demoSwr,访客永远只读到成品。
    // 全程 fire-and-forget + catch:任何一路挂都不影响启动(真实账号不受这层管辖)。
    const ctx = this.app.getApplicationContext();
    ctx.getAsync(HoldingService).then(hs => {
      hs.analysis(false, true).catch(() => {});
      for (const r of ['1d', '7d', '30d', '1y']) hs.cryptoHistory(r, true).catch(() => {});
    }).catch(() => {});
  }
}
