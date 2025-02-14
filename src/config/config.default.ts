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
        // host: '127.0.0.1',
        host: 'unify-test-3.cluster-cz8dkjxh2flz.ap-southeast-1.rds.amazonaws.com',
        type: 'mysql',
        port: 3306,
        // username: 'root',
        username: 'app_user',
        // password: 'Th21211314~~',
        password: 'PLO75FbcfmFYRuQEGmygZ9PyQCQbmgeD5',
        // database: 'tianhuiaccount',
        database: 'bybit_taie_test',
        entities: [Money],
        synchronize: false,
        logging: true,
      },
    },
  },
} as MidwayConfig;
