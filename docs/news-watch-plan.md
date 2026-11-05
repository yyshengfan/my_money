# 新闻监控 v1 · 设计 & 落地需求(给实现方 CC)

> 目标:盯「特朗普/马斯克说了什么、美国选举、非农、中国开会、窗口指导」这类**重要新闻**,
> 1 分钟扫一次,命中就推 Lark,面板挂在现有「监控」页上。
> v1 只做「重要新闻」,不做摘要、不做翻译、不做情绪分析。

## 0. 一句话方案

复用现有 `monitor.service.ts` 的 60 秒 `tick()` 循环,在同一轮里拉 4 个免费快讯源 →
纯函数做 **关键词分级 → 跨源去重 → 限流** → 只把「高重要度」的推到 **A股大舞台** 群,
监控页在 ETF 面板下方新增一个「要闻雷达」面板展示命中记录与配置。

## 1. 信息源(2026-11-05 本机免费直连实测全部可用,无需 key)

| 源 | URL | 结构 | 时区 | 备注 |
|---|---|---|---|---|
| 新浪财经 7×24 | `https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=100&zhibo_id=152&tag_id=0&dire=f&dpc=1` | `result.data.feed.list[]`,字段 `id` / `create_time` / `rich_text`(HTML) / `docurl` | 北京 | 量最大;ETF/个股营销稿多,必须靠关键词挡 |
| 金十快讯 | `https://www.jin10.com/flash_newest.js` | 文件形如 `var newest = [...]`;每项 `{id, time, type, data:{title, content}}` | 北京 | ⚠️ **同一事件中英双语各一条**,过滤掉「正文无汉字」的行;content 可能含 HTML |
| 华尔街见闻快讯 | `https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=100` | `data.items[]`,字段 `id` / `display_time`(unix 秒) / `title`(常为空) / `content_text` / `uri` | unix 秒 | title 为空时取 `content_text` 前 60 字当标题 |
| 东财 7×24 全球 | `https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=100&req_trace=1` | `data.fastNewsList[]`,字段 `code` / `showTime` / `title` / `summary` | 北京 | 无稳定原文链接,`url` 留空 |

实测样本(100 条/源):4 源共 327 条中文,6 小时窗口内命中核心关键词 39 条(≈6.5 条/小时),
其中约一半是「泰国央行行长」「日本国债拍卖」「速卖通双11」这类噪声 → **规则必须分层 + 限流**。

已排雷,勿再试:财联社 `cls.cn/nodeapi/telegraphList` 直连 404(需签名);中文快讯源 jinse/blockbeats/panews 本网络不通;
X/Twitter 官方 API 收费,川普/马斯克的言论**靠上述中文快讯转述**,不直连 X。

### 抓取实现约束

- 用 `src/util/net.ts` 的 `getJson` / `getBuffer`(自动代理感知)。**绝不能包 `cached()`**——`effTtl` 会把 60s 抬到 5min(与现有采样同一坑)。
- 4 源 `Promise.all` + 每源独立 try/catch:单源挂只少该源,不影响其他源与本轮其他监控。
- 超时沿用默认 8s。全轮挂掉只记日志,循环永不退出。
- 中文用 UTF-8 解码;`rich_text` / `content_text` 先剥标签 (`replace(/<[^>]+>/g,'')`) 再判关键词。
- 时间串按 `+08:00` 解析(如 `2026-11-05 11:55:58` → `Date.parse('2026-11-05T11:55:58+08:00')`)。

## 2. 重要度规则(v1 只推 H 级)

### 2.1 标签与关键词(顺序即优先级,取第一个命中的 tag;用于冷却)

