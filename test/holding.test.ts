import { rangeStats, stockVerdict, futMetrics, stockTag, focusOf, digestOf, okxSign, mapOkxBalance, mapOkxPositions, mapOkxFund, mapOkxEarn, earnResidual, dropDust, equityFromCandles, periodChg, futPcTrim, pcYield, okxToPcRows, emHkRows, emDiv, demoQuotes, demoAnalysis, demoCrypto, demoHistory } from '../src/service/holding.service';

// holding.service 纯函数:技术面简评与合约浮盈/强平口径,不碰容器与网络,无需启动应用
describe('holding.service 纯函数', () => {
  it('rangeStats:现价位置与距高点回撤', () => {
    const bars = Array.from({ length: 10 }, (_, i) => ({ c: 10 + i, h: 10 + i + 0.5, v: 1 }));
    const rs = rangeStats(bars); // hi=19.5(末根高) lo=10(首根收) close=19
    expect(rs.close).toBe(19);
    expect(rs.pos).toBeCloseTo(((19 - 10) / (19.5 - 10)) * 100, 1);
    expect(rs.dd).toBeCloseTo(((19.5 - 19) / 19.5) * 100, 1);
  });

  const base = {
    ma5: 11, ma10: 10.5, ma20: 10, ma60: 9, maBull: true, aboveMa20: true,
    dif: 0.1, dea: 0.05, hist: 0.1, macdUp: true, rsi: 55, vol5_60: 1.2, chg20: 8, newHigh60: false,
  };
  it('stockVerdict:多头/弱势/超买 三分支', () => {
    const rs = { hi: 20, lo: 8, close: 11.5, pos: 62.5, dd: 42.5 };
    expect(stockVerdict(base as any, rs as any).tone).toBe('up');
    expect(stockVerdict({ ...base, maBull: false, aboveMa20: false, ma60: 12 } as any, rs as any).tone).toBe('dn');
    const hot = stockVerdict({ ...base, rsi: 80 } as any, { ...rs, dd: 1 } as any);
    expect(hot.text).toContain('超买');
    expect(hot.text).not.toContain('回撤'); // dd<35 不提
  });

  it('stockTag:多头=利好,破位+超卖/深回撤=风险,其余 ➖', () => {
    const rs = { hi: 20, lo: 8, close: 11.5, pos: 62.5, dd: 5 };
    expect(stockTag(base as any, rs as any).tag).toBe('good'); // base 多头排列+站MA20+MACD偏多
    const risk = stockTag({ ...base, maBull: false, aboveMa20: false, macdUp: false, ma60: 12, rsi: 30 } as any, { ...rs, close: 11 } as any);
    expect(risk.tag).toBe('risk');
    expect(risk.why).toContain('RSI 超卖');
    const flat = stockTag({ ...base, maBull: false, aboveMa20: false, macdUp: false, ma60: null } as any, rs as any);
    expect(flat.tag).toBe('flat');
    expect(flat.why).toBe('');
  });

  it('focusOf/digestOf:四类分桶与每日三选', () => {
    const mk = (o: any) => ({ code: o.code, name: o.code, pe: null, pb: null, tag: 'flat', tagWhy: '', ...o });
    const rows = [
      mk({ code: 'A', tech: { aboveMa20: false, ma60: 10, chg20: 10, macdUp: true }, rs: { close: 11, dd: 30, pos: 20 } }), // 超跌不坏 + 改善未反映
      mk({ code: 'B', tech: { aboveMa20: true, ma60: 5, chg20: 30, macdUp: false }, rs: { close: 6, dd: 5, pos: 80 }, tag: 'good', tagWhy: 'w' }),
      mk({ code: 'C', pe: 12, pb: null, tech: { aboveMa20: true, ma60: 5, chg20: 1, macdUp: false }, rs: { close: 6, dd: 8, pos: 25 } }), // 低位估值
      mk({ code: 'D', tech: { aboveMa20: false, ma60: 50, chg20: -20, macdUp: false }, rs: { close: 40, dd: 40, pos: 5 }, tag: 'risk', tagWhy: '破位' }),
    ];
    const f = focusOf(rows);
    expect(f.oversold.map(x => x.code)).toEqual(['A']); // A 未破 MA60(close 11 ≥ 10)
    expect(f.lowVal.map(x => x.code)).toEqual(['C']); // C 区25%≤30 PE12;A 区20 但 PE null
    expect(f.improve.map(x => x.code)).toEqual(['A']); // macdUp + 20日>5% + 区20<45
    expect(f.risk.map(x => x.code)).toEqual(['D']);
    const d = digestOf(rows, f);
    expect(d.best?.code).toBe('B'); // good 里 20 日动量最强
    expect(d.watch?.code).toBe('D');
    expect(d.wait?.code).toBe('A');
  });

  it('okxSign:与 openssl HMAC-SHA256 base64 同结果(预串=ts+method+path+body)', () => {
    expect(okxSign('SECRET_TEST', '2020-12-08T09:08:57.715Z', 'GET', '/api/v5/account/balance')).toBe(
      '+bMGGiaUfo36r85bAhhiooN/rE6ygHvkPsOTjukmlu8='
    );
  });

  it('mapOkxBalance:bal 缺失回退 availBal+frozenBal;qty/value 都 0 的币剔除', () => {
    const rows = mapOkxBalance({
      data: [{ details: [
        { ccy: 'BTC', bal: '0.5', latestPrice: '76825', eqUsd: '38412', upl: '120.5' },
        { ccy: 'ETH', availBal: '3.2', frozenBal: '0.5', latestPrice: '2474', eqUsd: '9153' }, // 实测形态:无 bal 字段;无 upl 落 0
        { ccy: 'SOL', availBal: '0.00008', frozenBal: '0', latestPrice: '100', eqUsd: '0.008' }, // 尘埃 <$1 剔除
      ] }],
    });
    expect(rows).toEqual([
      { sym: 'BTC', qty: 0.5, price: 76825, value: 38412, upl: 120.5 },
      { sym: 'ETH', qty: 3.7, price: 2474, value: 9153, upl: 0 },
    ]); // 并市值降序;upl 透传供走势扣减(eq 已含浮盈,勿双加)
  });

  it('mapOkxFund:资金账户×公开价;<$1 或未上架(无价)剔除,市值降序', () => {
    const rows = mapOkxFund({ data: [
      { ccy: 'OKSOL', availBal: '2.5', frozenBal: '0' },
      { ccy: 'CC', availBal: '285', frozenBal: '0' }, // 285×0.01=2.85 ≥1 保留
      { ccy: 'SOL', availBal: '0.0000005', frozenBal: '0' }, // 无 USDT 对 → 无价剔除
    ] }, { OKSOL: { price: 160, chgPct: 2 }, CC: { price: 0.01, chgPct: -1 } });
    expect(rows).toEqual([
      { sym: 'OKSOL', acct: 'funding', qty: 2.5, price: 160, chgPct: 2, value: 400, cost: null, rng: null },
      { sym: 'CC', acct: 'funding', qty: 285, price: 0.01, chgPct: -1, value: 2.85, cost: null, rng: null },
    ]);
  });

  it('mapOkxFund exclude:质押赚币同名 ccy 从资金账户剔除(同笔资产两视图,2026-09-24 排行双 OKSOL)', () => {
    const rows = mapOkxFund({ data: [
      { ccy: 'OKSOL', availBal: '256.27912772', frozenBal: '0' }, // 与 staking-defi/sol 同笔 → 剔
      { ccy: 'CP', availBal: '83.86802414', frozenBal: '0' },
    ] }, { OKSOL: { price: 116.8, chgPct: 0.23 }, CP: { price: 0.01388, chgPct: -0.7 } }, new Set(['OKSOL']));
    expect(rows.map(r => r.sym)).toEqual(['CP']);
  });

  it('mapOkxEarn:活期理财持仓,rate 折百分年化,earnings 按现价折 USD', () => {
    const rows = mapOkxEarn({ data: [
      { ccy: 'OKB', amt: '434.48', earnings: '0.56', rate: '0.01' },
      { ccy: 'ZZZ', amt: '0', earnings: '0' }, // 空仓剔除
    ] }, { OKB: { price: 20, chgPct: 3.5 } });
    expect(rows).toEqual([{ sym: 'OKB', qty: 434.48, price: 20, chgPct: 3.5, value: 8689.6, apy: 1, earnings: 0.56, earnUsd: 11.2 }]);
  });

  it('earnResidual:valuation earn 总额 − 已折价行 = 闪赚估算行;≤5U/无总额不进', () => {
    const rows = [{ value: 28559.89 }, { value: null }]; // OKSOL + 无价 OKUSD
    const out = earnResidual(rows, 76933.56);
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({ sym: '闪赚(估算)', qty: null, value: 48373.67, earnUsd: 48373.67 });
    expect(earnResidual(rows, 28562)).toEqual([]); // 差 2.11 ≤5 不进
    expect(earnResidual(rows, null)).toEqual([]);
    expect(earnResidual([], null)).toEqual([]);
  });

  it('dropDust:可折算价值 <1U 剔除;无价(value null)不算尘埃;合约按 mark×qty 判', () => {
    const rows = [
      { sym: 'DUST', value: 0.99 }, { sym: 'ONE', value: 1 }, { sym: 'NOPX', value: null },
      { sym: 'XPL', qty: 2, mark: 0.4 }, { sym: 'BIG', qty: 100, mark: 0.05 }, { sym: 'ERR', error: 'x' },
    ];
    expect(dropDust(rows).map(r => r.sym)).toEqual(['ONE', 'NOPX', 'BIG', 'ERR']); // 0.8<1 剔;5 留
  });

  it('equityFromCandles:共用时间轴+前向填充;首根前不计;合约只加浮盈(保证金已含在USDT,勿重复)', () => {
    // BTC 两根、ETH 晚一根(10 时刻 ETH 无价 → 只算 BTC+USDT);20 时刻 ETH 前向填充 2000
    const pts = equityFromCandles(
      [{ qty: 1, series: [[10, 100], [20, 120]] }, { qty: 2, series: [[20, 200]] }],
      50,
      [{ qty: 6, entry: 2400, dir: 'long', margin: 4900, series: [[20, 2500]] }]
    );
    expect(pts).toEqual([{ t: 10, v: 150 }, { t: 20, v: 120 + 400 + 50 + 600 }]); // 浮盈 600,margin 4900 不加回
    const sh = equityFromCandles([], 0, [{ qty: 10, entry: 100, dir: 'short', margin: 0, series: [[5, 90]] }]);
    expect(sh[0].v).toBe(100); // (100-90)×10
    expect(equityFromCandles([], 3, [])).toEqual([]); // 无K线只剩点
  });

  it('periodChg:自然日取最近收盘为基准;现价优先实时报价;历史不足回 null(2026-10-08 区间涨跌列)', () => {
    const k = (d: string, c: number) => [d, '1', String(c), '1', '1', '1']; // 腾讯日K行:[日期,开,收,高,低,量]
    const rows = [k('2024-01-02', 100), k('2024-07-01', 120), k('2024-10-02', 150), k('2024-12-24', 200), k('2024-12-31', 190)];
    expect(periodChg(rows, 210)).toEqual({ d1: 5, d7: 5, d30: 40, d90: 40, d180: 75, d365: null });
    // d7 基准 12-24(200)→210/200=+5%;d30 基准 ≤12-01 即 10-02(150);d90 target 恰 10-02;1年无 ≤2023-12-31 的行;d1 基准同为 12-24(12-30 前最近收盘)
    expect(periodChg(rows, null)).toEqual({ d1: -5, d7: -5, d30: 26.7, d90: 26.7, d180: 58.3, d365: null }); // 无实时价 → 落末根收 190(12-31 收 190 < 12-24 的 200 → d7 负) 190
    expect(periodChg([], 100)).toEqual({ d1: null, d7: null, d30: null, d90: null, d180: null, d365: null });
  });

  it('futPcTrim:合约超出持仓时长的档(含1年)显示总盈亏率=开仓ROE(App 同口径);持满档留该币涨跌;拷贝不脏化共享 pcMap(2026-10-12 用户对照 App 定稿)', () => {
    const base = { d1: 1, d7: 2, d30: 3, d90: 4, d180: 5, d365: 6 };
    const okb = { ctime: Date.now() - 10 * 864e5, roe: -37.7, dir: 'long', entry: 137, mark: 126, upnl: -998, margin: 2640 };
    expect(futPcTrim(base, null)).toBe(base); // 无开仓时间(转入仓/台账)原样
    expect(futPcTrim(base, okb)).toEqual({ d1: 1, d7: 2, d30: -37.7, d90: -37.7, d180: -37.7, d365: -37.7 });
    expect(base.d30).toBe(3); // 现货行共享对象未被改
    expect(futPcTrim(base, { ctime: Date.now() - 400 * 864e5, roe: -15.2 })).toEqual(base); // 老仓全档持满,原样
    expect(futPcTrim(base, { ctime: Date.now() - 40 * 864e5, upnl: -100, margin: 2000, dir: 'long' }).d90).toBe(-5); // 无 roe 回退 upnl/保证金
    expect(futPcTrim(base, { ctime: Date.now() - 40 * 864e5, dir: 'short', entry: 100, mark: 120 }).d90).toBe(-16.7); // 再回退价格涨幅(空头反向)
  });

  it('pcYield:非合约行该档无日K时回填该资产总收益率(现货=现价vs成本均价、理财=利息÷持仓);有行情档不动;无成本原样;合约行跳过(2026-10-12 用户选「按成本收益率填」)', () => {
    const base = { d1: 1, d7: null, d30: 3, d90: null, d180: null, d365: null };
    expect(pcYield(base, { cost: 100, price: 120 })).toEqual({ d1: 1, d7: 20, d30: 3, d90: 20, d180: 20, d365: 20, yld: 20, yldSrc: 'cost' });
    expect(base.d7).toBe(null); // 浅拷贝,共享 pcMap 不脏
    expect(pcYield(base, { earnings: 5, qty: 500 })).toEqual({ d1: 1, d7: 1, d30: 3, d90: 1, d180: 1, d365: 1, yld: 1, yldSrc: 'earn' });
    expect(pcYield(null, { cost: 1, price: 1 })).toEqual({ d1: 0, d7: 0, d30: 0, d90: 0, d180: 0, d365: 0, yld: 0, yldSrc: 'cost' }); // 稳定币全无日K,整行回填
    expect(pcYield(base, { acct: 'funding' })).toBe(base); // 资金账户无成本无利息,原样显 —
    expect(pcYield(base, { ctime: 1, roe: -5, cost: 100, price: 200 })).toBe(base); // 合约行不进这里(由 futPcTrim 管)
    const full = { d1: 1, d7: 2, d30: 3, d90: 4, d180: 5, d365: 6 };
    expect(pcYield(full, { cost: 100, price: 120 })).toBe(full); // 全档有行情,不挂 yld
  });

  it('okxToPcRows:OKX K线 [ts,o,h,l,c,vol] → periodChg 行形,收盘挪 index2、日期按北京日界(2026-10-08 币圈列表)', () => {
    const rows = okxToPcRows([['1735612800000', '1', '2', '0.5', '1.9', '9'], ['bad']]); // 1735612800000=北京 2024-12-31 00:00 开盘(OKX 1D 真实语义)→ 12-31
    expect(rows).toEqual([['2024-12-31', '1', '1.9', '2', '0.5', '9']]);
    expect(periodChg(rows, 190).d1).toBeNull(); // 只有 1 根,无更早收盘,不编数
  });

  it('emHkRows:东财港股 klines "日期,收盘" → periodChg 吃的 [date,开,收,高,低,量],坏行/0收滤掉(2026-10-08 含分红)', () => {
    const rows = emHkRows(['2024-12-24,200', '2024-12-31,190', 'bad', '2025-01-02,0']);
    expect(rows).toEqual([['2024-12-24', '0', 200, '0', '0', '0'], ['2024-12-31', '0', 190, '0', '0', '0']]);
    expect(periodChg(rows, 210).d7).toBe(5); // 与腾讯同基准可复用
    expect(emHkRows([])).toEqual([]);
  });

  it('emDiv:东财分红送配首行 → {plan,ex,yl};股息率按现价现算;无报表行/缺除息日回 null(2026-10-12 分红入表)', () => {
    // 600519 贵州茅台实测行(2025 年报分红,2026-06-26 除息)
    const mt = { PRETAX_BONUS_RMB: 280.2423, EX_DIVIDEND_DATE: '2026-06-26 00:00:00', IMPL_PLAN_PROFILE: '10派280.2423元(含税)' };
    expect(emDiv(mt, 1400)).toEqual({ plan: '10派280.2423元', full: '10派280.2423元(含税)', ex: '2026-06-26', yl: 2.0 }); // 列内短形态、全文进 title(2026-10-12 用户嫌长串不美观)
    expect(emDiv({ ...mt, IMPL_PLAN_PROFILE: '10派2.65元(含税,扣税后2.385元)' }, 4.86).plan).toBe('10派2.65元'); // 南山铝业式长串裁掉括号段
    expect(emDiv(mt, null).yl).toBeNull(); // 无现价不算率
    expect(emDiv(null, 10)).toBeNull(); // 港股/ETF 报表回空
    expect(emDiv({ PRETAX_BONUS_RMB: null, EX_DIVIDEND_DATE: '2026-06-26 00:00:00' }, 10)).toBeNull(); // 纯送股无派现
    expect(emDiv({ PRETAX_BONUS_RMB: 5 }, 10)).toBeNull(); // 缺除息日不算
  });

  it('mapOkxPositions:负 pos=空,数量=名义U/标记价,upl/roe/liq 用 OKX 原值', () => {
    const rows = mapOkxPositions({ data: [
      { instType: 'SWAP', instId: 'ETH-USDT-SWAP', pos: '6', posSide: null, avgPx: '2400', markPx: '2457', notionalUsd: '14742', upl: '342', uplRatio: '0.57', lever: '3', liqPx: '1650' },
      { instType: 'SWAP', instId: 'BNB-USDT-SWAP', pos: '0', upl: '0' }, // 已平,过滤
      { instType: 'FUTURES', instId: 'BTC-USDT-250926', pos: '1' }, // 非 SWAP,过滤
    ] });
    expect(rows.length).toBe(1);
    const e = rows[0];
    expect(e.dir).toBe('long');
    expect(e.qty).toBeCloseTo(14742 / 2457, 4);
    expect(e.upnl).toBe(342);
    expect(e.roe).toBeCloseTo(57, 1);
    expect(e.margin).toBeCloseTo(14742 / 3, 0);
    expect(e.liq).toBe(1650);
  });

  it('futMetrics:多头浮盈/ROE/强平近似;缺价不算但不崩', () => {
    const m = futMetrics({ dir: 'long', entry: 4000, qty: 6, lev: 3 }, 4400);
    expect(m.upnl).toBe(2400); // (4400-4000)*6
    expect(m.margin).toBe(8000); // 4000*6/3
    expect(m.roe).toBeCloseTo(30, 1);
    expect(m.liq).toBeCloseTo(4000 * (1 - 1 / 3 + 0.005), 1);
    const s = futMetrics({ dir: 'short', entry: 100, qty: 10, lev: 5 }, 90);
    expect(s.upnl).toBe(100);
    expect(futMetrics({ dir: 'long', entry: 1, qty: 1, lev: 0 }, null).upnl).toBeNull();
    expect(futMetrics({ dir: 'long', entry: 100, qty: 1, lev: 0 }, 120).liq).toBeNull(); // 无杠杆不算强平
  });
});

