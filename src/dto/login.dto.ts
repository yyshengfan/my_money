import { Rule, RuleType } from '@midwayjs/validate';

export class LoginDTO {
  @Rule(RuleType.string().trim().max(64).required())
  username: string;
  @Rule(RuleType.string().max(128).required())
  password: string;
}
