import { Rule, RuleType } from '@midwayjs/validate';

// 定时任务操作体(2026-10-19):label 必须是 com.tianhui.* 且存在于 somejob/jobs.json 清单(服务端二次白名单校验);
// 时间严格两位 HH:MM。这里只是格式闸,清单白名单在 jobs.service。
const labelRule = RuleType.string().pattern(/^com\.tianhui\.[\w-]+$/).required();

export class JobLabelDTO {
  @Rule(labelRule)
  label: string;
}

export class JobSaveDTO {
  @Rule(labelRule)
  label: string;
  @Rule(RuleType.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).required())
  at: string;
}

export class JobToggleDTO {
  @Rule(labelRule)
  label: string;
  @Rule(RuleType.boolean().required())
  on: boolean;
}
