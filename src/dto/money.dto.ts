/**
 * @description 描述
 * @author hui.tian
 * @date 2022-09-21 14:13:10
 * @last_modified_time 2022-09-21 14:13:10
 */
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
  @Rule(RuleType.string().trim().max(255).required())
  comment: string;
}
