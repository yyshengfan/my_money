import { rangeStats, stockVerdict, futMetrics, stockTag, focusOf, digestOf, okxSign, mapOkxBalance, mapOkxPositions, mapOkxFund, mapOkxEarn, earnResidual, dropDust, equityFromCandles } from '../src/service/holding.service';

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
        { ccy: 'BTC', bal: '0.5', latestPrice: '76825', eqUsd: '38412' },
        { ccy: 'ETH', availBal: '3.2', frozenBal: '0.5', latestPrice: '2474', eqUsd: '9153' }, // 实测形态:无 bal 字段
        { ccy: 'SOL', availBal: '0.00008', frozenBal: '0', latestPrice: '100', eqUsd: '0.008' }, // 尘埃 <$1 剔除
      ] }],
    });
    expect(rows).toEqual([
      { sym: 'BTC', qty: 0.5, price: 76825, value: 38412 },
      { sym: 'ETH', qty: 3.7, price: 2474, value: 9153 },
    ]); // 并市值降序
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
