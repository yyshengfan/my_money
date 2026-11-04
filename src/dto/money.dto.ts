import { Rule, RuleType } from '@midwayjs/validate';

export class MoneyDTO {
  @Rule(RuleType.number().max(999999999).required())
  salary: number;
  @Rule(RuleType.number().max(999999999).required())
  inmoney: number;
  @Rule(RuleType.number().max(999999999).required())
  credit: number;
  @Rule(RuleType.number().max(999999999).required())
  periodical: number;
  @Rule(RuleType.number().max(999999999).required())
  fund: number;
  @Rule(RuleType.number().max(999999999).required())
  bitAmount: number;
  @Rule(RuleType.number().max(999999999).required())
  stockAmount: number;
  @Rule(RuleType.number().max(999999999).required())
  zfbAmount: number;
  @Rule(RuleType.number().max(999999999).required())
  outmoneyOther: number;
  @Rule(RuleType.number().max(999999999).required())
  outmoneyRent: number;
  @Rule(RuleType.number().max(999999999).required())
  outmoneyMortgage: number;
  @Rule(RuleType.number().max(999999999).required())
  outmoneySocialSecurity: number;
  @Rule(RuleType.number().max(999999999).required())
  hkStock: number;
  // 充值/提取(2026-09-30 用户加):充值为正、提取为负;可选、缺省 0,老调用方不传也能记
  @Rule(RuleType.number().min(-999999999).max(999999999).optional().default(0))
  fundDeposit: number;
  @Rule(RuleType.number().min(-999999999).max(999999999).optional().default(0))
  bitDeposit: number;
  @Rule(RuleType.number().min(-999999999).max(999999999).optional().default(0))
  stockDeposit: number;
  @Rule(RuleType.number().min(-999999999).max(999999999).optional().default(0))
  zfbDeposit: number;
  @Rule(RuleType.number().min(-999999999).max(999999999).optional().default(0))
  hkStockDeposit: number;
  @Rule(RuleType.number().min(-999999999).max(999999999).optional().default(0))
  periodicalDeposit: number;
  @Rule(RuleType.string().trim().max(255).required())
  comment: string;
}
