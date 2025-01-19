/*
 * @Author: hui.tian hui.tian@yijinin.com
 * @Date: 2024-05-16 11:00:58
 * @LastEditors: hui.tian hui.tian@yijinin.com
 * @LastEditTime: 2024-05-29 11:18:00
 * @FilePath: /my_money/src/service/user.service.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Money } from '../entity/entities/Money';
import { Repository } from 'typeorm';
import { MoneyDTO } from '../dto/money.dto';
import moment = require('moment');

@Provide()
export class MoneyService {
  // 这里一般会注入一个实体类对应的 Model，包含增删改查方法
  @InjectEntityModel(Money, 'datasource1')
  money: Repository<Money>;

  async createNew(params: MoneyDTO) {
    const money = await this.getlastRecord();

    const moneyNew = new Money();
    // 原声参数
    moneyNew.salary = params.salary;
    moneyNew.inmoney = params.inmoney;
    moneyNew.credit = params.credit;
    moneyNew.periodical = params.periodical;
    moneyNew.fund = params.fund;
    moneyNew.bitAmount = params.bitAmount;
    moneyNew.stockAmount = params.stockAmount;
    moneyNew.zfbAmount = params.zfbAmount;
    moneyNew.comment = params.comment;
    moneyNew.outmoneyOther = params.outmoneyOther;
    moneyNew.outmoneyRent = params.outmoneyRent;
    moneyNew.outmoneyMortgage = params.outmoneyMortgage;
    moneyNew.outmoneySocialSecurity = params.outmoneySocialSecurity;

    // 计算理财
    moneyNew.zfbProfit = params.zfbAmount - money.zfbAmount;
    moneyNew.bitProfit = params.bitAmount - money.bitAmount;
    moneyNew.stockProfit = params.stockAmount - money.stockAmount;
    moneyNew.time = moment().format('YYYY-MM-DD');

    // 计算其他 总和
    moneyNew.money =
      params.periodical +
      params.fund +
      params.bitAmount +
      params.stockAmount +
      params.zfbAmount -
      params.credit;


    moneyNew.increment = moneyNew.money - money.money;
    // 总支出
    moneyNew.outmoneyCons = moneyNew.inmoney - moneyNew.increment;


    // 净支出
    moneyNew.outmoneyNet =
      moneyNew.outmoneyCons -
      params.outmoneyOther -
      params.outmoneyRent -
      params.outmoneyMortgage -
      params.outmoneySocialSecurity;

    const res = await this.money.insert(moneyNew);
    return res;
  }

  // 获取最后一条
  async getlastRecord() {
    const res = await this.money.find({
      order: { id: 'DESC' },
      take: 1,
    });
    return res[0];
  }
}
