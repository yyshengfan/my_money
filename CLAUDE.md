# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Personal money-tracking API: Midway.js v3 (Koa) + TypeORM + MySQL. Chinese-language comments are common; keep them.

## Commands

```bash
npm run dev        # watch-mode dev server at http://localhost:7001 (NODE_ENV=local)
npm run build      # mwtsc compile to dist/
npm test           # jest with NODE_ENV=unittest — boots the real app, needs local MySQL running
npm test -- test/controller/home.test.ts          # single test file
npx jest -t "should GET /"                        # single test by name
npm run lint       # mwts check (lint:fix to autofix)
```

Production: `npm start` runs `bootstrap.js`.

## Architecture

Request flow: `src/controller/*.ts` → `src/service/*.ts` → TypeORM repository.

- **Datasource**: single TypeORM datasource named `datasource1`, configured in `src/config/config.default.ts` (host 127.0.0.1, db `tianhuiaccount`). `synchronize: false` — schema changes go through `data/mysql.sql`, not the ORM.
- **Entity registration is manual**: entities live in `src/entity/entities/` but only those imported AND listed in the `entities` array of `config.default.ts` are usable. A new entity must be added there, then injected in a service with `@InjectEntityModel(MyEntity, 'datasource1')` — the `'datasource1'` second arg is required.
- **Entities are generated**, not hand-written: `typeorm-model-generator` (full commands in README.md under "生成entity"). Regenerating overwrites the files, so don't add custom logic to entity classes. Currently 4 registered (Money, MoneyFinance, Users, Holding); the many other generated entities (Ceshi, Marry, MobileCode, ...) stay unregistered/unused.
- **Validation**: request bodies use DTOs in `src/dto/` with `@Rule(RuleType...)` from `@midwayjs/validate`; controllers take params via `@Body(ALL)`.
- **Core flow**: `POST /money/create` → `MoneyService.createNew(MoneyDTO)` — reads the latest `Money` and `MoneyFinance` rows, computes per-account increases (diff vs previous snapshot) and totals, then inserts new `Money` + `MoneyFinance` rows. `moment` is used for date strings.
- **Shared theme**: `public/theme.css` — design tokens + canvas (`body{max-width:1440px}`) + header/panel/pill specs used by both pages; each HTML keeps only page-private CSS inline. Change a token here, not in the pages.
- **Dashboard**: `public/dashboard.html` + `public/dashboard.js` (plain JS, ECharts via jsdelivr, no build step) served by `@midwayjs/static-file` at `http://localhost:7001/public/dashboard.html`. Dark "wealth cockpit" layout: hero total / allocation donut / trend + movers ranking / period delta (optional per-category stack) / cashflow / category detail. Fetches `GET /money/list` and aggregates client-side; global time window (`rangeRows`, default 12 months) + granularity pills — also via `?r=12&g=month`. `trimLeading` cuts leading all-null finance groups. `public/dashboard.js` doubles as a self-test: `node public/dashboard.js`. Finance increments mix transfers with P&L — don't design "net invested vs cumulative return" splits from this schema. Deposits (`periodical`, 收支表, entity comment 零钱) are folded in: hero 总资产 = 理财总额 + 期末 periodical; donut has a 6th 存款 slice (neutral #cbd5e1); trend/delta totals add `periodicalIncrease` per period; "现金余额" KPI card shows 期末存款; movers ranking, category-detail lines/chips (`ASSET_CATS`) also include 存款; 理财入行以来 stays finance-only (no P&L concept for deposits).
- **Cashflow page**: `public/cashflow.html` + `public/cashflow.js` (same dark tokens, cross-linked with dashboard) at `http://localhost:7001/public/cashflow.html`. Per-month view (‹ › nav, `?m=2026-08` deep link): 4 KPI cards (期末余额/总进账/显性支出/净结余 + 较上月) / expense breakdown bars / 12-month trend ending at selected month / ledger table with `comment`. "显性支出" = credit + rent + mortgage + socialSecurity + other only — never `outmoneyCons/Net/Life` (they mix finance P&L). Expense MoM arrow is neutral-colored (down ≠ bad). `node public/cashflow.js` self-test.
- Components are wired in `src/configuration.ts` (typeorm, koa, validate, session, static-file; `@midwayjs/info` only in local env; `[ReportMiddleware, AuthMiddleware]` registered in `onReady`).

## Four sections (v1, 2026-09)