| tag | 中文名 | 关键词(正则,不区分大小写) |
|---|---|---|
| `trump` | 特朗普 | `特朗普|川普|白宫|梅拉尼娅|万斯` |
| `musk` | 马斯克 | `马斯克|特斯拉|SpaceX|星链|Starlink|xAI|Optimus` |
| `election` | 美国选举 | `中期选举|美国大选|选举人|国会选举|参议院|众议院|弹劾` |
| `fed` | 美联储/数据 | `美联储|FOMC|鲍威尔|非农|就业报告|失业率|CPI|PPI|PCE|GDP|零售销售|初请` |
| `cnpol` | 中国会议 | `政治局|国常会|国务院常务会议|中央经济工作会议|两会|政府工作报告|中共中央|总书记|国新办` |
| `cnreg` | 中国监管/央行 | `中国人民银行|中国央行|人民银行|降准|降息|LPR|MLF|逆回购|公开市场操作|证监会|金融监管总局|发改委|财政部|窗口指导|监管约谈|汇金|平准基金|国务院印发` |
| `geo` | 地缘 | `俄乌|俄罗斯|乌克兰|伊朗|以色列|中东|停火|战争|袭击|制裁|出口管制|实体清单|关税` |
| `other` | 其他要闻 | 兜底匹配不到时**不推**(v1 不推 other) |

⚠️ 关键词只匹配**标题**(无标题则取正文前 60 字),避免正文里顺带提到「关税」的营销稿混进来。

### 2.2 排除词(优先于关键词,命中直接丢)

```
/广告|推广|扫码|开户|直播预告|招聘|课程|优惠|限时|抽奖|速卖通|双11|双十一|618|大促|涨停|跌停|ETF|基金|盘中|午评|收评|早评|盘前|收盘快照/
```

> ETF/基金/涨跌停这类排除是有意的:A股盘面噪声已被监控页其他面板覆盖。
> 但**「汇金/平准基金/国家队买入ETF」属于 cnreg,应该推** → 排除规则实现为:
> 命中排除词 **且** 不命中 `cnpol|cnreg|trump|musk|election|fed` 的关键词时才丢弃。
> 简化实现:先算 tag,再 `if (EXCLUDE.test(text) && !['cnpol','cnreg','trump','musk','election','fed'].includes(tag)) drop`。

### 2.3 分级

- v1 只有两级:`H`(命中任一 tag 且过了排除)/ 其余 = 不推送。
- `geo` 与 `other` 默认也算 H(v1 先都推,量由下面的限流压住)。

## 3. 去重与限流(防刷屏,用户 2026-11-03 已明确讨厌重复推送)

按顺序三道闸:

1. **ID 台账**:`<src>:<id>` 见过就不再处理;台账保留 3 天。
2. **跨源近义去重**:同一事件 4 家改写 → 复用现有 `src/util/news.ts` 的 `dedupeNews()`
   (按时间倒序传入,保留最新一条;阈值已调好,单测在 `test/news.test.ts`)。
   v1 只在本轮合并后的列表内去重,不做跨轮比对(跨轮由 ID 台账 + tag 冷却兜住)。
3. **限流**(状态落 `runtime/news_seen.json`):
   - 同 tag 冷却 `tagCool` 分钟(默认 **15**):`trump` 15 分钟内最多一条;
   - 全局限额 `hourCap` 条/小时(默认 **20**),超了就丢(不排队、不延迟补发);
   - 高优先级不吃低优先级的额度:v1 不做优先级抢占,按时间顺序,到上限即止。

## 4. 推送

- 目标群:**A股大舞台**(`larkCreds('astock')`,即 `~/.lark_webhook` 的 `## A股大舞台` 段)。
  v1 不新增群;若以后想单独分流,在 `~/.lark_webhook` 加 `## 要闻` 段并在 `larkCreds('news')` 里读它——**不在 v1 范围**。
- 复用 `monitor.service.ts` 里现成的 `larkPush()`(已含签名/超时/错误串);为避免循环依赖,
  `newswatch.service.ts` 用**注入的 push 回调**,不 import `monitor.service`。
- 文案模板(纯函数 `newsText(item)`):

```
【要闻·特朗普】11-05 10:41
中期选举失利后首度露面,特朗普再提中国人民大会堂:"令人惊叹"
白宫官方账号当地时间11月4日发布…(摘要,最多 80 字)
via 新浪财经7×24
```

标题超 100 字截断;无摘要只发标题;`url` 有则附在最后一行(没有就不写)。

## 5. 数据与文件

| 文件 | 内容 | 保留 |
|---|---|---|
| `runtime/news_seen.json` | `{ids:{'sina:51953':ts,...}, tags:{trump:ts,...}, hour:[ts...]}` | ids 3 天、hour 1 小时 |
| `runtime/news_alerts.json` | `[{ts, tag, title, summary, url, src, sendOk, err}]` | 最近 200 条 |
| `data/monitor_config.json` | 在现有 `MonitorCfg` 里加 `news:{on,hourCap,tagCool,dryRun}` | — |

