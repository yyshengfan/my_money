import { Inject, Controller, Get, Post, Body, ALL } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { jobsStatus, saveJobAt, runJobNow, toggleJob } from '../service/jobs.service';
import { JobLabelDTO, JobSaveDTO, JobToggleDTO } from '../dto/jobs.dto';

/*
 * 定时任务 API(2026-10-19,登录板块,auth.middleware PROTECT 已含 /api/jobs)。
 * 任务实体在 ~/claude/somejob/(plists 真身 + jobs.json 清单),LaunchAgents 只留符号链接。
 * 演示账号可看不可改;接口不回传任何 common.env 内容(webhook/密钥永不外出)。
 */
@Controller('/api/jobs')
export class JobsController {
  @Inject()
  ctx: Context;

  private get isDemo(): boolean {
    return !!(this.ctx as any).session?.user?.demo;
  }

  @Get('/list')
  async list() {
    const r = await jobsStatus();
    return { success: r.ok, message: r.ok ? 'OK' : r.message, data: r.jobs || null };
  }

  @Post('/save')
  async save(@Body(ALL) p: JobSaveDTO) {
    if (this.isDemo) return { success: false, message: '演示账号为只读示例数据,不支持修改定时任务', data: null };
    const r = await saveJobAt(p.label, p.at);
    return { success: r.ok, message: r.message, data: null };
  }

  @Post('/run')
  async run(@Body(ALL) p: JobLabelDTO) {
    if (this.isDemo) return { success: false, message: '演示账号不允许触发任务运行', data: null };
    const r = await runJobNow(p.label);
    return { success: r.ok, message: r.message, data: null };
  }

  @Post('/toggle')
  async toggle(@Body(ALL) p: JobToggleDTO) {
    if (this.isDemo) return { success: false, message: '演示账号不允许启停任务', data: null };
    const r = await toggleJob(p.label, p.on);
    return { success: r.ok, message: r.message, data: null };
  }
}
