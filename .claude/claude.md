# 项目维护记录(my_money)

> 注:Claude Code 自动读取的是项目根目录的 `CLAUDE.md`,本文件作为中文维护笔记,不会被自动加载,需要时手动引用。

## 项目概况

个人记账/理财追踪 API。技术栈:Midway.js v3(Koa)+ TypeORM + MySQL + TypeScript。数据库为本地 `tianhuiaccount`(127.0.0.1:3306)。

## 常用命令

```bash
npm run dev        # 本地开发,http://localhost:7001 (NODE_ENV=local)
npm run build      # 编译到 dist/
npm test           # jest 测试(NODE_ENV=unittest),会真实启动应用 → 需要本地 MySQL 在跑
npm test -- test/controller/home.test.ts   # 跑单个测试文件
npm run lint       # mwts 代码检查(lint:fix 自动修复)
npm start          # 生产启动(bootstrap.js)
```

## 目录结构与请求链路

`src/controller`(路由)→ `src/service`(业务)→ TypeORM Repository(数据)

- `src/controller/money.controller.ts` — `POST /money/create` 记账入口
- `src/service/money.service.ts` — 核心计算逻辑 `createNew()`
- `src/dto/money.dto.ts` — 入参校验(`@Rule` / RuleType,全部 required)
- `src/entity/entities/` — typeorm-model-generator 生成的实体
- `src/config/config.default.ts` — 端口 7001 + typeorm 数据源 `datasource1`
- `src/middleware/report.middleware.ts` — 在 `configuration.ts` 的 onReady 注册
- `src/filter/` — 异常过滤器,当前已注释未启用

## 核心业务逻辑(createNew)

每次记账取 `money` 和 `money_finance` 各最新一行(id DESC take 1),与本次入参做差值,插入两行新记录:

- **理财盈亏**:`*_increase = 本次 - 上次`(基金/币/股票/港股/支付宝),`sumIncrease` 为五项盈亏之和
- **余额** `money` = 零钱 + 理财总额 - 信用卡消费
- **总进帐** `increment` = 新余额 - 上次余额 - 本次信用卡
- **总出帐** `outmoneyCons` = 进账 - 增量
- **净支出** `outmoneyNet` = 进账 + 理财盈亏 - 增量
- **生活开支** `outmoneyLife` = 净支出 - 其他 - 房租 - 房贷 - 社保
- 时间字段用 `moment().format("YYYY-MM-DD")`

⚠️ 已知隐患:
- 空表时 `resMoney[0]` / `resMoneyFinnance[0]` 为 undefined,首个请求会直接报错(无兜底)
- 两次 insert 无事务,中途失败会只写入一半
- `POST /money/finance/init` 是空实现(代码已注释)

## 实体说明

只有 `Money`(收支)和 `MoneyFinance`(理财快照)注册在 `config.default.ts` 的 `entities` 数组里、可被注入。其余生成的实体(Ceshi、Marry、Users、MobileCode、ServerNum、Zhuangxiu 等)未注册、未使用。

**新增实体三步**:① 在 `config.default.ts` import 并加入 `entities` 数组;② service 中 `@InjectEntityModel(X, 'datasource1')`(第二个参数数据源名必须写);③ 数据库表自己建,`synchronize: false`,ORM 不会同步表结构。

实体文件由 `typeorm-model-generator` 生成,重新生成会覆盖,别在实体类里写业务逻辑(命令见根 README"生成entity"一节)。

## 可视化页面(2026-09,v2 深色驾驶舱)

- **共用样式 `public/theme.css`**:令牌、画布(body max-width 1440 居中)、顶栏、面板头、pill 控件、foot。两页各自只留私有 CSS;改公共视觉改这一处

- 入口:`http://localhost:7001/public/dashboard.html`(URL 预设:`?r=3|6|12|36|0` 时间窗月数、`?g=month|quarter|half|year` 粒度)
- 数据:`GET /money/list` 全量返回两表,前端 `groupBy` 聚合(增量求和、金额取期末);`rangeRows` 做全局时间窗;`trimLeading` 裁掉理财字段全 null 的前导段(真实数据首条理财记录 2022-02)
- 布局:英雄区(总资产/现金余额/净现金流/环形占比)→ 财富趋势+本期涨跌排行 → 每期资产变化(可"按小类堆叠")→ 收支 KPI 条+双轴图 → 小类明细(chips 单选即图例)
- 颜色语义:资产蓝 #4f8cff / 赚绿 #58d68d / 亏红 #ff6b6b;小类身份色见 `FIN_CATS`
- 存款(收支表 `periodical`,实体注释"零钱"):总资产 = 理财总额 + 期末存款;环形图第 6 片"存款"用中性银 #cbd5e1;趋势/每期变化/本期表现排行/明细趋势(第 6 个 chip,`ASSET_CATS`)均含存款;仅"理财入行以来"仍只算理财五类
- 数据边界(勿再设计):无日频行情 → 做不了"今日盈亏/美元估值";增量混入转入转出 → 拆不出"净投入 vs 累计收益";排行只能到小类级(基金/币/股票/支付宝/港股),非个股
- `public/dashboard.js` 里聚合逻辑可直接 `node public/dashboard.js` 跑自检;改渲染后用 headless Chrome 截图核对(`--headless=new --screenshot --virtual-time-budget`)
- 静态托管用 `@midwayjs/static-file`,默认前缀 `/public`,目录 `appDir/public`;ECharts 5.5.1 走 jsdelivr(cdnjs 在本网络不加载)

