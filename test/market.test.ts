import { stripJsonp, num, parseBreadth, emBoardRow, emStockRow, emPoolRow, parseFlowMin, parseFlowDay, parseTrendMin, cumAmt, mergeFlow, mergeDays, applyFlowStore, applyFlowHours, northRows, parseTencentKline, klineInd, rsi14, trendScore, fundPeriods, fundNavLatest, fundQtCode } from '../src/service/market.service';

// market.service 的纯解析/规整逻辑,不碰 Midway 容器与网络,单测无需启动应用
describe('market.service 纯函数', () => {
  it('stripJsonp 解开 cb({...});', () => {
    expect(stripJsonp('cb({"rc":0});')).toBe('{"rc":0}');
    expect(stripJsonp('cb({"a":1})')).toBe('{"a":1}');
    expect(stripJsonp('jQuery3512_cb({"a":1})')).toBe('{"a":1}');
    expect(stripJsonp('   {"a":1}   ').trim()).toBe('{"a":1}'); // 已是纯 JSON 原样
  });

  it('num 拒绝占位符,永不吐 NaN', () => {
    expect(num('12.5')).toBe(12.5);
    expect(num('-')).toBeNull();
    expect(num('')).toBeNull();
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num('abc')).toBeNull();
    expect(Number.isFinite(num('-'))).toBe(false); // null 而非 NaN
  });

  it('parseBreadth 汇总沪深涨跌平与上涨占比', () => {
    const j = {
      data: {
        diff: [
          { f12: '000001', f104: 1287, f105: 982, f106: 86 },
          { f12: '399001', f104: 1785, f105: 1046, f106: 98 },
        ],
      },
    };
    const b = parseBreadth(j);
    expect(b.sh).toEqual({ up: 1287, down: 982, flat: 86 });
    expect(b.sz.up).toBe(1785);
    expect(b.up).toBe(1287 + 1785);
    expect(b.down).toBe(982 + 1046);
    expect(b.flat).toBe(86 + 98);
    expect(b.ratio).toBeCloseTo((1287 + 1785) / (1287 + 1785 + 982 + 1046), 6);
    // 缺某市场不炸:ratio 用已有数
    const b2 = parseBreadth({ data: { diff: [{ f12: '000001', f104: 10, f105: 10, f106: 0 }] } });
    expect(b2.sz.up).toBeNull();
    expect(b2.up).toBe(10);
  });

  it('emBoardRow 规整板块行(含 2026-09-20 加的领涨股字段)', () => {
    const r = emBoardRow({ f12: 'BK1340', f14: '印制电路板', f3: 7.6, f62: 13370972672.0, f184: 13.62, f128: '生益电子', f136: 12.5 });
    expect(r).toEqual({ code: 'BK1340', name: '印制电路板', pct: 7.6, mainNet: 13370972672, mainPct: 13.62, leadUp: '生益电子', leadPct: 12.5 });
    const r2 = emBoardRow({ f12: 'BK1340', f14: '印制电路板', f3: 7.6, f62: 1, f184: 2 });
    expect(r2).toMatchObject({ leadUp: null, leadPct: null });
  });

  it('emStockRow 规整全A个股行(量比占位符 "-" 落 null)', () => {
    const r = emStockRow({
      f2: 83.45, f3: 33.2, f6: 1537346026, f8: 70.32, f9: 30.77, f10: '-',
      f12: '603448', f14: 'N天博', f20: 10014000000, f23: 2.71, f62: 388707340, f100: '汽车零部件',
    });
    expect(r.price).toBe(83.45);
    expect(r.pct).toBe(33.2);
    expect(r.volRatio).toBeNull(); // 上市首日量比 "-"
    expect(r.pe).toBe(30.77);
    expect(r.ind).toBe('汽车零部件');
  });

  it('emPoolRow 规整涨停池行(price×1000 → 不换算,直接给源值;连板与主力净流入字段映射)', () => {
    const r = emPoolRow({
      c: '002702', m: 0, n: '海欣食品', p: 6170, zdp: 9.98, amount: 58082776,
      hs: 2.05, lbc: 2, fbt: 92500, fund: 160765273, hybk: '食品加工',
    });
    expect(r).toEqual({
      code: '002702', name: '海欣食品', pct: 9.98, mainNet: 160765273,
      amount: 58082776, hs: 2.05, lb: 2, board: '食品加工',
    });
  });

  it('parseFlowMin/parseFlowDay 解析东财 fflow 行(缺列/坏时间 → null)', () => {
    expect(parseFlowMin('2026-09-10 09:31,936944.0,145755904.0,-142046720.0')).toEqual({ t: '09:31', d: '2026-09-10', main: 936944 });
    expect(parseFlowMin('2026-09-10 09:31,-805668496.0,1,2,3')).toEqual({ t: '09:31', d: '2026-09-10', main: -805668496 });
    expect(parseFlowMin('bad')).toBeNull();
    expect(parseFlowMin('2026-09-10 09:31,-')).toBeNull(); // 上游占位符
    expect(parseFlowDay('2026-09-04,-22474530816.0,20799295488.0,-0.38')).toEqual({ t: '2026-09-04', main: -22474530816 });
    expect(parseFlowDay('')).toBeNull();
  });

  it('parseTrendMin/cumAmt 解析 trends2 成交额行并逐分钟累计', () => {
    expect(parseTrendMin('2026-09-10 09:30,4588920,6465487616.00')).toEqual({ t: '09:30', amt: 6465487616 });
    expect(parseTrendMin('2026-09-10 09:30,4588920,-')).toBeNull();
    expect(parseTrendMin('bad')).toBeNull();
    const sh = [{ t: '09:30', amt: 100 }, { t: '09:31', amt: 50 }];
    const sz = [{ t: '09:31', amt: 30 }, { t: '13:00', amt: 7 }];
    expect(cumAmt(sh, sz)).toEqual([
      { t: '09:30', cum: 100 }, { t: '09:31', cum: 180 }, { t: '13:00', cum: 187 },
    ]);
    expect(cumAmt([], [])).toEqual([]);
  });

  it('mergeFlow 两市按时间对齐相加,单边缺失用另一边', () => {
    const sh = [{ t: '09:31', main: 100 }, { t: '09:32', main: 200 }];
    const sz = [{ t: '09:32', main: 50 }, { t: '09:33', main: -80 }];
    expect(mergeFlow(sh, sz)).toEqual([
      { t: '09:31', main: 100 }, { t: '09:32', main: 250 }, { t: '09:33', main: -80 },
    ]);
    expect(mergeFlow([], sh)).toEqual(sh);
  });
});

