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

注册在 `config.default.ts` 的 `entities` 数组里、可被注入的共 4 个:`Money`(收支)、`MoneyFinance`(理财快照)、`Users`(登录)、`Holding`(持仓)。其余生成的实体(Ceshi、Marry、MobileCode、ServerNum、Zhuangxiu 等)未注册、未使用。

**新增实体三步**:① 在 `config.default.ts` import 并加入 `entities` 数组;② service 中 `@InjectEntityModel(X, 'datasource1')`(第二个参数数据源名必须写);③ 数据库表自己建,`synchronize: false`,ORM 不会同步表结构。

实体文件由 `typeorm-model-generator` 生成,重新生成会覆盖,别在实体类里写业务逻辑(命令见根 README"生成entity"一节)。

## 可视化页面(2026-09,v2 深色驾驶舱)

- **共用样式 `public/theme.css`**:令牌、画布(body max-width 1440 居中)、顶栏、面板头、pill 控件、foot。两页各自只留私有 CSS;改公共视觉改这一处
- **手机适配(2026-09)**:theme.css 尾部 + 各雷达页 `<style>` 尾部各有 `@media(max-width:640px)` 块(纯追加,桌面不变);目标 393/402 CSS px(iPhone 16 / 15 Pro)。⚠️ **用户手机实测视口 ~690px**,两栏版式(右栏定宽 300/340/348px、三列 grid、11 列宽表)只按 ≤640 拆栏会在 641~1080 中间带挤坏(挂单条挤没/表头竖排/内容叠字,2026-09-20 两次抓包)——拆栏断点按内容定,宁高勿低(book 1080、holdings cgrid 900/cgrid2 1080、spot 表 1000、theme .tscroll 首列吸附 900);theme.css 走 `?v=` 版本号(现 20260920b,7 页同改)。header 靠 CSS order 重组为"标题+登录态 / 6链接整行 / 控件"三段,连体 pill 独立化。守则:页面级永不横向滚动,宽表走各自 `.tscroll`/`#spot` 内横滑(`-webkit-overflow-scrolling:touch`);数字用 clamp/缩列防贴边。改这几处公共/私有样式时别删手机块。

- 入口:`http://localhost:7001/public/dashboard.html`(URL 预设:`?r=3|6|12|36|0` 时间窗月数、`?g=month|quarter|half|year` 粒度)
- 数据:`GET /money/list` 全量返回两表,前端 `groupBy` 聚合(增量求和、金额取期末);`rangeRows` 做全局时间窗;`trimLeading` 裁掉理财字段全 null 的前导段(真实数据首条理财记录 2022-02)
- 布局:英雄区(总资产/现金余额/净现金流/环形占比)→ 财富趋势+本期涨跌排行 → 收支 KPI 条+双轴图 → 每期理财盈亏变化(可"按小类堆叠",2026-09-30 用户改:剔存款增量、只画 fin.sumIncrease,并与收支块换序)→ 小类明细(chips 单选即图例)
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

