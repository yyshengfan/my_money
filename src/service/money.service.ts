import { Provide } from "@midwayjs/core";
import { InjectEntityModel } from "@midwayjs/typeorm";
import { Money } from "../entity/entities/Money";
import { MoneyFinance } from "../entity/entities/MoneyFinance";
import { Repository } from "typeorm";
import { MoneyDTO } from "../dto/money.dto";
import moment = require("moment");

// 支出归一:用户约定「缴纳记负、房租收入为正」→ 房租只计负数缴纳、正数(收入)不计;其余取绝对值。
// demo.ts 与 scripts/backfill_money_derived.js 同此规则(2026-09-30 口径统一)
export function payNorm(k: string, v: number | null | undefined): number {
  if (v == null) return 0;
  return k === "outmoneyRent" ? Math.max(0, -v) : Math.abs(v);
}

@Provide()
export class MoneyService {
  // 这里一般会注入一个实体类对应的 Model，包含增删改查方法
  @InjectEntityModel(Money, "datasource1")
  money: Repository<Money>;
  @InjectEntityModel(MoneyFinance, "datasource1")
  moneyFinance: Repository<MoneyFinance>;

  async createNew(params: MoneyDTO) {
    const resMoney = await this.money.find({
      order: { id: "DESC" },
      take: 1,
    });
    const resMoneyFinnance = await this.moneyFinance.find({
      order: { id: "DESC" },
      take: 1,
    });
    // 空表兜底:字段显式给 null,减法行为与真实 null 行一致
    const money = resMoney[0] ?? { money: null, periodical: null };
    const moneyFinance =
      resMoneyFinnance[0] ??
      { fund: null, bitAmount: null, stockAmount: null, zfbAmount: null, hkStock: null };

    const moneyNew = new Money();
    const moneyFinanceNew = new MoneyFinance();

    // finance
    moneyFinanceNew.fund = params.fund;
    moneyFinanceNew.bitAmount = params.bitAmount;
    moneyFinanceNew.stockAmount = params.stockAmount;
    moneyFinanceNew.zfbAmount = params.zfbAmount;
    moneyFinanceNew.hkStock = params.hkStock;
    moneyFinanceNew.comment = params.comment;
    // 充值/提取(充值为正、提取为负;2026-09-30 用户加,增量=本月-上月-充值 → 拆出纯盈亏)
    const dep = (v: number | null | undefined) => v ?? 0;
    moneyFinanceNew.fundDeposit = dep(params.fundDeposit);
    moneyFinanceNew.bitDeposit = dep(params.bitDeposit);
    moneyFinanceNew.stockDeposit = dep(params.stockDeposit);
    moneyFinanceNew.zfbDeposit = dep(params.zfbDeposit);
    moneyFinanceNew.hkStockDeposit = dep(params.hkStockDeposit);
    // 快照时间取当月最后一天(记账按月归位)
    moneyFinanceNew.time = moment().endOf("month").format("YYYY-MM-DD");

    // 计算理财:增量扣掉本期充值/提取,新行=纯盈亏(转入转出不再掺进来)
    moneyFinanceNew.zfbIncrease = params.zfbAmount - moneyFinance.zfbAmount - moneyFinanceNew.zfbDeposit;
    moneyFinanceNew.fundIncrease = params.fund - moneyFinance.fund - moneyFinanceNew.fundDeposit;
    moneyFinanceNew.bitIncrease = params.bitAmount - moneyFinance.bitAmount - moneyFinanceNew.bitDeposit;
    moneyFinanceNew.stockIncrease = params.stockAmount - moneyFinance.stockAmount - moneyFinanceNew.stockDeposit;
    moneyFinanceNew.hkStockIncrease = params.hkStock - moneyFinance.hkStock - moneyFinanceNew.hkStockDeposit;
    moneyFinanceNew.money = params.fund + params.bitAmount + params.stockAmount + params.hkStock + params.zfbAmount;
    
    // 总盈亏
    moneyFinanceNew.sumIncrease =
      moneyFinanceNew.zfbIncrease +
      moneyFinanceNew.fundIncrease +
      moneyFinanceNew.bitIncrease +
      moneyFinanceNew.stockIncrease +
      moneyFinanceNew.hkStockIncrease;
    
    // 原声参数
    moneyNew.salary = params.salary;
    moneyNew.inmoney = params.inmoney;
    moneyNew.credit = params.credit;
    moneyNew.periodical = params.periodical;

    // 支出
    moneyNew.comment = params.comment;
    // 零钱增量同样扣充值(存入理财等转出记负)
    moneyNew.periodicalDeposit = dep(params.periodicalDeposit);
    moneyNew.periodicalIncrease =
      params.periodical - money.periodical - moneyNew.periodicalDeposit;
    moneyNew.outmoneyOther = params.outmoneyOther;
    moneyNew.outmoneyRent = params.outmoneyRent;
    moneyNew.outmoneyMortgage = params.outmoneyMortgage;
    moneyNew.outmoneySocialSecurity = params.outmoneySocialSecurity;

    moneyNew.time = moment().format("YYYY-MM-DD");

    // 计算其他 总和
    moneyNew.money = params.periodical + moneyFinanceNew.money - params.credit;

    // 总进帐 = 余额增长。credit 是「本期新增刷卡额」流量,上面余额公式已扣一次,这里不能再扣
    // (旧式减了两次 → increment = Δ存款+Δ理财−2·credit,下游 cons/net 全被带偏,2026-09-30 修)
    moneyNew.increment = moneyNew.money - money.money;

    // 总出帐
    moneyNew.outmoneyCons = moneyNew.inmoney - moneyNew.increment;

    // 净支出
    moneyNew.outmoneyNet =
      moneyNew.inmoney +
      moneyFinanceNew.sumIncrease -
      moneyNew.increment;

    // 生活支出 = 净支出 − 房租/房贷/社保(三项归一;「其他支出」计入生活,与 dashboard 前端同口径)
    moneyNew.outmoneyLife =
      moneyNew.outmoneyNet -
      payNorm("outmoneyRent", params.outmoneyRent) -
      payNorm("outmoneyMortgage", params.outmoneyMortgage) -
      payNorm("outmoneySocialSecurity", params.outmoneySocialSecurity);

    // 事务:两张表要么都写入,要么都不写
    return this.money.manager.transaction(async em => {
      await em.insert(MoneyFinance, moneyFinanceNew);
      return em.insert(Money, moneyNew);
    });
  }

  // 全量查询,供 dashboard 前端聚合
  async findAll() {
    return {
      finance: await this.moneyFinance.find({ order: { time: "ASC", id: "ASC" } }),
      money: await this.money.find({ order: { time: "ASC", id: "ASC" } }),
    };
  }

}