// 北向:只认 DEAL_AMT(成交额,百万元→亿元),按日归并 沪001/深003/合计005,新→旧
test('northRows 北向成交额归并(净买入 null 行被忽略)', () => {
  const rows = [
    { TRADE_DATE: '2026-09-09 00:00:00', MUTUAL_TYPE: '001', DEAL_AMT: 114491.12, NET_DEAL_AMT: null },
    { TRADE_DATE: '2026-09-09 00:00:00', MUTUAL_TYPE: '003', DEAL_AMT: 131594.78 },
    { TRADE_DATE: '2026-09-09 00:00:00', MUTUAL_TYPE: '005', DEAL_AMT: 246085.9 },
    { TRADE_DATE: '2026-09-09 00:00:00', MUTUAL_TYPE: '006', DEAL_AMT: 90790.62 },
    { TRADE_DATE: '2026-09-08 00:00:00', MUTUAL_TYPE: '005', DEAL_AMT: 266047.9 },
    { TRADE_DATE: 'bad', MUTUAL_TYPE: '005', DEAL_AMT: 1 },
    { TRADE_DATE: '2026-09-07 00:00:00', MUTUAL_TYPE: '005', DEAL_AMT: '-' },
  ];
  const r = northRows(rows);
  expect(r.length).toBe(2);
  expect(r[0]).toEqual({ d: '2026-09-09', sh: 1144.9112, sz: 1315.9478, total: 2460.859 });
  expect(r[1].total).toBeCloseTo(2660.479, 3);
});

