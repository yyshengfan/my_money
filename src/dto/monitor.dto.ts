import { Rule, RuleType } from '@midwayjs/validate';

// 监控任务保存体(2026-10-18):五枚币全量提交(UI 每次把整个表单发来,服务端逐键合并)。
// 阈值 0.1~50%、窗口 1~240 分钟;webhook 地址不走这里(在 ~/.lark_webhook,永不入库入仓库)。
const taskSchema = RuleType.object({
  on: RuleType.boolean().required(),
  winMin: RuleType.number().integer().min(1).max(240).required(),
  quickPct: RuleType.number().min(0.1).max(50).required(),
  chgOn: RuleType.boolean().required(),
  chgPct: RuleType.number().min(0.1).max(50).required(),
  ampOn: RuleType.boolean().required(),
  ampPct: RuleType.number().min(0.1).max(50).required(),
});

export class MonitorSaveDTO {
  @Rule(RuleType.boolean().required())
  paused: boolean;
  @Rule(RuleType.boolean().required())
  recovery: boolean;
  // 键=五币代码 或 A股六位数字码(2026-10-19 扩 A股板块)
  @Rule(RuleType.object().pattern(/^(BTC|BNB|ETH|SOL|OKB|\d{6})$/, taskSchema).required())
  tasks: Record<string, any>;
  // ETF 暴量(2026-10-29):全局一套阈值,清单在 data/etf_watch.json
  @Rule(RuleType.object({
    on: RuleType.boolean().required(),
    ratio: RuleType.number().min(1).max(50).required(),
    minAmt: RuleType.number().min(0).max(2000).required(),
  }).optional())
  etf?: { on: boolean; ratio: number; minAmt: number };
}
