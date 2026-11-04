import { demoMoneyList } from '../src/service/demo';

// 演示数据纯函数自检:① 公式与 money.service.createNew 逐条自洽 ② 总资产恒定 ≤ 100 万
describe('demo 演示数据', () => {
  const { finance, money } = demoMoneyList(new Date('2026-09-20'));

  it('36 个月度快照,按时间升序', () => {
    expect(finance.length).toBe(36);
    expect(money.length).toBe(36);
    for (let i = 1; i < finance.length; i++) expect(finance[i].time > finance[i - 1].time).toBe(true);
  });

  it('理财行:五类增量之和 = sumIncrease,快照之和 = money', () => {
    for (const f of finance) {
      const incs = [f.fundIncrease, f.bitIncrease, f.stockIncrease, f.zfbIncrease, f.hkStockIncrease];
      expect(incs.reduce((a, b) => a + b, 0)).toBe(f.sumIncrease);
      expect(f.fund + f.bitAmount + f.stockAmount + f.zfbAmount + f.hkStock).toBe(f.money);
    }
  });

  it('增量 = 本月 − 上月 − 充值(2026-09-30 充值字段,createNew 同式)', () => {
    const PAIRS: Array<[string, string, string]> = [
      ['fund', 'fundIncrease', 'fundDeposit'],
      ['bitAmount', 'bitIncrease', 'bitDeposit'],
      ['stockAmount', 'stockIncrease', 'stockDeposit'],
      ['zfbAmount', 'zfbIncrease', 'zfbDeposit'],
      ['hkStock', 'hkStockIncrease', 'hkStockDeposit'],
    ];
    for (let i = 1; i < finance.length; i++)
      for (const [amt, inc, depo] of PAIRS)
        expect(finance[i][inc]).toBe(finance[i][amt] - finance[i - 1][amt] - finance[i][depo]);
  });

  it('收支行:余额/增量/出账按 createNew 公式自洽', () => {
    for (let i = 1; i < money.length; i++) {
      const m = money[i], p = money[i - 1], f = finance[i];
      expect(m.increment).toBe(m.money - p.money); // 余额增长,credit 不再双扣(2026-09-30)
      expect(m.outmoneyCons).toBe(m.inmoney - m.increment);
      expect(m.outmoneyNet).toBe(m.inmoney + f.sumIncrease - m.increment);
      // 生活支出 = 净支出 − 三项归一(房租只计负数缴纳、其余取绝对值;「其他」计入生活)
      expect(m.outmoneyLife).toBe(
        m.outmoneyNet -
          Math.max(0, -m.outmoneyRent) -
          Math.abs(m.outmoneyMortgage) -
          Math.abs(m.outmoneySocialSecurity)
      );
      expect(m.periodicalIncrease).toBe(m.periodical - p.periodical - m.periodicalDeposit); // 零钱增量同扣充值
    }
  });

  it('总资产(理财总额+存款)全程 ≤ 100 万', () => {
    for (let i = 0; i < 36; i++) expect(finance[i].money + money[i].periodical).toBeLessThanOrEqual(1_000_000);
  });
});
