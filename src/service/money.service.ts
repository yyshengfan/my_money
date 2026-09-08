import { Provide } from "@midwayjs/core";
import { InjectEntityModel } from "@midwayjs/typeorm";
import { Money } from "../entity/entities/Money";
import { MoneyFinance } from "../entity/entities/MoneyFinance";
import { Repository } from "typeorm";
import { MoneyDTO } from "../dto/money.dto";
import moment = require("moment");

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
    moneyFinanceNew.time = moment().format("YYYY-MM-DD");

    // 计算理财
    moneyFinanceNew.zfbIncrease = params.zfbAmount - moneyFinance.zfbAmount;
    moneyFinanceNew.fundIncrease = params.fund - moneyFinance.fund;
    moneyFinanceNew.bitIncrease = params.bitAmount - moneyFinance.bitAmount;
    moneyFinanceNew.stockIncrease = params.stockAmount - moneyFinance.stockAmount;
    moneyFinanceNew.hkStockIncrease = params.hkStock - moneyFinance.hkStock;
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
    moneyNew.periodicalIncrease = params.periodical - money.periodical;
    moneyNew.outmoneyOther = params.outmoneyOther;
    moneyNew.outmoneyRent = params.outmoneyRent;
    moneyNew.outmoneyMortgage = params.outmoneyMortgage;
    moneyNew.outmoneySocialSecurity = params.outmoneySocialSecurity;

    moneyNew.time = moment().format("YYYY-MM-DD");

    // 计算其他 总和
    moneyNew.money = params.periodical + moneyFinanceNew.money - params.credit;

    // 总进帐
    moneyNew.increment = moneyNew.money - money.money - moneyNew.credit;

    // 总出帐
    moneyNew.outmoneyCons = moneyNew.inmoney - moneyNew.increment;

    // 净支出
    moneyNew.outmoneyNet =
      moneyNew.inmoney +
      moneyFinanceNew.sumIncrease -
      moneyNew.increment;

    // 生活支出
    moneyNew.outmoneyLife =
      moneyNew.outmoneyNet -
      params.outmoneyOther -
      params.outmoneyRent -
      params.outmoneyMortgage -
      params.outmoneySocialSecurity;

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