// ---------- ② 近7日主力净额:沪深日线按日合并(2026-09 由分时改日线口径) ----------
it('mergeDays 按日期对齐相加、单边缺只算可用边、升序取最后 n 天', () => {
  const sh = [{ t: '2026-09-08', main: 1e9 }, { t: '2026-09-09', main: -2e9 }, { t: '2026-09-10', main: 3e9 }];
  const sz = [{ t: '2026-09-08', main: 0.5e9 }, { t: '2026-09-10', main: -1e9 }]; // 09-09 深市缺
  const m = mergeDays(sh, sz);
  expect(m.length).toBe(3);
  expect(m[0]).toEqual({ t: '2026-09-08', main: 1.5e9, sh: 1e9, sz: 0.5e9 });
  expect(m[1]).toEqual({ t: '2026-09-09', main: -2e9, sh: -2e9, sz: null });
  expect(m[2].main).toBeCloseTo(2e9, 6);
  expect(mergeDays(sh, [], 2).map(r => r.t)).toEqual(['2026-09-09', '2026-09-10']); // 空边→纯沪;取最后2天
  expect(mergeDays([], []).length).toBe(0);
});

// ---------- 本地台账:多路东财口径任一存活都记一笔,攒出近7日 ----------
it('applyFlowStore 日期取 d||t、null 跳过、只留最后 n 天', () => {
  const s: Record<string, { sh: number | null; sz: number | null }> = {};
  applyFlowStore(s, 'sh', [{ t: '2026-09-08', main: 1e9 }, { t: '2026-09-09', main: null }]); // 日线行(无 d)
  applyFlowStore(s, 'sz', [{ d: '2026-09-09', t: '15:00', main: -2e9 }]); // 分时行(取 d)
  expect(s['2026-09-08']).toEqual({ sh: 1e9, sz: null });
  expect(s['2026-09-09']).toEqual({ sh: null, sz: -2e9 });
  for (let i = 0; i < 10; i++) applyFlowStore(s, 'sh', [{ t: `2026-10-${10 + i}`, main: i }], 3);
  expect(Object.keys(s).sort()).toEqual(['2026-10-17', '2026-10-18', '2026-10-19']);
});

// 整点快照:10:30 已收口(有其后行)/11:30 恰好命中/14:00 未到点(序列只到11:30)不记
it('applyFlowHours 只在整点已收口时记该小时末累计', () => {
  const s: any = {};
  const rows = [
    { d: '2026-09-11', t: '10:00', main: -100 }, { d: '2026-09-11', t: '10:30', main: -200 },
    { d: '2026-09-11', t: '11:00', main: -300 }, { d: '2026-09-11', t: '11:30', main: -400 },
  ];
  applyFlowHours(s, 'sh', rows as any);
  expect(s['2026-09-11'].hrs['10:30']).toEqual({ sh: -200, sz: null }); // 精确命中
  expect(s['2026-09-11'].hrs['11:30']).toEqual({ sh: -400, sz: null }); // 末行恰好=整点,已收口
  expect(s['2026-09-11'].hrs['14:00']).toBeUndefined(); // 未到点
  applyFlowHours(s, 'sz', [{ d: '2026-09-11', t: '10:29', main: 50 }, { d: '2026-09-11', t: '10:31', main: 60 }] as any); // 10:30 缺行且已过点 → 取 10:29 前值
  expect(s['2026-09-11'].hrs['10:30'].sz).toBe(50);
});

