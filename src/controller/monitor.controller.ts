import { Inject, Controller, Get, Post, Body, ALL } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { status as monitorStatus, writeCfg, testSend } from '../service/monitor.service';
import { MonitorSaveDTO } from '../dto/monitor.dto';

/*
 * 币圈异动监控 API(2026-10-18,登录板块,auth.middleware PROTECT 已含 /api/monitor)。
 * GET /status 看板+配置+推送历史;POST /save 编辑任务(演示账号只读拒绝);POST /test 测 webhook 连通。
 */
@Controller('/api/monitor')
export class MonitorController {
  @Inject()
  ctx: Context;

  private get isDemo(): boolean {
    return !!(this.ctx as any).session?.user?.demo;
  }

  @Get('/status')
  async status() {
    return { success: true, message: 'OK', data: await monitorStatus() };
  }

  @Post('/save')
  async save(@Body(ALL) p: MonitorSaveDTO) {
    if (this.isDemo)
      return { success: false, message: '演示账号为只读示例数据,不支持编辑监控任务', data: null };
    writeCfg(p);
    return { success: true, message: '已保存,下一轮采样(≤60s)生效', data: null };
  }

  @Post('/test')
  async test(@Body(ALL) p: { mkt?: string }) {
    if (this.isDemo)
      return { success: false, message: '演示账号不允许向群机器人发送消息', data: null };
    const r = await testSend(p?.mkt === 'astock' ? 'astock' : 'crypto');
    return { success: r.ok, message: r.ok ? '测试消息已发送,去 Lark 群里看一眼' : r.error, data: null };
  }
}