**首页 `public/hub.html`+`public/hub.js`(2026-09 改为"投资雷达",不再是卡片门户;2026-09-20 总览改版见下条)**:公开页,复用 theme.css 深色规格。顶栏链到 A股/币圈/我的财富🔒(dashboard)/流水🔒(cashflow)/持仓🔒(holdings)。版面:① 板块①「全球市场·宏观」(八磁贴+stats 行+30日归一六线图,取代旧 MARKET PULSE/GLOBAL MACRO)② 板块② A股|币圈 双面板(大卡+sparkline)③ 今日信号(≤5 条派生事实,2026-09-20 并入板块①末尾,不再独立成块,`.gcap` 小节题+虚线分隔,hub.js 零改动)④ A股机会(score chip 抄 stock.js oppScore,无 indPct 故不挂"板块强势")+ 币圈动量(24h 涨幅 top3,非评分)+ 事件雷达(改版未动)。公开端点:`/api/stock/market` `/api/stock/opportunity` `/api/crypto/overview` `/api/macro` `/api/events`,二传 `/api/stock/moneyflow`+`/api/stock/boards`(右上登录 chip 由共享 nav.js 取 `/api/me`,hub.js 不自己拉)。纯函数顶层可 `node public/hub.js` 自检。公式与页面一致:aTemp(抄 stock marketTemp:指数40/涨跌家数40/涨停跌停20,缺项剔权重)、fngLabel/fngColor(抄 crypto.js)、oppScore、macroRegime、mktTemp、volClass(pulseTone/heatColor 仅剩自检引用)。涨跌配色全站统一绿涨红跌(2026-09-20 拍板,`.rna/.pos/.cup`=涨=绿;总览其余色块绿=暖/升、红=冷/跌不变)。⚠️ 负数百分号:`sp()` 只补 `+`,负号靠 `.toFixed()` 自带,否则会显示 `--1%`(已修,勿改回)。海外源挂代理期间币圈列可能短暂全 ✗,60s 自愈重试。