// ---------- ③ 趋势投资派:日K指标与评分(2026-09 两派改造) ----------
describe('market.service 趋势派纯函数', () => {
  const mkBars = (n: number, fn: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => {
      const c = fn(i);
      return { c, h: c + 0.5, v: i >= n - 5 ? 3000 : 1000 };
    });

  it('parseTencentKline 行映射与最少根数', () => {
    expect(() => parseTencentKline([])).toThrow('不足60根');
    const rows = Array.from({ length: 61 }, (_, i) => ['d', '1', String(10 + i * 0.1), '10.9', '0.9', '100']);
    const bars = parseTencentKline(rows);
    expect(bars.length).toBe(61);
    expect(bars[0]).toEqual({ c: 10, h: 10.9, v: 100 });
  });

  it('klineInd 上升趋势:多头排列/站线/放量/60日新高,RSI 高位', () => {
    const ind = klineInd(mkBars(80, i => 100 + i * 0.5));
    expect(ind.maBull).toBe(true);
    expect(ind.aboveMa20).toBe(true);
    expect(ind.macdUp).toBe(true); // 单边涨 DIF>DEA>0
    expect(ind.newHigh60).toBe(true);
    expect(ind.vol5_60).toBeCloseTo(3000 / ((5 * 3000 + 55 * 1000) / 60), 6); // 末5根放量3倍
    expect(ind.chg20).toBeCloseTo((139.5 / 129.5 - 1) * 100, 6);
    expect(ind.rsi).toBeGreaterThan(70); // 天天涨必超买 → 会被硬门槛挡下
  });

  it('klineInd 下降趋势:排列破坏、不站线、无新高', () => {
    const ind = klineInd(mkBars(80, i => 200 - i * 0.5));
    expect(ind.maBull).toBe(false);
    expect(ind.aboveMa20).toBe(false);
    expect(ind.newHigh60).toBe(false);
  });

  it('rsi14:涨跌对称 → 50 附近,单调跌 → 0,单调涨 → 100,不足15根 → null', () => {
    let x = 100;
    const alt = [x];
    for (let i = 1; i < 41; i++) { x += i % 2 ? 1 : -1; alt.push(x); } // +1,-1 交替(20涨20跌)
    // Wilder 平滑下先涨后跌的成对序列每对向 loss 微漂(涨分量先被衰减),长序列收敛于 50 而非恒等于
    expect(rsi14(alt)).toBeGreaterThan(45);
    expect(rsi14(alt)).toBeLessThan(55);
    expect(rsi14(Array.from({ length: 30 }, (_, i) => 100 - i))).toBe(0);
    expect(rsi14(Array.from({ length: 30 }, (_, i) => 100 + i))).toBe(100);
    expect(rsi14([1, 2, 3])).toBeNull();
  });

  it('trendScore:全达标=91(12×量档),极值封顶100', () => {
    const good = { maBull: true, aboveMa20: true, macdUp: true, rsi: 61, newHigh60: true, vol5_60: 1.8, chg20: 18 } as any;
    expect(trendScore(good, { turn: 8, mainNet: 2.1e8 }, 3)).toBe(91); // 50+12+5+5+14+5
    const max = { ...good, vol5_60: 2.5, chg20: 40, rsi: 55 };
    expect(trendScore(max, { turn: 8, mainNet: 3e8 }, 2)).toBe(100);
    const poor = { maBull: false, aboveMa20: false, macdUp: false, rsi: 40, newHigh60: false, vol5_60: null, chg20: null } as any;
    expect(trendScore(poor, { turn: null, mainNet: null }, 0)).toBe(0);
  });
});

describe('market.service 基金观察纯函数', () => {
  const per = [
    { title: 'Z', syl: '0.6' }, { title: 'Y', syl: '-0.06' }, { title: '3Y', syl: '-3.49' },
    { title: '1N', syl: '2.24' }, { title: '2N', syl: '20.38' }, { title: '3N', syl: '14.26' },
    { title: 'JN', syl: '5.1' }, { title: 'LN', syl: '228.5' },
  ];
  it('fundPeriods:Z/Y/3Y/1N/3N/LN 取值;新基金 3N 空串 → null(前端落成立以来)', () => {
    expect(fundPeriods(per)).toEqual({ r7d: 0.6, r30d: -0.06, r90d: -3.49, r1y: 2.24, r3y: 14.26, ln: 228.5 });
    const young = [{ title: '1N', syl: '45.83' }, { title: '3N', syl: '' }, { title: 'LN', syl: '173.06' }];
    expect(fundPeriods(young)).toEqual({ r7d: null, r30d: null, r90d: null, r1y: 45.83, r3y: null, ln: 173.06 });
    expect(fundPeriods([]).r1y).toBeNull();
  });
  it('fundNavLatest:场外首行=净值日期+涨跌幅;空/-- → null', () => {
    expect(fundNavLatest([{ FSRQ: '2026-09-21', JZZZL: '1.04' }])).toEqual({ date: '2026-09-21', chg: 1.04 });
    expect(fundNavLatest([{ FSRQ: '2026-09-21', JZZZL: '--' }])).toEqual({ date: '2026-09-21', chg: null });
    expect(fundNavLatest([])).toEqual({ date: null, chg: null });
  });
  it('fundQtCode:5/6 首位=沪,15/16=深(勿套 A股 6→sh 规则)', () => {
    expect(fundQtCode('513100')).toBe('sh513100');
    expect(fundQtCode('159382')).toBe('sz159382');
    expect(fundQtCode('515450')).toBe('sh515450');
  });
});
