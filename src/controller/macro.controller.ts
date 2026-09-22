import { Controller, Get, Inject } from '@midwayjs/core';
import { MacroService } from '../service/macro.service';

// 全球宏观四资产(纳指100/美债10Y/黄金/WTI),公开端点(AuthMiddleware 正则不匹配 /api/macro)。
// data 为逐资产 {ok,data}|{ok:false,error},单源失败前端对应卡显示「—」。
@Controller('/api/macro')
export class MacroController {
  @Inject()
  macroSrv: MacroService;

  @Get('/')
  async macro() {
    return { success: true, message: 'OK', data: await this.macroSrv.macro() };
  }
}
