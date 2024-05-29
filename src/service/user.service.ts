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

@Provide()
export class UserService {
  // 这里一般会注入一个实体类对应的 Model，包含增删改查方法
  @InjectEntityModel(Money, 'datasource1')
  money: Repository<Money>;

  async getUser() {
    const money = await this.money.find();
    return money;
  }
  async createNew() {
    const money = await this.money.create();
    return money;
  }
}
