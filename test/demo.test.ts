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

  it('收支行:余额/增量/出账按 createNew 公式自洽', () => {
    for (let i = 1; i < money.length; i++) {
      const m = money[i], p = money[i - 1], f = finance[i];
      expect(m.increment).toBe(m.money - p.money - m.credit);
      expect(m.outmoneyCons).toBe(m.inmoney - m.increment);
      expect(m.outmoneyNet).toBe(m.inmoney + f.sumIncrease - m.increment);
      expect(m.outmoneyLife).toBe(
        m.outmoneyNet - m.outmoneyOther - m.outmoneyRent - m.outmoneyMortgage - m.outmoneySocialSecurity
      );
      expect(m.periodicalIncrease).toBe(m.periodical - p.periodical);
    }
  });

  it('总资产(理财总额+存款)全程 ≤ 100 万', () => {
    for (let i = 0; i < 36; i++) expect(finance[i].money + money[i].periodical).toBeLessThanOrEqual(1_000_000);
  });
});
