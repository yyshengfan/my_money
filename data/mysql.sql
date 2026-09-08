CREATE TABLE `money` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `time` date DEFAULT NULL COMMENT '时间',
  `salary` int DEFAULT NULL COMMENT '工资',
  `inmoney` int DEFAULT NULL COMMENT '进账',
  `credit` int DEFAULT NULL COMMENT '信用卡消费',
  `outmoney_other` int DEFAULT NULL COMMENT '定向支出',
  `outmoney_rent` int DEFAULT NULL COMMENT '房租支出',
  `outmoney_mortgage` int DEFAULT NULL COMMENT '房贷支出',
  `outmoney_social_security` int DEFAULT NULL COMMENT '社保支出',
  `outmoney_cons` int DEFAULT NULL COMMENT '出帐',
  `outmoney_net` int DEFAULT NULL COMMENT '净支出',
  `increment` int DEFAULT NULL COMMENT '增量',
  `periodical` int DEFAULT NULL COMMENT '存款',
  `finance_increase` int DEFAULT NULL COMMENT '理财总盈亏',
  `finance_increase` int DEFAULT NULL COMMENT '理财余额',
  `money` int DEFAULT NULL COMMENT '余额',
  `comment` varchar(255) DEFAULT NULL COMMENT '备注',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=92 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC


CREATE TABLE `money_finance` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `time` date DEFAULT NULL COMMENT '时间',
  `fund` int DEFAULT NULL COMMENT '基金',
  `fund_increase` int DEFAULT NULL COMMENT 'fund盈亏',
  `bit_amount` int DEFAULT NULL COMMENT '币余',
  `bit_increase` int DEFAULT NULL COMMENT 'bit盈亏',
  `stock_amount` int DEFAULT NULL COMMENT '股余',
  `stock_increase` int DEFAULT NULL COMMENT 'stock盈亏',
  `hk_stock_amount` int DEFAULT NULL COMMENT '股余',
  `hk_stock_increase` int DEFAULT NULL COMMENT 'stock盈亏',
  `zfb_amount` int DEFAULT NULL COMMENT 'zfb',
  `zfb_increase` int DEFAULT NULL COMMENT 'zfb盈亏',
  `sum_increase` int DEFAULT NULL COMMENT '总盈亏',
  `money` int DEFAULT NULL COMMENT '余额',
  `comment` varchar(255) DEFAULT NULL COMMENT '备注',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=92 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC
-- ===== 四板块 v1(2026-09):登录 app_users + 持仓 holding =====
-- 注:库里已有一张历史演示 users 表(avatar/nickname 那套,未动),登录表避开取名 app_users
CREATE TABLE IF NOT EXISTS app_users (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(64) NOT NULL UNIQUE COMMENT '用户名',
  `pass_hash` varchar(255) NOT NULL COMMENT 'scrypt salt:hex',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS holding (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(10) NOT NULL COMMENT '600036 / 02331',
  `name` varchar(64) NOT NULL COMMENT '名称',
  `market` varchar(16) NOT NULL COMMENT 'A股·沪 / A股·深 / 港股',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 持仓种子:照抄 /Users/tianhui/claude/config/任务配置.md 持仓表
INSERT IGNORE INTO holding (`code`,`name`,`market`) VALUES
  ('600219','南山铝业','A股·沪'),
  ('300760','迈瑞医疗','A股·深'),
  ('000516','国际医学','A股·深'),
  ('000858','五粮液','A股·深'),
  ('601985','中国核电','A股·沪'),
  ('600887','伊利股份','A股·沪'),
  ('600036','招商银行','A股·沪'),
  ('02331','李宁','港股'),
  ('002612','朗姿股份','A股·深'),
  ('002085','万丰奥威','A股·深'),
  ('09626','哔哩哔哩-W','港股');

-- 登录种子:pass_hash 落库时用 src/service/auth.service.ts 的 hashPassword('初始密码') 生成
-- INSERT INTO app_users (`username`,`pass_hash`) VALUES ('tianhui', '<salt:hex>');  -- 实际用 node scripts/seed_user.js tianhui <密码>
