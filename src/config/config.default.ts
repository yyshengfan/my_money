import { MidwayConfig } from '@midwayjs/core';
import { Money } from '../entity/entities/Money';
import { MoneyFinance } from '../entity/entities/MoneyFinance';
import { Users } from '../entity/entities/Users';
import { Holding } from '../entity/entities/Holding';

export default {
  // use for cookie sign key, should change to your own and keep security
  keys: '1715828458675_5336',
  koa: {
    // APP_PORT 可覆盖:7001 常年被 launchd prod 占用,本地起 dev 用 APP_PORT=7301 npm run dev 并存
    port: Number(process.env.APP_PORT) || 7001,
  },
  typeorm: {
    dataSource: {
      datasource1: {
        name: 'datasource1',
        host: '127.0.0.1',
        // host: 'unify-test-3.cluster-cz8dkjxh2flz.ap-southeast-1.rds.amazonaws.com',
        type: 'mysql',
        port: 3306,
        username: 'root',
        // username: 'app_user',
        password: 'Th21211314~~',
        // password: 'PLO75FbcfmFYRuQEGmygZ9PyQCQbmgeD5',
        database: 'tianhuiaccount',
        // database: 'bybit_taie_test',
        entities: [Money,MoneyFinance,Users,Holding],
        synchronize: false,
        logging: true,
      },
    },
  },
} as MidwayConfig;
