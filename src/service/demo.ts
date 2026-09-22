/*
 * 演示数据(2026-09):除 tianhui 外任意账号都能登录,看到的是假持仓/假资产。
 * 约束:① 总资产(理财总额+存款)恒定 ≤ 100 万元;② 数字满足 money.service.createNew 的公式,
 * dashboard/cashflow 前端聚合无需特判;③ 固定种子的纯函数,全站共享一份、可缓存。
 * 币圈假台账走 holding.service 既有「兜底台账」路径(假数量 × 公开实时价),形状与真值同构。
 */

// A股/港股自选假清单(字段与 Holding 实体行一致;行情本身是公开数据,不算秘密)
export const DEMO_STOCKS = [
  { id: 9001, code: '600519', name: '贵州茅台', market: 'A股·沪' },
  { id: 9002, code: '300750', name: '宁德时代', market: 'A股·深' },
  { id: 9003, code: '601318', name: '中国平安', market: 'A股·沪' },
  { id: 9004, code: '00700', name: '腾讯控股', market: '港股' },
  { id: 9005, code: '03690', name: '美团-W', market: '港股' },
];

// 币圈假台账(形状 = data/crypto_holdings.json;qty 特意压低,现货全折 U 约 3 万 U 内)
export const DEMO_CRYPTO = {
  spot: [
    { sym: 'BTC', qty: 0.12, cost: 52000 },
    { sym: 'ETH', qty: 2.4, cost: 2500 },
    { sym: 'SOL', qty: 35, cost: 110 },
    { sym: 'BNB', qty: 4, cost: 500 },
    { sym: 'OKB', qty: 40, cost: 18 },
  ],
  fut: [{ sym: 'ETH', dir: 'long', entry: 2600, qty: 1.5, lev: 3 }],
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
  const CATS: Array<[amt: string, inc: string]> = [
    ['fund', 'fundIncrease'],
    ['bitAmount', 'bitIncrease'],
    ['stockAmount', 'stockIncrease'],
    ['zfbAmount', 'zfbIncrease'],
    ['hkStock', 'hkStockIncrease'],
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

    // 理财五类:每月小幅漂移(转入+盈亏混合,与真实口径一样不拆分);增量随快照差生成
    const f: any = { id: String(m + 1), time, comment: CMT_F[m % CMT_F.length] };
    let finTotal = 0;
    let sumIncrease = 0;
    for (const [amt, inc] of CATS) {
      const v = Math.max(2000, prev[amt] + ri(-1500, 2600));
      f[amt] = v;
      f[inc] = v - prev[amt];
      finTotal += v;
      sumIncrease += v - prev[amt];
      prev = { ...prev, [amt]: v };
    }
    f.money = finTotal;
    f.sumIncrease = sumIncrease;
    finance.push(f);

    // 收支行(余额/进出账/净支出全按 createNew 公式机械算出)
    const periodical = Math.max(5000, prevPeriodical + ri(-3000, 4800));
    const salary = ri(16500, 21500);
    const inmoney = salary + ri(0, 3000);
    const credit = ri(5200, 9600);
    const outmoneySocialSecurity = ri(2600, 3400);
    const outmoneyOther = ri(400, 1800);
    const outmoneyRent = 0;
    const outmoneyMortgage = 0;
    const bal = periodical + finTotal - credit;
    const increment = bal - prevBal - credit;
    const outmoneyCons = inmoney - increment;
    const outmoneyNet = inmoney + sumIncrease - increment;
    const outmoneyLife = outmoneyNet - outmoneyOther - outmoneyRent - outmoneyMortgage - outmoneySocialSecurity;
    money.push({
      id: String(m + 1), time, comment: CMT_M[m % CMT_M.length],
      salary, inmoney, credit, periodical, periodicalIncrease: periodical - prevPeriodical,
      outmoneyRent, outmoneyMortgage, outmoneySocialSecurity, outmoneyOther,
      outmoneyCons, outmoneyNet, outmoneyLife, increment, money: bal,
    });
    prevPeriodical = periodical;
    prevBal = bal;
  }
  return { finance, money };
}
