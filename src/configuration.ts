import { Configuration, App } from '@midwayjs/core';
import * as koa from '@midwayjs/koa';
import * as validate from '@midwayjs/validate';
import * as info from '@midwayjs/info';
import { join } from 'path';
import { ReportMiddleware } from './middleware/report.middleware';
import { AuthMiddleware } from './middleware/auth.middleware';
import { startMonitor } from './service/monitor.service';
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
    // 币圈异动监控循环(2026-10-18):60s 采样+跃变推 Lark;MONITOR_OFF=1 / unittest 环境不启
    startMonitor();
  }

  // 演示数据启动预热已删(2026-09-22):持仓板块 demo 改为写死假数据+随机抖动、零上游请求,毫秒回,不再需要预热
}
