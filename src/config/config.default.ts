/*
 * @Author: hui.tian hui.tian@yijinin.com
 * @Date: 2024-05-16 11:00:58
 * @LastEditors: hui.tian hui.tian@yijinin.com
 * @LastEditTime: 2024-05-28 18:26:13
 * @FilePath: /my_money/src/config/config.default.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { MidwayConfig } from '@midwayjs/core';
import { Money } from '../entity/entities/Money';

export default {
  // use for cookie sign key, should change to your own and keep security
  keys: '1715828458675_5336',
  koa: {
    port: 7001,
  },
  typeorm: {
    dataSource: {
      datasource1: {
        name: 'datasource1',
        host: 'k8s-istiosys-risktest-8320a1b63f-0e68ef52f61bb987.elb.ap-southeast-1.amazonaws.com',
        type: 'mysql',
        port: 3309,
        username: 'root',
        password: 'mysql.cht-devbase',
        database: 'my_account',
        entities: [Money],
        synchronize: false,
        logging: true,
      },
    },
  },
} as MidwayConfig;