**不复用** `runtime/monitor_alerts.json`:那张表被推送历史面板按 `mkt` 渲染,混进新闻会破坏版式。

默认值:`{ on: true, hourCap: 20, tagCool: 15, dryRun: false }`。
`dryRun:true` = 照常扫描/记账/去重,但**不发 Lark**(先跑一天看命中率再开)。

## 6. 服务端改动清单

### 6.1 新文件 `src/service/newswatch.service.ts`

纯函数(全部导出,可单测,无网络):

```ts
export interface NewsItem { src: 'sina'|'jin10'|'wscn'|'em'; id: string; ts: number; title: string; summary: string; url?: string }
export const NEWS_SRC: { id: NewsItem['src']; name: string; url: string }[];  // 上表 4 条
export function parseSina(j: any): NewsItem[];
export function parseJin10(text: string): NewsItem[];   // 剥 `var newest = ` / 尾部 `;`
export function parseWscn(j: any): NewsItem[];
export function parseEm(j: any): NewsItem[];
export function stripHtml(s: string): string;
export function newsTag(text: string): 'trump'|'musk'|'election'|'fed'|'cnpol'|'cnreg'|'geo'|'';
export function isNoise(text: string, tag: string): boolean;
export function newsText(it: NewsItem, tag: string): string;
export function rateGate(state: NewsState, tag: string, nowMs: number, cfg: NewsCfg): boolean;
export function pruneState(state: NewsState, nowMs: number): NewsState;
```

带副作用的:

```ts
export async function newsTick(nowMs: number, cfg: MonitorCfg, push: (text: string) => Promise<{ok:boolean;err?:string}>): Promise<void>;
export function newsStatus(cfg: MonitorCfg): {
  cfg: NewsCfg; lastRunTs: number;
  sources: { id: string; name: string; ok: boolean; err: string; ts: number }[];
  items: Array<{ ts:number; tag:string; title:string; src:string; sendOk:boolean; err:string }>; // 最近 8 条
  todayCount: number; seenCount: number;
};
```

`newsTick` 流程:拉 4 源 → parse → 过滤(无标题、无中文、超 48h 旧闻)→ 按 ts 降序 → `dedupeNews`
→ 逐条过 ID 台账 / tag / 噪声 / `rateGate` → 推送(或 dryRun 只记账)→ 落盘状态与台账。
全程 try/catch,任何异常都不能抛到 `tick()` 外面。

### 6.2 改 `src/service/monitor.service.ts`

- `MonitorCfg` 加 `news: NewsCfg`;`readCfg()` 缺字段回默认(兼容旧配置文件,无需迁移)。
- `tick()` 末尾追加:

```ts
try { await newsTick(nowMs, cfg, text => larkPush(text, nowMs, 'astock')); } catch { /* 新闻轮失败不影响行情轮 */ }
```

- `status()` 返回值加 `news: newsStatus(cfg)`。
- **不要**把新闻塞进 `evalTransitions` / `monitor_state.json`。

### 6.3 改 `src/dto/monitor.dto.ts`

加可选 `news` 对象:`on: boolean`、`hourCap: number(1~200)`、`tagCool: number(1~240)`、`dryRun: boolean`。
旧前端不带该字段时不得校验失败。

### 6.4 接口(不新增路径)

- `GET /api/monitor/status` → 多一个 `data.news`
- `POST /api/monitor/save` → body 可带 `news`
- `POST /api/monitor/test` → body `{mkt:'news'}` 时发一条样例(text 标「【要闻自检】」)到 A股群

## 7. 页面改动 `public/monitor.html` + `public/monitor.js`

在 `#m-etf` 与 `#m-glob` 之间插入全宽面板 `#m-news`:

```
eyebrow: News Radar
h2: 要闻雷达 · 特朗普 / 马斯克 / 选举 / 非农 / 中国政策
```

内容三块:

1. **状态条**:`最近扫描 HH:mm:ss · 今日推送 N 条 · 已见 M 条 · 源状态 新浪✓ 金十✓ 见闻✗ 东财✓`(✗ 悬停显示 err)。
2. **最近推送表**(最多 8 行,时间新→旧):`时间 | 标签 | 标题(可点 url,新窗口) | 来源 | 发送结果`(✓/✗)。
3. **参数行**:`[x] 启用` `每小时上限 [20]` `同标签冷却(分) [15]` `[ ] 试运行(只记录不推送)` + 「保存」+「测试发送」。
   - 输入框沿用 `data-k="news.on|hourCap|tagCool|dryRun"`,保存复用现有跨 document 收集 + `POST /save`。
   - 测试发送复用 `POST /api/monitor/test {mkt:'news'}`。

实现要点:

- 新渲染函数 `renderNews(N)` 挂进 `renderAll()`;`window.panelRef['m-news'] = () => panelFetch('/api/monitor/status').then(s => { if(s?.data) renderNews(s.data.news); })`(与现有面板一致,只走实时不显旧值)。
- 新增纯函数 `newsRow(it)`、`newsSrcStrip(sources)` 并加进 `node public/monitor.js` 自检(断言含 `data-k="news.hourCap"`、源状态 ✓/✗、标题截断)。
- 页面私有 CSS 复用 `.gcap/.tscroll` 语系,不引新色。
- **改完必须 bump `monitor.html` 里 `monitor.js?v=YYYYMMDDx`**(Cloudflare 边缘缓存)。

## 8. 测试与验收

1. `npx jest test/newswatch.test.ts`(新增,全部用上面 4 个源的真实片段做 fixture,不联网):
   - 4 个 parser 各出正确条数/字段/时区(北京串 +08:00、wscn unix 秒);
   - 金十中英双语只留中文;
   - `stripHtml` 去标签;
   - `newsTag` 优先级:同句含「特朗普」+「关税」→ `trump`;「中国人民银行降准」→ `cnreg`;「泰国央行行长」→ 空(不匹配);
   - `isNoise`:「创业板算力ETF大涨」丢弃;「汇金买入ETF」保留;
   - `rateGate`:15 分钟内同 tag 第二次 false;超 20 条/小时 false;跨 tag 互不影响;
   - `pruneState` 清 3 天前的 id 与 1 小时前的 hour 记录;
   - `newsText` 截断与无摘要分支。
2. `node public/monitor.js` 自检通过。
3. `npx jest test/monitor.test.ts` 27 条不得回归。
4. 手工验收:`POST /test {mkt:'news'}` 群里收到样例;把 `tagCool` 调到 1 分钟、`dryRun:false`,
   等 10 分钟看推送量;不满意就开 `dryRun` 调关键词表再上线。
5. `npm run build` + 重启 prod(`launchctl kickstart -k gui/$(id -u)/com.tianhui.my-money.prod`),
   ⚠️ 只在重启后生效。

## 9. 更新 CLAUDE.md

在「Monitor 监控板块」条下补一段 `**新闻监控 v1 (2026-11-xx)**`:4 个源与实测结论、关键词分层表、
三道闸(ids / dedupeNews / tag+hour)、`runtime/news_seen.json` 与独立台账、挂 `tick()` 60s、
推送进 A股群、`dryRun` 调参开关、页面板 `#m-news` 与 `data-k="news.*"`。

## 10. 明确不做(v2 再说)

- AI 摘要 / 情绪判断 / 影响板块推断(要调 LLM,成本和延迟都不划算);
- X/Twitter 直连、外媒原文源(免费不可行);
- 中文快讯源 jinse/blockbeats/panews(本网络不通);
- 个股公告、ETF 营销稿、盘面复盘;
- 用户自定义关键词的页面编辑器(v1 改代码常量;真需要再抽 `data/news_rules.json`);
- 新闻历史检索/分页(只留最近 8 条展示 + 200 条台账)。

## 11. 工作量与顺序

1. `newswatch.service.ts` + 单测(半天)
2. 接 `tick()` / `status()` / DTO(1 小时)
3. 页面面板 + 自检 + bump(1~2 小时)
4. build + 重启 + `dryRun` 观察一天,再调关键词表

> 估约 350 行服务端 + 80 行前端 + 200 行测试。不要引入新依赖:解析用 `JSON.parse`/正则,HTTP 用现有 `getJson`/`getBuffer`。