## 资金流水页(2026-09,cashflow)

- 入口:`http://localhost:7001/public/cashflow.html`(URL 直达某月:`?m=2026-08`);与 dashboard 顶部互链
- 深色驾驶舱同款令牌;布局:四 KPI 卡(期末余额/总进账/显性支出/净结余,带较上月环比)→ 支出构成 + 近12月走势(窗口随所选月滚动)→ 当月流水表(含备注)
- **口径**:显性支出 = credit+房租+房贷+社保+其他;绝不用 outmoneyCons/Net/Life(掺理财盈亏)。支出环比箭头中性灰(降是好事);余额环比空月沿用上月
- `node public/cashflow.js` 自检(monthAxis/monthAgg/tipOf)

## 四板块扩展 v1(2026-09)

**首页 `public/hub.html`+`public/hub.js`(2026-09 改为"投资雷达",不再是卡片门户)**:公开页,复用 theme.css 深色规格。顶栏链到 A股/币圈/我的财富🔒(dashboard)/流水🔒(cashflow)/持仓🔒(holdings)。四区:① MARKET PULSE(一句话氛围 + 两个 conic-gradient 圆环仪表:A股温度 / 币圈恐慌贪婪)② 双列行情(A股 上证/深成/创业板指 红涨绿跌 + 币圈 BTC/ETH/SOL 绿涨红跌,各带小条)③ 今日信号(≤5 条派生事实,涨停情绪/温度/成交/上涨占比/恐慌贪婪/市值24h/领涨币)④ A股机会(score chip 抄 stock.js oppScore,无 indPct 故不挂"板块强势")+ 币圈动量(24h 涨幅 top3,非评分)。只消费已有公开端点:`/api/stock/market` `/api/stock/opportunity` `/api/crypto/overview` `/api/me`(右上登录 chip)。纯函数顶层可 `node public/hub.js` 自检。公式与页面一致:aTemp(抄 stock marketTemp:指数40/涨跌家数40/涨停跌停20,缺项剔权重)、fngLabel/fngColor(抄 crypto.js)、pulseTone、heatColor。A股/币圈各列按本市场习惯着色,总览其余色块绿=暖/升、红=冷/跌。⚠️ 负数百分号:`sp()` 只补 `+`,负号靠 `.toFixed()` 自带,否则会显示 `--1%`(已修,勿改回)。海外源挂代理期间币圈列可能短暂全 ✗,60s 自愈重试。

- **登录**:`@midwayjs/session` cookie session;`AuthMiddleware` 只守数据 API(正则 `/^\/(money|api\/holding)(\/|$)/` → 401 JSON),静态 HTML 不守,页面 JS 收 401 跳 `login.html?back=本页`。密码 scrypt(`salt:hex`),哈希生成:`node -e "console.log(require('./dist/service/auth.service').hashPassword('密码'))"`。
- **建表/种子**:`node scripts/seed_v1.js`(幂等,从 config 读密码,执行 data/mysql.sql 的"四板块 v1"段)→ 建 `users` + `holding`(已灌 11 只自选,含 2 港股)。users 行手工插(占位 INSERT 在 data/mysql.sql 注释里)。
- **v1 只有免费源**:大A/持仓报价走腾讯 qt(GBK,服务端 60s 缓存);币圈 Binance vision/alternative.me/CoinGecko/fapi/OKX/Bybit(30s 缓存,逐源 ok/error,失败不白屏)。妙想选股/资讯、飞书推送留细化阶段。
- **海外源要挂代理**:`src/util/net.ts` `scutil --proxy` 探测系统代理并设 HTTPS_PROXY/NO_PROXY(gtimg.cn 直连)。⚠️ 未探到代理时 60s 重探一次(先开服务后开代理会自动接上;以前一次性缓存"无代理"会致海外源全部 8s 超时直到重启)。
- ⚠️ **新 Chrome 不提升块内 function 声明**:各页 `loadAndRender()` 定义在 `if (typeof window…)` 块内并在块内自调用,HTML 尾部不要再写 `<script>loadAndRender()</script>`(dashboard.js 是顶层定义,不受影响)。
- 自检:`node public/stock.js|crypto.js|cashflow.js|dashboard.js`;行情解析单测 `npx jest test/qt.test.ts`。

## 数据库

- 建表 SQL:`mysql.sql`、`data/mysql.sql`
- ⚠️ 数据库密码明文提交在 `config.default.ts` 和 README 中,改动时注意别外传

## 约定

- 注释用中文,保持现有风格
- 金额字段全部 int(单位:元)
