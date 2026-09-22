/*
 * @Author: hui.tian hui.tian@yijinin.com
 * @Date: 2024-05-16 11:00:58
 * @LastEditors: hui.tian hui.tian@yijinin.com
 * @LastEditTime: 2024-05-29 11:18:27
 * @FilePath: /my_money/src/controller/api.controller.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { Inject, Controller, Get, Post, Body, ALL } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { MoneyService } from '../service/money.service';
import { MoneyDTO } from '../dto/money.dto';
import { demoMoneyList } from '../service/demo';

@Controller('/money')
export class APIController {
  @Inject()
  ctx: Context;

  @Inject()
  moneyService: MoneyService;

  // 演示账号(tianhui 之外):只读假数据,记账写入直接拒
  private get isDemo(): boolean {
    return !!(this.ctx as any).session?.user?.demo;
  }

  @Post('/create')
  async getUser(@Body(ALL) params: MoneyDTO) {
    if (this.isDemo)
      return { success: false, message: '演示账号为只读示例数据,不支持记账', data: null };
    const res = await this.moneyService.createNew(params);
    return { success: true, message: 'OK', data: res };
  }

  @Get('/list')
  async list() {
    const res = this.isDemo ? demoMoneyList() : await this.moneyService.findAll();
    return { success: true, message: 'OK', data: res };
  }
}