- **登录**:`@midwayjs/session` cookie session;`AuthMiddleware` 只守数据 API(正则 `/^\/(money|api\/holding)(\/|$)/` → 401 JSON),静态 HTML 不守,页面 JS 收 401 跳 `login.html?back=本页`。密码 scrypt(`salt:hex`),哈希生成:`node -e "console.log(require('./dist/service/auth.service').hashPassword('密码'))"`。
- **建表/种子**:`node scripts/seed_v1.js`(幂等,从 config 读密码,执行 data/mysql.sql 的"四板块 v1"段)→ 建 `users` + `holding`(已灌 11 只自选,含 2 港股)。users 行手工插(占位 INSERT 在 data/mysql.sql 注释里)。
- **v1 只有免费源**:大A/持仓报价走腾讯 qt(GBK,服务端 60s 缓存);币圈 Binance vision→`api.binance.com` 镜像回退 /alternative.me/CoinGecko/fapi/OKX/Bybit(30s 缓存,逐源 ok/error,失败不白屏);`/api/crypto/overview` 另带 `fut.binance`(BTC/ETH fapi 资金费率/持仓额/多空比,hub 币圈 strip 徽标,缺 → '—')。**妙想 MX 兜底已启用**:env `MX_APIKEY`(勿提交/打印),`src/service/mx.service.ts` `screen()/news()`(60s 冷却+缓存,只解析不改上游);东财失败时 `/api/stock/opportunity|news` 回 `{em,mx}`,前端(股票/hub)择 ok 者并注明"东财不可用,当前为妙想兜底"。飞书推送留细化阶段。
- **海外源要挂代理**:`src/util/net.ts` `scutil --proxy` 探测系统代理并设 HTTPS_PROXY/NO_PROXY(gtimg.cn 直连)。⚠️ 未探到代理时 60s 重探一次(先开服务后开代理会自动接上;以前一次性缓存"无代理"会致海外源全部 8s 超时直到重启)。
- **首页总览改版 板块①②(2026-09-20,照用户参考图 `image.png`;事件雷达按要求保持不变)**:①「全球市场·宏观」= 旧 MARKET PULSE + GLOBAL MACRO 合并:八 KPI 磁贴(BTC/**上证**(用户要求换掉原ETH,与板块②同源)/纳指/标普500/黄金/原油WTI/10Y/DXY,价格+24h▲▼,10Y标bp)+ stats 行(总市值/BTC.D/VIX/市场情绪红黄绿渐变条白pin,合成温度环 `#mkt-temp` 移入此,标签短写 **MKT TEMP** + `.gs` 按内容撑开换行——长词撑爆窄格曾出框)+ 右侧「主要资产30日走势(归一化)」六线共享y值域图带30d%图例(BTC/**上证**/纳指/黄金/原油/10Y,六线色相拉开防难辨;**悬停识别**:每条线 `<title>` 原生提示「名·近30日±X%」+ 透明宽 `.hit` 热区 + CSS 高亮本线压暗其余,零JS)。② A股|币圈双面板:A股=上证大卡(新浪日K spark)+深证成指/创业板指/**恒指/恒生科技**(用户点名,勿删)mini行+成交额(较昨日)+涨跌家数条+热门板块chips;币圈=BTC/ETH大卡(币安vision日K spark)+**CMC100/CD20**(用户点名)mini行+总市值/BTC.D+热门币种chips;均带「查看详情→」。后端:`/api/macro` 扩到7key(标普=.INX、DXY/VIX=雅虎chart⚠️close有null洞`+null=0`过不了Number.isFinite,必须`d.c>0`滤,曾把dxy打成0;逐资产加 `chg24{pct,bp}`)、`/api/crypto/overview` 加 `spark`+`domx`(CMC **data-api** 免key,pro-api 免key=500 busy 勿再试)、`/api/stock/market` 加 `shK`(新浪CN日K;腾讯fqkline对指数回空已弃)。⚠️ 前端**二传补丁**:moneyflow+boards 不阻塞主渲染(东财限流冷却时板块chips先显示「待取(东财限流自愈)」,回包只重渲A股面板)——属自愈非bug,勿改成全等。旧 renderHero/renderMacro/MAC环图/capSlices 已删。源教训全部保留(NDX真指数勿换回NQ期货代理、黄金=伦敦金XAU勿换GC、财政部CSV降序须sort、首页只30D)。详见根 CLAUDE.md「Hub 总览改版」条 + `npx jest test/macro.test.ts`。
- **首页 GLOBAL EVENTS 事件雷达(2026-09)**:页面最底部(用户 2026-09 要求从 MACRO 后移到底部并图形化:竖轴虚线 + 影响色节点 + 日期分组头 + 资产强度条 + 倒计时进度条 + 风险堆叠条)的未来 30 日 🔴高/🟠中事件时间轴(LOW 隐藏)+ NEXT BIG EVENT 每秒倒计时 + THIS WEEK 风险热度,公开端点 `GET /api/events`(events.service.ts,1h 缓存,上游挂直接回台账)。唯一免key源 = ForexFactory 官方周 feed `nfs.faireconomy.media/ff_calendar_thisweek.json`(**只给当周**,nextweek 404,jin10/wscn/TE/FMP 不可用)→ 本地台账 `data/events_daily.json` 逐周滚入攒 30 天覆盖,冷启动只显本周、页头如实写「未来N天」属预期。标题机翻复用已 export 的 `zhTitle()`;无源事件(token解锁/空投)手记 `data/events_manual.json`(北京时间字符串,+08:00 解析);⚠️ ff 的 country 字段实为币种代码。前端 `evAssets/nextBig/weekRisk/fmtLeft/groupEvents` 纯函数(hub.js 自检;groupEvents 把同币种≤40min 的一次发布多条并成一行+「同场N项」副行,勿再逐条刷屏)+ `npx jest test/events.test.ts`。
- **首页 THRR 动效系统(2026-09)**:六原语(market-pulse/signal-pulse/data-tick/radar-scan/event-glow/energy-flow)=纯 CSS keyframes + 渲染后唯一接触点 `motionPass()`(try-catch 吞异常,动效永不拖累数据),铁律「90%静止/10%响应、动效绑定数据、禁粒子/3D/无数据循环」。要点:`tickScan` 按「行名|class」diff `LAST` 才闪 `.tk`;温度环 `mktTemp()`(A股40/宏观票数30/贪婪30,`macroRegime` 加回 `sum`)灌 `#mkt-temp`(静态节点,总览改版后在板块① stats 行末格 `.gs.mtemp`,renderGlobal 不重建它);能量流只走 `#oppA,#oppC`(旧 crypto-idx/strip/srow 随改版删除;万亿文本误判方向的教训仍有效);|涨跌|≥5% 新数据 → `.anom`+MOMENTUM 徽标;背景呼吸 `volClass()` 定档、默认静止;NEXT 倒计时呼吸是全页唯一循环。全走 animation → theme.css `prefers-reduced-motion` 全局熔断,勿加 JS 判断。跳过 RADAR ONLINE 遮挡式加载(整页一次渲染,反而延迟读数据)。详见根 CLAUDE.md「Hub THRR Motion System」条。
- **资讯滚动卡(2026-09-20 时间线版;2026-10-21 照首页「今日信号」改版)**:A股「重要资讯」与币圈「为什么今天涨跌」两面板。10-21 用户「参考首页的今日信号的设计,让我可以上下滑动那个板块」——行卡改抄首页 `.sig` 语系(描边圆角+级别圆点三色+粗体标题+mono meta 一行),滚动容器抄 `.evlist` 做法;公共样式现为 **theme.css `.slw/.sln`**(旧 `.tl*` 时间线块整删,两页 640 media 无引用核过),日期分组头/图例取消(时间进每行 meta),条数 8/12→**slice 20 吃滚动**,板块位置:两页 10-21 曾上移,**2026-10-22 用户「原来的位置不要动」+「币圈也有同样的问题」→ 均已挪回原位(A股页尾 grid2 左列、币圈页尾 c-ann 后),勿再挪**;eyebrow 挂圆点三色注记;newsHeat/cryptoNewsHeat 判定、MX 兜底注记、srcBadges、panelRef ⟳ 注册均未动。bump theme.css?v=20261021a(8页)+stock/crypto.js?v=20261021a。级别=纯函数 stock.js `newsHeat` / crypto.js `cryptoNewsHeat`(关键词启发,只判级别不构成建议,进 selftest)。同日(9-20) ⑥ 市场异动三卡(涨停连板/跌幅榜/放量榜)各截 4 条(mvcard 抬头 Top 4,未再动)。

- **③ 今日机会 · 两派(v2,2026-09)**:stock.html ③ 由单一启发式 Top4 改为「价值投资派 TOP5 | 趋势投资派 TOP5」双列,新端点 `GET /api/stock/value|trend`(各 {ok,data|error},前端并行各画各的;hub 与 /api/stock/opportunity 保持原样)。**价值派**=`mx.valuePicks`(基本面唯一免费源=妙想 MX,严格→放宽两档问句级联;缓存 3600s 盘中每小时一刷,配额敏感勿加频;两档均 0 只是事实,level:'none' 正常缓存不进冷却;`valueScore` 质地40+估值30+错杀30,错杀=(区间最高-现价)/区间最高)。⚠️ MX 实测两坑(已进单测):要求「52周最高价」回的是「**区间最高价(日线不复权)**」列;「**市场代码简称**」(SH/SZ)会撞 /代码/ 把 code 打污染 → fieldOf 遇 /市场/ 直接丢列。**趋势派**=`market.trendPicks`(60s):opportunity() 候选池粗筛(0<涨幅<9.8/换手3~20/量比≥1.2/主力净>0)→按主力净取前12只→`web.ifzq.gtimg.cn/appstock/app/fqkline/get`(前复权日K,免key直连)→服务端纯函数 `klineInd`(MA5>10>20>60 且 MA20 向上/站MA20/MACD 零上金叉或红柱连放/RSI14-Wilder/量5÷60/60日新高)→**四项硬门槛**过者按 `trendScore`(形态50+量能30+动量20+同行业共振5)取前5,宁缺毋滥(实测常 1~5 只)。chip:达标蓝✓/未达灰✗/缺数据不显示。免费源做不到的项(商誉/质押/审计/应收四项一票否决、PE·PB 5年分位、PEG、卖方预期、增持回购、板块20日涨幅与板块≥3只新高)在 ③ 注记与 foot 明示,以「52周高点回撤=错杀、当日板块涨幅+同行业入选≥2=赛道共振」为代理。stock.js 前端不再评分(旧 oppScore/renderOpp 已删,node 自检换成 valueChips/trendChips);服务端纯函数单测 `npx jest test/market.test.ts test/mx.test.ts`。⚠️ 验证截图流程:7001 常年有 prod,别 kill 它——config.default 端口已永久参数化(`Number(process.env.APP_PORT)||7001`),`APP_PORT=7301 npm run dev` 与 prod 并存截图,截完清掉自己起的进程树;prod 侧 config.production 固定 7001 不受 APP_PORT 影响。⚠️ localhost 登录报 Internal Server Error 属已知设计:prod session cookie `secure`,明文 http 写 cookie 直接 throw(仅经隧道 https + X-Forwarded-Proto 才可用);本地看页走 dev。
- **持仓页改造(2026-09,A股 v2 复盘 + 币圈 v4「持仓驾驶舱」)**:`public/holdings.html`+`holdings.js`,顶部 `.ptabs` 双 tab(币圈/股票——**2026-10-28 A股·港股复盘已并入 stock 页「股票观察 · 持仓复盘」:新公开端点 `GET /api/stock/recap`(包 `cached('stk:recap')` 走数据分层、`?fresh=1` 穿透;免登录,复盘行无数量/成本/金额),tab/`#pan-stk`/`#status`/`showTab` 已删、本页只剩币圈驾驶舱;下列 ① 版式细节随迁 stock 页、记录仅供追溯**)。币圈 v4(2026-09,照用户参考图 `biquanchicang.png` 取代 v3 安静对账单):gcard 渐变卡×5——KPI 英雄区(总资产+👁 `.money` blur 打码+现货/理财/USDT 三格占比(分母=现货+理财)+合约浮盈「另计」(列值=仅 Σ浮盈,保证金只出现在 USDT 余额列不重复展示;futNet 字段已删);**总资产口径=现货ΣeqUsd(权益值,已含合约浮盈摊入与冻结USDT保证金,勿加 futMargin、勿再另加 Σ合约浮盈——2026-09-30 用户抓包双计删除,见根 CLAUDE.md;金额默认按 OKX 快捷买币汇率折人民币,fx 来自免签公共 `/api/v5/market/exchange-rate`(USDT→CNY≈6.7),取不到自动退回美元;**KPI 卡 `#unitp` ¥/$ 胶囊用户可切换**(localStorage 记忆;持仓列表平均成本/当前价格/当前价值三列 `u()`/`px()` 恒 USDT 不折 ¥);**子账号只标注不计入**:okxLive 第四路 `okxSubBalances`=subaccount/list→account/subaccount/balances(⚠️ 参数名 `subAcct`,写错 50014;asset 版回空),crypto() 回 `sub`,前端 `#k-subacct` 用 `.subbox` 单行 chip 条(标签+每户彩点 chip+右端合计+「未计入总资产」胶囊,照 2026-09-19 用户参考图;四格 `.kc` 同步描边小卡化),页面总资产恒只含主账户**)、资产分布环图(`donutBuckets`)、总资产走势(新端点 `GET /api/holding/crypto/history?r=1d|7d|30d|1y`,服务端 `equityFromCandles`=OKX K线×当前持仓回溯**估算**(合约只加方向化浮盈、margin 不加回),有单测;前端按容器宽重画+resize 防抖)、今日收益排行、快捷外链;下接统一持仓列表(`#ltabs` 全部/现货/合约/理财 + 搜索 + 隐藏小额 + 单字母币种徽标 `coinBrand` + sparkline)。顶层纯函数 `node public/holdings.js` 自检。①A股/港股(版式未动)按用户「每日持仓复盘」模板(任务配置.md):`#mkline` 市场概况 → 总览表(含 PE/PB/区间涨跌5列(7/30/90/180/365自然日,纯函数 periodChg,2026-10-08;**含分红**:A股腾讯 qfq、港股腾讯无复权(实测 qfq/hfq 都只回原始 day)→ 走东财 push2his fqt=1+`emHkRows`,挂则显 —,见根 CLAUDE.md)/120日区/逻辑✅🔴➖,qt.service 新增解析:A股 f39/f46、港股 f51 仅PE)→ 逐只「技术面简评」行 → `#focus` 🎯四类(超跌不坏/低位估值/改善未反映/逻辑风险)→ `#digest` 📌三选。端点 `GET /api/holding/analysis` 现返回 `{rows, overview, focus, digest}`(holding.service:腾讯120日K→复用 `klineInd` + 纯函数 `rangeStats/stockVerdict/stockTag/focusOf/digestOf`;2026-09-22 起无缓存实时直连);四类是**技术面代理**(无免费逐票基本面源),页面已注记,不构成投资建议。②币圈:现货+合约(标记价/浮盈/ROE/强平/资金费率),端点 `GET /api/holding/crypto`,**双数据源**:OKX 只读 key(`~/.okx_apikey` 三行 key/secret/passphrase,chmod 600,勿进仓库/argv;页面 KPI 标「OKX 实时账户」)=账户真值,未配/失败落回手填台账 `data/crypto_holdings.json`(KPI 标「手填台账」+原因;cost=单价)。签名/映射纯函数 `okxSign/mapOkxBalance/mapOkxPositions` 有单测。价:复用已导出的 `binance24h` + OKX OKB,fapi 标记价/费率(挂→现货兜底);强平按维持保证金 0.5% 近似。配色全站统一绿涨红跌(.pos/.cup=涨=绿,.neg/.cdn=跌=红;旧「A股红涨」约定 2026-09-20 作废)。`npx jest test/holding.test.ts`。⚠️ MX key:env `MX_APIKEY` 无则回退 `~/.mx_apikey`(launchd 不继承 shell rc,价值派曾因此恒红卡);key 不进 plist/仓库/argv。
- **监控板块(2026-10-18,2026-10-19 扩 A股,详见根 CLAUDE.md 同名条)**: 登录页 `monitor.html`+`monitor.js`,各面板挂 ⟳(面板构成见条尾二改)、共用 `GET /api/monitor/status`(只走 panelFetch、永不显旧值);后端 `monitor.service.ts` 60s 采样,币圈=币安 1m/1H+OKX OKB(⚠️ 币安 interval 小写 1h;勿包 cached()),A股五只(南山铝业/森马服饰/西安旅游/朗姿股份/迈瑞医疗)=腾讯 ifzq minute query 一次拿分钟线+盘口今开高低(⚠️ 盘口时间戳非北京今日=休市,整只不判定防旧行情误报),每标三规则(窗口涨跌/日内涨跌/日内振幅,A股振幅默认关)按**状态机跃变**去重推 Lark(异动+回落各一次,持续越限不重推),配置 `data/monitor_config.json` 每轮从盘重读、状态与台账在 `runtime/`,webhook 分群只存凭据文件(env 优先):`~/.lark_webhook` 可用 `## 币圈小剧场`/`## A股大舞台` 分段(2026-10-19 用户格式,段内取第一条 http 行+sign 行,段缺失不串群),A股亦兼容独立 `~/.lark_webhook_astock`。`MONITOR_OFF=1` 关采样循环(测试用)。看板/配置/历史三块均按「币圈 | A股」两组分开放(2026-10-19 用户要求:小节头 gcap 右挂推送群 webhook 态,历史带 全部/币圈/A股 筛选胶囊,`monitor.js?v=20261019b`)。同日再把本机 4 个 launchd 定时任务(雷达晚/早、三个锦囊、持仓复盘)调度层收进 `~/claude/somejob/`(plists 真身、LaunchAgents 留符号链接;common.env/apply-schedule/任务配置/gen_dashboard/jobs.json 同迁;agent .md 与 run-*.sh 路径已改),监控页新增「定时任务」面板 `/api/jobs`(改时间/立即运行/启停,demo 只读;停用只到重启;prod/tunnel 是常驻服务不在管),详见根 CLAUDE.md「定时任务统合」条。同日 m-live 仪表盘化(阈值双向/单向规+日内位置点+状态并一列点名+越限行高亮,历史事件色、任务相对时间;纯函数 gauge/ampG/rangeCell/overallPill/ago 进自检)再**二改按市场集中**(用户「按类型集中放+做动画」):m-live/m-cfg 合成每市场一块 `#m-cry`/`#m-ast` 双栏并排(.mgrid,≤1100 堆叠),全局态独立 #m-glob,保存钮各面板一枚但收集跨 document;看板收 6 列(删最后推送/行内开关,状态 pill 并入标的列)、规基宽 88;纯 CSS 动效=心跳点 hb/规展开 gRow(lf 贴中线)/位置点 dotIn/pillPop/越限行 fireGlow 呼吸,全走 theme reduced-motion 熔断;`monitor.js?v=20261019g`,详见根 CLAUDE.md。
- **统一顶栏(nav.js,2026-09)**:7 个雷达页(hub/stock/crypto/dashboard/cashflow/holdings/monitor)+ login.html 共用 theme.css header 骨架 + `public/nav.js`(各页在自身主 js 之前引入;用户要求登录页也保留顶栏,勿删):brand 光点 + `<h1>` + 七链接 `<nav>`(总览/币圈/A股/我的财富🔒/流水🔒/持仓🔒/监控🔒)+ 各页右侧控件 + `#who`。nav.js 按 `location.pathname` 文件名给匹配链接标 `.on`(`navActive` 顶层纯函数),并渲染 `#who`(未登录 `登录` → `login.html?back=本页`;已登录 `用户名`+`退出` POST `/api/logout`)。hub.js 已删自身 renderWho,勿双实现。
- ⚠️ **新 Chrome 不提升块内 function 声明**:各页 `loadAndRender()` 定义在 `if (typeof window…)` 块内并在块内自调用,HTML 尾部不要再写 `<script>loadAndRender()</script>`(dashboard.js 是顶层定义,不受影响)。
- 自检:`node public/stock.js|crypto.js|cashflow.js|dashboard.js|hub.js`;行情解析单测 `npx jest test/qt.test.ts test/mx.test.ts`。

## 生产部署 / 公网暴露(2026-09 加固)

- 生产:`npm run build && npm start`(`NODE_ENV=production`)→ 自动加载 `src/config/config.production.ts`:只绑 `127.0.0.1:7001`、cookie `Secure+SameSite=Lax+HttpOnly`、keys 链 env `APP_KEYS` → `~/.app_keys`(chmod 600,同 ~/.mx_apikey 路数)→ 进程内随机,会话 `maxAge` 显式 24h(框架本就默认 24h,"秒退登录"真凶是旧版每次重启随机换签名密钥使旧 cookie 作废,勿再当过期时长 bug 查)、`logValue:false`、`koa.proxy:true`。
- ⚠️ **明文请求写 secure cookie 会抛错**:`@midwayjs/cookies` 对「明文连接 + `opts.secure`」直接 `throw`(实测无隧道头时 login/logout 全 500)。必须 `koa.proxy:true` + Cloudflare 回源带 `X-Forwarded-Proto: https` 才不炸;因此**本机 curl 直接访问 prod 的登录/退出会 500,属正常**——生产只应经隧道 https 使用(只绑回环 + 外人无法伪造该头)。本地开发用 `npm run dev`(default 配置,无 secure)。
- 会话 cookie key 已改名 `my_money_sid`(session.key);登出入口:`POST /api/login`、`POST /api/logout`、`GET /api/me`(**不是** `/api/auth/*`,auth 控制器前缀是 `/api`)。
- login 防爆破:`src/controller/auth.controller.ts` 模块级内存 Map,同用户名 5 分钟窗错 5 次 → 429 并提示剩余秒,登录成功清零(单进程;重启清零)。
- **公网固定域名(已上线)**:`https://www.thrr.cc` → 命名隧道 `thrr`(Cloudflare zero-trust → Networks → Tunnels;uuid `fd9123be-…`,配置 `~/.cloudflared/config.yml`)。Cloudflare 边缘 https → 回源明文 http,故回源必须带 `X-Forwarded-Proto`。DNS 另留 `money.thrr.cc` CNAME 同指向,可删。
- **开机自启(launchd)**:`~/Library/LaunchAgents/com.tianhui.my-money.{prod,tunnel}.plist`(prod 等价 `NODE_ENV=production node ./bootstrap.js`,tunnel = `cloudflared tunnel --config … run`;RunAtLoad+KeepAlive)。日志 `~/Library/Logs/my-money-*.log`(cloudflared INF 在 err 文件)。控制:`launchctl kickstart -k gui/$(id -u)/com.tianhui.my-money.prod` 重启 / `launchctl bootout gui/$(id -u)/com.tianhui.my-money.tunnel` 停。改配置后重启对应 job 即可,勿再手动 nohup(会端口/隧道冲突)。MySQL 由 launchd(`homebrew.mxcl.mysql`)管。
- ⚠️ 中国网络直连 CF 会抽风(本机曾持续 TLS reset),判断隧道挂没挂用手机 4G 或代理路径,别用本机 curl 直连。
- ⚠️ MySQL 已确认只监听 `127.0.0.1`;**只把 7001 经隧道转发,勿转发 3306**。DB 密码明文在 config.default.ts/README,仓库保持私有。

## CoinGecko 备源链 + boards 回放标注(2026-10-20 两案落地)

- 全站基线调查(57 上游×3 + 15 端点实收)锁定两条常故障链:东财 push2 `clist|kline|fflow` 路径级 502(无镜像、无免费平替)、CoinGecko 免费档 429。落盘兜底(`runtime/net-cache.json`,unittest 走独立文件)已上线;同日落地共议两案——**A** CG 降首选、失败即备源(crypto.service `exchDayRows/exchFallbackRows`:行情=币安/OKX/Bitget ticker,7d/30d/90d/1y=同所日K `periodChg` 本地算;市值无源**如实 null**、饼图自藏;全市场总市值落 CMC global-metrics 同批调用,徽标按 src 改名;前端字段结构零改动);**B** boards 回放如实标日期(`boardsOkAt`→`data.asOf`,stock.js/hub.js 纯函数 `asOfNote` >10min 显「东财限流中 · 板块截至 MM-DD HH:mm 回放」,硬失败仍 ✗)。详见根 CLAUDE.md「数据分层」条尾;自检含 node 三页 + `npx jest test/crypto|market|net`。

## 数据库

- 建表 SQL:`data/mysql.sql`(根目录旧 `mysql.sql` 已删)
- `GET /` 302 → `/public/hub.html`(首页即投资雷达)
- ⚠️ 数据库密码明文提交在 `config.default.ts` 和 README 中,改动时注意别外传

## 约定

- 注释用中文,保持现有风格
- **改 `public/*.js` 必须同步 bump 页面里 `?v=YYYYMMDDa` 版本号**:页面经 Cloudflare 隧道访问,.js 会被边缘/浏览器缓存,不改版本号用户刷新看到的还是旧脚本(2026-09-20 1y列上线后用户"没变化"即此因)。`theme.css` 同理走链接版本号(`theme.css?v=…`,7 页链接同改同 bump);`nav.js` 同理(7 页含 login,现 `?v=20260922a`——里面是全站 fetch 数据分层:SWR 秒回缓存+后台重取广播 `apifresh` 自动替换,见根 CLAUDE.md「数据分层」④)
- 金额字段全部 int(单位:元)
