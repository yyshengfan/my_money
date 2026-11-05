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
  ('09626','哔哩哔哩-W','港股'),
  ('002050','三花智控','A股·深'),
  ('002230','科大讯飞','A股·深'),
  ('002600','领益智造','A股·深'),
  ('002714','牧原股份','A股·深'),
  ('000333','美的集团','A股·深'),
  ('002352','顺丰控股','A股·深'),
  ('688825','长鑫科技','A股·沪'),
  ('159382','创业板人工智能ETF南方','A股·深'),
  ('127120','千红转债','A股·深'),
  ('513100','纳指ETF国泰','A股·沪'),
  ('520570','恒生科技ETF南方','A股·沪'),
  ('588750','科创芯片ETF汇添富','A股·沪');

-- 登录种子:pass_hash 落库时用 src/service/auth.service.ts 的 hashPassword('初始密码') 生成
-- INSERT INTO app_users (`username`,`pass_hash`) VALUES ('tianhui', '<salt:hex>');  -- 实际用 node scripts/seed_user.js tianhui <密码>

-- ===== 浏览统计 stat_view(2026-09-20):每个访客 IP 一行,总浏览量 = SUM(views),可直接查表 =====
-- 写入方:StatsService(src/service/stats.service.ts)在 POST /api/stats/view 里
--   INSERT ... ON DUPLICATE KEY UPDATE views = views + 1(每打开一次页面计一次;前端同标签页刷新不重复上报)
-- 常用查询:各 IP 排行  SELECT page, ip, views, updated_at FROM stat_view ORDER BY views DESC;
--           某页总浏览 SELECT SUM(views) FROM stat_view WHERE page = 'hub';
CREATE TABLE IF NOT EXISTS stat_view (
  `id` int NOT NULL AUTO_INCREMENT,
  `page` varchar(40) NOT NULL COMMENT '页面key:hub/stock/crypto',
  `ip` varchar(64) NOT NULL COMMENT '访客真实IP(IPv6最长45字符)',
  `views` int NOT NULL DEFAULT 0 COMMENT '该IP浏览次数',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最近一次浏览',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_page_ip` (`page`, `ip`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== 2026-09-30 理财/零钱充值字段(充值为正、提取为负;增量=本月−上月−充值) =====
-- 已由 scripts/add_deposit_cols.js 幂等执行(SHOW COLUMNS 守卫,缺则 ADD、有则 MODIFY 归位);历史旧行留 NULL 当 0,增量口径不变
-- 列序:每个 deposit 紧跟本项的 *_increase
ALTER TABLE `money_finance`
  ADD COLUMN `fund_deposit`  int DEFAULT NULL COMMENT '基金充值(充值为正、提取为负)' AFTER `fund_increase`,
  ADD COLUMN `bit_deposit`   int DEFAULT NULL COMMENT '币充值(充值为正、提取为负)' AFTER `bit_increase`,
  ADD COLUMN `stock_deposit` int DEFAULT NULL COMMENT '股票充值(充值为正、提取为负)' AFTER `stock_increase`,
  ADD COLUMN `zfb_deposit`   int DEFAULT NULL COMMENT '支付宝充值(充值为正、提取为负)' AFTER `zfb_increase`,
  ADD COLUMN `hk_stock_deposit` int DEFAULT NULL COMMENT '港股充值(充值为正、提取为负)' AFTER `hk_stock_increase`;
ALTER TABLE `money`
  ADD COLUMN `periodical_deposit` int DEFAULT NULL COMMENT '零钱充值(充值为正、提取为负)' AFTER `periodical`;
