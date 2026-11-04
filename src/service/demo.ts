/*
 * 演示数据(2026-09):除 tianhui 外任意账号都能登录,看到的是假持仓/假资产。
 * 约束:① 总资产(理财总额+存款)恒定 ≤ 100 万元;② 数字满足 money.service.createNew 的公式,
 * dashboard/cashflow 前端聚合无需特判;③ 固定种子的纯函数,全站共享一份、可缓存。
 * 持仓板块(2026-09-22 改):底数写死 + 随机抖动,构造器在 holding.service(demo* 函数),零上游请求。
 */
import { payNorm } from './money.service';

// A股/港股自选假清单(字段与 Holding 实体行一致;行情本身是公开数据,不算秘密)
export const DEMO_STOCKS = [
  { id: 9001, code: '600519', name: '贵州茅台', market: 'A股·沪' },
  { id: 9002, code: '300750', name: '宁德时代', market: 'A股·深' },
  { id: 9003, code: '601318', name: '中国平安', market: 'A股·沪' },
  { id: 9004, code: '00700', name: '腾讯控股', market: '港股' },
  { id: 9005, code: '03690', name: '美团-W', market: '港股' },
];

// ---------- 持仓板块假数据(2026-09-22 用户要求:非 tianhui 账号看写死底数 + 随机抖动,零上游请求) ----------
// 底数只放这;holding.service 的 demo* 构造器每次读取再抖 ±0.4~2%,页面上看像实时。
// tech 布尔字段固定(故事不随刷新乱变);pos = 120 日区位置、dd = 距高点回撤%
export const DEMO_STK = [
  { code: '600519', name: '贵州茅台', market: 'A股·沪', price: 1486.5, pe: 19.2, pb: 6.1, chgPct: 0.82, pos: 64, dd: 7.5,
    tech: { maBull: true, aboveMa20: true, ma20: 1462, ma60: 1431, macdUp: true, newHigh60: false, rsi: 58, vol5_60: 1.12, chg20: 3.1 } },
  { code: '300750', name: '宁德时代', market: 'A股·深', price: 232.8, pe: 24.5, pb: 4.2, chgPct: 2.35, pos: 92, dd: 3.2,
    tech: { maBull: true, aboveMa20: true, ma20: 224, ma60: 210, macdUp: false, newHigh60: true, rsi: 71, vol5_60: 2.3, chg20: 8.6 } },
  { code: '601318', name: '中国平安', market: 'A股·沪', price: 54.6, pe: 8.9, pb: 1.05, chgPct: -0.55, pos: 22, dd: 26.8,
    tech: { maBull: false, aboveMa20: false, ma20: 56.2, ma60: 52.8, macdUp: false, newHigh60: false, rsi: 41, vol5_60: 0.8, chg20: -4.2 } },
  { code: '00700', name: '腾讯控股', market: '港股', price: 412.0, pe: 16.8, pb: 3.4, chgPct: 1.12, pos: 41, dd: 12,
    tech: { maBull: false, aboveMa20: true, ma20: 405, ma60: 398, macdUp: true, newHigh60: false, rsi: 55, vol5_60: 1.35, chg20: 6.4 } },
  { code: '03690', name: '美团-W', market: '港股', price: 128.4, pe: 22.0, pb: 3.1, chgPct: -2.86, pos: 9, dd: 38,
    tech: { maBull: false, aboveMa20: false, ma20: 136, ma60: 141, macdUp: false, newHigh60: false, rsi: 29, vol5_60: 1.6, chg20: -9.5 } },
];

// 币圈假持仓:spot=交易账户 / fund=资金账户 / earn=理财 / fut=合约,价全 USDT;合计由构造器现算
export const DEMO_CRY = {
  fx: 6.72, fng: 52,
  spot: [
    { sym: 'BTC', qty: 0.18, cost: 58200, price: 64850, chgPct: 1.85 },
    { sym: 'ETH', qty: 2.6, cost: 3020, price: 3278, chgPct: 2.42 },
    { sym: 'SOL', qty: 40, cost: 128, price: 151.2, chgPct: -1.35 },
    { sym: 'BNB', qty: 4, cost: 480, price: 556, chgPct: -0.62 },
    { sym: 'OKB', qty: 80, cost: 14.5, price: 19.8, chgPct: 0.74 },
    { sym: 'XRP', qty: 2600, cost: 0.52, price: 0.585, chgPct: 1.1 },
    { sym: 'USDT', qty: 5200, cost: null, price: 1, chgPct: 0.01 },
  ],
  fund: [
    { sym: 'DOGE', qty: 9000, price: 0.132, chgPct: -0.4 },
    { sym: 'USDC', qty: 900, price: 0.999, chgPct: 0 },
  ],
  earn: [
    { sym: 'BTC', qty: 0.05, apy: 2.1, earnings: 0.0009 },
    { sym: 'ETH', qty: 1.1, apy: 1.8, earnings: 0.028 },
    { sym: 'USDT', qty: 2600, apy: 4.2, earnings: 176.3 },
  ],
  fut: [
    { sym: 'BTC', dir: 'long', entry: 60200, qty: 0.12, lev: 5, funding: 0.000112 },
    { sym: 'ETH', dir: 'short', entry: 3450, qty: 2.0, lev: 3, funding: -0.000045 },
  ],
};