// 演示账号(非 tianhui)持仓假数据:写死底数×抖动、零上游(2026-09-22,取代旧 demoSwr×上游路数)
describe('demo 持仓假数据', () => {
  it('demoQuotes:5 只、价抖 ±1% 内、时间戳 12 位', () => {
    const q = demoQuotes();
    expect(q.length).toBe(5);
    expect(q[0].price).toBeGreaterThan(1486.5 * 0.98);
    expect(q[0].price).toBeLessThan(1486.5 * 1.02);
    expect(String(q[0].time)).toMatch(/^\d{12}$/);
    expect(q.every(r => r.ok && r.price > 0 && isFinite(r.chg))).toBe(true);
  });
  it('demoAnalysis:verdict/focus/digest 全走真函数,底数故事抖不翻', () => {
    const a = demoAnalysis();
    expect(a.rows.length).toBe(5);
    expect(a.rows.every(r => r.verdict && r.verdict.text && r.tag)).toBe(true);
    expect(a.overview.idx.length).toBe(3);
    expect(a.overview.up).toBe(3);
    expect(a.overview.down).toBe(2);
    expect(a.focus.risk.map(x => x.code)).toContain('03690'); // 美团:跌破 MA60 + 超卖
    expect(a.focus.oversold.map(x => x.code)).toContain('601318'); // 平安:深回撤未破 MA60
    expect(a.digest.best?.code).toBe('300750');
    expect(a.digest.watch?.code).toBe('03690');
  });
  it('demoCrypto:source=demo、合计与行一致、稳定币不抖、多头浮盈为正', () => {
    const c = demoCrypto();
    expect(c.source).toBe('demo');
    expect(c.totals.spotUsd).toBeCloseTo(c.spot.reduce((a: number, r: any) => a + r.value, 0), 1);
    expect(c.spot.find((r: any) => r.sym === 'USDT').price).toBe(1);
    expect(c.fut[0].upnl).toBeGreaterThan(0); // BTC 多 60200 开,市价 ~64850
    expect(c.fx).toBeGreaterThan(6.7);
  });
  it('demoHistory:点数随 r、未知档回 1d、spark 覆盖全部币', () => {
    expect(demoHistory('1d').points.length).toBe(25);
    expect(demoHistory('1y').points.length).toBe(54);
    expect(demoHistory('xx').bar).toBe('1H');
    const h = demoHistory('1d');
    expect(Object.keys(h.spark).length).toBe(9); // 现货 7 + 资金 2
    expect(h.spark.BTC.length).toBe(25);
  });
});