- **Hub homepage `public/hub.html` + `public/hub.js`** is a public cross-market "投资雷达" (not just a portal): header links to A股/币圈/**login-required** dashboard·cashflow·holdings; hero MARKET PULSE (sentence mood + two conic-gradient gauges), A股 quote column (上证/深证成指/创业板指, 红涨绿跌 `.rna/.gna`) + 币圈 column (BTC/ETH/SOL, 绿涨红跌 `.cup/.cdn`), TODAY'S SIGNALS (≤5 derived facts), A股机会 (score chip from stock.js's `oppScore`, no indPct so no 板块强势 tag) + 币圈动量 (24h movers). Consumes only existing public endpoints: `/api/stock/market`, `/api/stock/opportunity`, `/api/crypto/overview` (login chip `/api/me` is rendered by shared `nav.js`, not hub.js). Pure helpers top-level (node `public/hub.js` selftest): `aTemp` (copies stock.js 温度:指数40/涨跌家数40/涨停跌停20)、`fngLabel/fngColor` (copies crypto.js)、`oppScore` (copied)、`pulseTone`/`heatColor`. A股与币圈各按本市场颜色习惯着色。Sign helpers: `sp()` only adds `+` — negatives come from `.toFixed()`, else you get `--1%`.

- **Auth**: `@midwayjs/session` cookie session; `AuthMiddleware` guards only data APIs matching `/^\/(money|api\/holding)(\/|$)/` → 401 JSON. Static HTML is not server-gated; page JS redirects on 401 to `login.html?back=<page>`. Passwords are node:crypto scrypt, stored `salt:hex` in `users` (seed via `scripts/seed_v1.js`; hash with `require('./dist/service/auth.service').hashPassword(pw)`).
- **Free sources only in v1**: A股/持仓 quotes via Tencent `qt.gtimg.cn` (GBK, 60s server cache, `src/service/qt.service.ts`); crypto via Binance spot (vision mirror → `api.binance.com` fallback) / alternative.me / CoinGecko / fapi / OKX / Bybit (`src/service/crypto.service.ts`, 30s cache, per-source `{ok,data}|{ok:false,error}` — never a white screen). `overview` also carries `fut.binance` — BTC/ETH fapi 资金费率/持仓额/多空比 (hub 币圈 strip badges; 缺数据 '—'). **妙想 MX 兜底**: env `MX_APIKEY` (NEVER commit/print), `src/service/mx.service.ts` `@Provide` `screen()/news()` (60s cooldown + cache, 只解析不改上游). When 东财 fails, `/api/stock/opportunity` and `/api/stock/news` return `data:{em, mx}` and front ends (stock.js, hub.js) pick whichever is ok, prepending a "东财不可用,当前为妙想 MX 兜底" note. 行情解析纯函数单测在 `test/mx.test.ts`. Feishu push deferred.
- **Crypto page three extra panels (2026-09)**: `public/crypto.html` ①相关新闻&宏观(Cointelegraph RSS `/api/crypto/news`,标题服务端译简体,右侧「宏观清单」复用 overview/ETF 已取数据,不新增上游) ②链上数据(DefiLlama 稳定币总供给+24h/7d 增减 + mempool.space BTC 实时手续费档,`/api/crypto/chain`) ③风险监控(纯前端 `riskAssess()`,吃费率极值/24h波幅/FNG极值/链上拥堵四条规则判红黄绿)。**中文快讯源(jinse/blockbeats/panews)在本网络直连与代理均不通,勿再试**;美股/美元指数/黄金(Yahoo/stooq)也被限流或404,宏观只能给币圈自身资金读数。**非中文标题翻译双引擎** `zhTitle()`:Google gtx 优先,遇 429 冷却 2 分钟(模块级 `gtxDownUntil`)落到免 key 的 MyMemory(偶发保留部分英文),全失败不缓存下轮再试;`crypto.js` 自检含 `riskAssess` 用例。
- **Overseas fetches need the system proxy**: `src/util/net.ts` `ensureProxyEnv()` reads `scutil --proxy` and sets HTTPS_PROXY/HTTP_PROXY with `NO_PROXY=gtimg.cn,127.0.0.1,localhost`. Probe result isn't cached forever: when no proxy is found it re-probes every 60s (so starting the dev server before turning on the proxy self-heals; single-shot caching caused all overseas sources to time out until restart). Domestic qt stays direct.
- **Public JS pages self-call**: define `loadAndRender()` inside the `if (typeof window !== 'undefined')` block and call it there — new Chrome does not hoist block-level function declarations to global, so an inline `<script>loadAndRender()</script>` in the HTML throws.
- **Unified top bar**: all 6 radar pages (hub/stock/crypto/dashboard/cashflow/holdings) share one header in `theme.css` + `public/nav.js` (loaded before each page's own JS): brand dot + `<h1>` + 6-link `<nav>` (总览/A股/币圈/我的财富🔒/流水🔒/持仓🔒) + page-specific right controls + `#who` login chip. nav.js marks active `.on` by `location.pathname` filename (pure fn `navActive`), renders `#who` from `/api/me` (`登录` → `login.html?back=<page>`, or 用户名 + POST `/api/logout` 退出). `GET /` 302 → `/public/hub.html`.
- Login tables (`users`, `holding` with 11 seeded stocks) are created by `node scripts/seed_v1.js` (idempotent; reads DB creds from config, executes the "四板块 v1" segment of `data/mysql.sql`).

## Gotchas

- `npm test` and `npm run dev` both connect to the real MySQL in `config.default.ts` (`config.unittest.ts` only nulls the port) — tests will fail to boot the app without a local MySQL containing the `tianhuiaccount` schema.
- DB credentials are committed in `src/config/config.default.ts` and README; treat edits there carefully.