// mulberry32:固定种子,每次生成完全一致(缓存/测试都需要确定性)
function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 近 36 个月收支/理财假快照,字段与公式逐条对齐 money.service.createNew
export function demoMoneyList(now = new Date()) {
  const rnd = rng(0x51f2b3a7);
  const ri = (a: number, b: number) => Math.round(a + (b - a) * rnd());
  const finance: any[] = [];
  const money: any[] = [];
  // 充值/提取(2026-09-30 随 createNew 加):增量=快照差−充值=纯盈亏
  const CATS: Array<[amt: string, inc: string, dep: string]> = [
    ['fund', 'fundIncrease', 'fundDeposit'],
    ['bitAmount', 'bitIncrease', 'bitDeposit'],
    ['stockAmount', 'stockIncrease', 'stockDeposit'],
    ['zfbAmount', 'zfbIncrease', 'zfbDeposit'],
    ['hkStock', 'hkStockIncrease', 'hkStockDeposit'],
  ];
  const CMT_F = ['月末快照', '加了一笔定投', '赎回部分', '币仓调整', '例行记录'];
  const CMT_M = ['工资到账', '日常开销', '信用卡账单', '生活支出', '转账储蓄'];

  // 首行也要自洽:凭空造一个「上一次」基线
  let prev: Record<string, number> = { fund: 62000, bitAmount: 38000, stockAmount: 90000, zfbAmount: 24000, hkStock: 30000 };
  let prevPeriodical = 35000;
  let prevBal = CATS.reduce((a, c) => a + prev[c[0]], 0) + prevPeriodical - 6000;

  const base = new Date(now.getFullYear(), now.getMonth() - 35, 1);
  const endOf = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0); // 当月最后一天
  for (let m = 0; m < 36; m++) {
    const t = endOf(new Date(base.getFullYear(), base.getMonth() + m, 1));
    const time = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;

    // 理财五类:漂移拆成「充值/提取」+「纯盈亏」两段(2026-09-30 随 createNew 新公式)
    const f: any = { id: String(m + 1), time, comment: CMT_F[m % CMT_F.length] };
    let finTotal = 0;
    let sumIncrease = 0;
    for (const [amt, inc, depo] of CATS) {
      const deposit = ri(-1200, 2200); // 充值为正、提取为负
      const v = Math.max(2000, prev[amt] + deposit + ri(-800, 900)); // 快照漂移 = 充值 + 盈亏
      f[amt] = v;
      f[depo] = deposit;
      f[inc] = v - prev[amt] - deposit; // 增量 = 本月 − 上月 − 充值
      finTotal += v;
      sumIncrease += v - prev[amt] - deposit;
      prev = { ...prev, [amt]: v };
    }
    f.money = finTotal;
    f.sumIncrease = sumIncrease;
    finance.push(f);

    // 收支行(余额/进出账/净支出全按 createNew 公式机械算出)
    const periodicalDeposit = ri(-2000, 3500); // 零钱充值/支取(进出零钱池的动作)
    const periodical = Math.max(5000, prevPeriodical + periodicalDeposit + ri(-1500, 1500));
    const salary = ri(16500, 21500);
    const inmoney = salary + ri(0, 3000);
    const credit = ri(5200, 9600);
    const outmoneySocialSecurity = ri(2600, 3400);
    const outmoneyOther = ri(400, 1800);
    const outmoneyRent = 0;
    const outmoneyMortgage = 0;
    const bal = periodical + finTotal - credit;
    const increment = bal - prevBal; // 余额增长(2026-09-30 随 createNew 去掉 credit 双扣)
    const outmoneyCons = inmoney - increment;
    const outmoneyNet = inmoney + sumIncrease - increment;
    const outmoneyLife =
      outmoneyNet -
      payNorm('outmoneyRent', outmoneyRent) -
      payNorm('outmoneyMortgage', outmoneyMortgage) -
      payNorm('outmoneySocialSecurity', outmoneySocialSecurity); // 其他支出计入生活,与前端同口径
    money.push({
      id: String(m + 1), time, comment: CMT_M[m % CMT_M.length],
      salary, inmoney, credit, periodical, periodicalDeposit,
      periodicalIncrease: periodical - prevPeriodical - periodicalDeposit,
      outmoneyRent, outmoneyMortgage, outmoneySocialSecurity, outmoneyOther,
      outmoneyCons, outmoneyNet, outmoneyLife, increment, money: bal,
    });
    prevPeriodical = periodical;
    prevBal = bal;
  }
  return { finance, money };
}
