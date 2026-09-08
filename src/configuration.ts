import { Configuration, App } from '@midwayjs/core';
import * as koa from '@midwayjs/koa';
import * as validate from '@midwayjs/validate';
import * as info from '@midwayjs/info';
import { join } from 'path';
import { ReportMiddleware } from './middleware/report.middleware';
import { AuthMiddleware } from './middleware/auth.middleware';
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
}
