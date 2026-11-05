// 币圈异动监控纯函数单测(2026-10-18):北京日起算 / 1m 窗口涨跌 / 日内统计 / 状态机跃变去重 / Lark 判定与文案。
// 全部注入 nowMs,不碰网络不落盘(tick/status/推送那层是有壳的,不在这里测)。
import {
  beijingDayStart, quickChg, dayStats, evalTransitions, larkSendOk, larkText,
  parseWebhook, larkSign, aParse, bjYMD,
  tradedMin, etfParse, evalVol, etfText,
  KRow, MonitorCfg, TaskCfg, Reading, RuleState, EtfReading, EtfCfg,
} from '../src/service/monitor.service';

const mk = (startTs: number, closes: number[], span = 60_000): KRow[] =>
  closes.map((c, i) => ({ t: startTs + i * span, o: c, h: c * 1.001, l: c * 0.999, c }));

const TASK: TaskCfg = { on: true, winMin: 5, quickPct: 3, chgOn: true, chgPct: 5, ampOn: true, ampPct: 5 };
const cfgOf = (over: any = {}): MonitorCfg => ({
  paused: false, recovery: true,
  tasks: { BTC: { ...TASK, ...over }, BNB: { ...TASK }, ETH: { ...TASK }, SOL: { ...TASK }, OKB: { ...TASK } },
  etf: { on: true, ratio: 3, minAmt: 20 },
} as MonitorCfg);
const rd = (quick: number | null, chg: number | null, amp: number | null, price = 100): Reading =>
  ({ price, quick, day: chg == null && amp == null ? null : { open: price / (1 + (chg ?? 0) / 100), hi: 0, lo: 0, chg, amp } });

describe('monitor/北京日起算', () => {
  it('10-18 00:00 北京 = 10-17 16:00 UTC;边界前后各归各日', () => {
    const d0 = Date.UTC(2026, 9, 17, 16, 0, 0);
    expect(beijingDayStart(d0)).toBe(d0); // 恰是日界
    expect(beijingDayStart(d0 + 1)).toBe(d0);
    expect(beijingDayStart(d0 - 1)).toBe(d0 - 86400e3); // 差 1ms 属前一日
    expect(beijingDayStart(Date.UTC(2026, 9, 18, 1, 30))).toBe(d0); // 北京 09:30
  });
});

describe('monitor/quickChg', () => {
  it('末根收盘 vs 往前第 winMin 根收盘', () => {
    const rows = mk(0, [100, 100, 100, 100, 100, 100, 103.5]);
    expect(quickChg(rows, 5)).toBeCloseTo(3.5, 5);
  });
  it('预热不足(刚重启)回 null;基期价为 0 也回 null 不除零', () => {
    expect(quickChg(mk(0, [100, 101]), 5)).toBeNull();
    expect(quickChg([], 5)).toBeNull();
    expect(quickChg(mk(0, [0, 0, 1, 1, 1, 1, 1]), 5)).toBeNull();
  });
});

describe('monitor/dayStats', () => {
  it('只算北京日当天的 1H 根;涨跌用外部喂入的 1m 现价', () => {
    const day0 = beijingDayStart(Date.UTC(2026, 9, 18, 3, 0)); // 北京 10-18 11:00
    const rows = [
      { t: day0 - 3600e3, o: 90, h: 99, l: 88, c: 95 }, // 昨日的根,必须被滤掉
      { t: day0, o: 100, h: 106, l: 99, c: 104 },
      { t: day0 + 3600e3, o: 104, h: 112, l: 100, c: 108 },
    ];
    const d = dayStats(rows, day0, 108)!;
    expect(d.open).toBe(100);
    expect(d.chg).toBeCloseTo(8, 5);
    expect(d.amp).toBeCloseTo(13, 5); // (112−99)/100
  });
  it('当日起一根都没有 / 没现价 → null', () => {
    expect(dayStats([mk(0, [100], 3600e3)[0]].map(r => ({ ...r, t: -1 })), 0, 100)).toBeNull();
    expect(dayStats(mk(0, [100], 3600e3), 0, null)).toBeNull();
  });
});

describe('monitor/状态机跃变', () => {
  const S0: Record<string, RuleState> = {};
  const NOW = Date.UTC(2026, 9, 18, 3, 0);

  it('越限首推一次;持续越限不重推,只刷新读数', () => {
    const r = rd(3.2, 1, 1);
    const a = evalTransitions(S0, { BTC: r }, cfgOf(), NOW);
    expect(a.pushes.map(p => `${p.sym}.${p.rule}.${p.kind}`)).toEqual(['BTC.quick.fire']);
    const b = evalTransitions(a.state, { BTC: rd(4.1, 1, 1) }, cfgOf(), NOW + 60e3);
    expect(b.pushes).toHaveLength(0);
    expect(b.state['BTC.quick'].lastV).toBeCloseTo(4.1, 5);
    expect(b.state['BTC.quick'].ts).toBe(NOW); // 触发时刻不变
  });

  it('回落推恢复;recovery 关则静默转 ok', () => {
    let state = evalTransitions(S0, { BTC: rd(3.2, 1, 1) }, cfgOf(), NOW).state;
    const back = evalTransitions(state, { BTC: rd(0.4, 1, 1) }, cfgOf(), NOW + 31 * 60e3); // 过冷却窗才推
    expect(back.pushes.map(p => `${p.rule}.${p.kind}`)).toEqual(['quick.recover']);
    const noRec = cfgOf(); noRec.recovery = false;
    const s2 = evalTransitions(S0, { BTC: rd(3.2, 1, 1) }, noRec, NOW).state;
    const r2 = evalTransitions(s2, { BTC: rd(0.4, 1, 1) }, noRec, NOW + 31 * 60e3);
    expect(r2.pushes).toHaveLength(0);
    expect(r2.state['BTC.quick'].st).toBe('ok');
  });

  it('30 分钟冷却:同标的同规则抖动 fire→ok→fire 只推第一条(2026-11-03 用户要求)', () => {
    const a = evalTransitions(S0, { BTC: rd(3.2, 1, 1) }, cfgOf(), NOW);
    expect(a.pushes).toHaveLength(1);
    const b = evalTransitions(a.state, { BTC: rd(0.4, 1, 1) }, cfgOf(), NOW + 5 * 60e3); // 5min 回落 → 压住
    expect(b.pushes).toHaveLength(0);
    expect(b.state['BTC.quick'].st).toBe('ok');
    const c = evalTransitions(b.state, { BTC: rd(3.5, 1, 1) }, cfgOf(), NOW + 10 * 60e3); // 10min 再触发 → 压住
    expect(c.pushes).toHaveLength(0);
    expect(c.state['BTC.quick'].st).toBe('fire'); // 看板仍显示越限
    expect(c.state['BTC.quick'].lastP).toBe(NOW); // 冷却戳没被冲掉
    const d = evalTransitions(c.state, { BTC: rd(0.2, 1, 1) }, cfgOf(), NOW + 20 * 60e3);
    expect(d.pushes).toHaveLength(0);
    const e2 = evalTransitions(d.state, { BTC: rd(4.0, 1, 1) }, cfgOf(), NOW + 31 * 60e3); // 过 30min 才放行
    expect(e2.pushes.map(p => p.kind)).toEqual(['fire']);
  });
  it('冷却按规则独立:窗口触发不挡日内涨跌', () => {
    const a = evalTransitions(S0, { BTC: rd(3.2, 5.5, 1) }, cfgOf(), NOW);
    expect(a.pushes.map(p => p.rule).sort()).toEqual(['dayChg', 'quick']);
    const b = evalTransitions(a.state, { BTC: rd(0.1, 5.8, 1) }, cfgOf(), NOW + 5 * 60e3);
    expect(b.pushes).toHaveLength(0);
  });

  it('日内涨跌按绝对值双向触发;振幅恒正只看 ≥', () => {
    const down = evalTransitions(S0, { BTC: rd(null, -5.4, 1) }, cfgOf(), NOW);
    expect(down.pushes.map(p => p.rule)).toEqual(['dayChg']);
    const up = evalTransitions(S0, { BTC: rd(null, 5.4, 0.9) }, cfgOf(), NOW);
    expect(up.pushes.map(p => p.rule)).toEqual(['dayChg']);
    const amp = evalTransitions(S0, { BTC: rd(null, -1, 5.0) }, cfgOf(), NOW); // 恰好 = 阈值
    expect(amp.pushes.map(p => p.rule)).toEqual(['dayAmp']);
  });

  it('规则关/币关/无读数 → 清键不推;重新打开从 ok 起算(不补发)', () => {
    const cfg = cfgOf(); cfg.tasks.BTC.chgOn = false;
    const a = evalTransitions(S0, { BTC: rd(1, 9, 1) }, cfg, NOW);
    expect(a.pushes).toHaveLength(0);
    expect(a.state['BTC.dayChg']).toBeUndefined();
    // 币关 → 全键清
    const cfg2 = cfgOf(); cfg2.tasks.BTC.on = false;
    const fired = evalTransitions(S0, { BTC: rd(4, 4, 4) }, cfgOf(), NOW).state;
    const off = evalTransitions(fired, { BTC: rd(4, 4, 4) }, cfg2, NOW);
    expect(off.pushes).toHaveLength(0);
    expect(Object.keys(off.state).filter(k => k.startsWith('BTC.'))).toHaveLength(0);
    // 无读数(该币上游挂)→ 键清,恢复后不背旧异动
    const gap = evalTransitions(fired, { BTC: null }, cfgOf(), NOW);
    expect(gap.pushes).toHaveLength(0);
    expect(gap.state['BTC.quick']).toBeUndefined();
  });

  it('其他币不受影响(只动 BTC 的键)', () => {
    const { state } = evalTransitions(S0, { BTC: rd(3.2, 3.2, 3.2), ETH: rd(0.1, 0.1, 0.1) }, cfgOf(), NOW);
    expect(Object.keys(state)).toEqual(['BTC.quick']);
  });
});

describe('monitor/webhook 文件解析与加签', () => {
  it('裸一行 / 引号 / `webhook:` 标签粘贴(用户实贴格式)都能取到 URL', () => {
    const u = 'https://open.larksuite.com/open-apis/bot/v2/hook/aaaa-bbbb-cccc';
    expect(parseWebhook(u).url).toBe(u);
    expect(parseWebhook(`"${u}"\n`).url).toBe(u);
    expect(parseWebhook(`币圈小剧场\nwebhook: ${u}\nsign: SEC0123456789abcdef`).url).toBe(u);
  });
  it('sign:/secret: 行取密钥;webhook/url 行不误判;无 sign 回空串', () => {
    expect(parseWebhook('webhook: https://a.cn/h/x\nsign: SEC0123456789abcdef').secret).toBe('SEC0123456789abcdef');
    expect(parseWebhook('密钥： mysecretvalue123\nhttps://a.cn/h/x').secret).toBe('mysecretvalue123');
    expect(parseWebhook('webhook: https://a.cn/h/x').secret).toBe('');
    expect(parseWebhook('随便一行文字').url).toBe('');
  });
  it('## 分段(2026-10-19 两群同文件):tag 命中段取段内 url/sign,段不匹配回空、无标题段整文件兜底', () => {
    const f = '## 币圈小剧场\nhttps://a.cn/h/cry\nsign: SECcry123456789\n\n## A股大舞台\nhttps://a.cn/h/ast\n';
    expect(parseWebhook(f, '币圈')).toEqual({ url: 'https://a.cn/h/cry', secret: 'SECcry123456789' });
    expect(parseWebhook(f, 'A股')).toEqual({ url: 'https://a.cn/h/ast', secret: '' });
    expect(parseWebhook(f, '港股')).toEqual({ url: '', secret: '' }); // 有分段但无此段→宁缺勿假,不串群
    expect(parseWebhook('https://a.cn/h/plain', 'A股').url).toBe('https://a.cn/h/plain'); // 无标题=旧单群格式
  });
  it('多组粘贴取首组;加签=base64、随 timestamp 变(飞书 key=ts+\\n+secret 空消息 HMAC)', () => {
    const p = parseWebhook('webhook: https://a.cn/h/one\nsign: s3cretvalue123\nwebhook: https://a.cn/h/two\nsign: other123456789');
    expect(p.url.endsWith('/one')).toBe(true);
    expect(p.secret).toBe('s3cretvalue123');
    const a = larkSign(1700000000, 'sec');
    expect(/^[A-Za-z0-9+/=]{40,}$/.test(a)).toBe(true);
    expect(larkSign(1700000001, 'sec')).not.toBe(a);
    expect(larkSign(1700000000, 'sec')).toBe(a);
  });
});

describe('monitor/A股 minute query 解析(2026-10-19)', () => {
  // 腾讯回包最小形:qt 行同 qt.gtimg.cn 列位(1名 3现价 5今开 30时间 33高 34低),分钟行 "HHmm 价 量 额"
  const mkJ = (date8: string, mins: string[]) => {
    const q = new Array(36).fill('0');
    q[1] = '南山铝业'; q[3] = '4.40'; q[4] = '4.33'; q[5] = '4.32'; q[30] = date8 + '150000'; q[33] = '4.45'; q[34] = '4.30';
    return { data: { sh600219: { qt: { sh600219: q }, data: { date: date8, data: mins } } } };
  };
  const TODAY = '20261019';
  it('今日盘 → 现价/窗口涨跌/日内涨跌与振幅', () => {
    const mins = ['0930 4.32 100 1', '0931 4.34 200 1', '0932 4.33 300 1', '0933 4.36 400 1', '0934 4.38 500 1', '0935 4.40 600 1'];
    const r = aParse(mkJ(TODAY, mins), 'sh600219', 5, TODAY)!;
    expect(r.price).toBeCloseTo(4.4, 5);
    expect(r.quick).toBeCloseTo((4.4 - 4.32) / 4.32 * 100, 5); // 末根 vs 往前5根
    expect(r.day!.chg).toBeCloseTo((4.4 - 4.32) / 4.32 * 100, 5);
    expect(r.day!.amp).toBeCloseTo((4.45 - 4.3) / 4.32 * 100, 5);
  });
  it('盘口时间戳非北京今日(周末/节假日/盘前)→ 整只 null 不判定', () => {
    expect(aParse(mkJ('20261018', ['0930 4.32 1 1']), 'sh600219', 5, TODAY)).toBeNull();
    expect(aParse(null, 'sh600219', 5, TODAY)).toBeNull();
    expect(aParse(mkJ(TODAY, []), 'sz999999', 5, TODAY)).toBeNull(); // 无该 code 块
  });
  it('分钟预热不足 → quick null,日内照算;bjYMD 北京日界', () => {
    const r = aParse(mkJ(TODAY, ['0930 4.32 1 1', '0931 4.34 2 1']), 'sh600219', 5, TODAY)!;
    expect(r.quick).toBeNull();
    expect(r.day!.chg).toBeCloseTo((4.4 - 4.32) / 4.32 * 100, 5);
    expect(bjYMD(Date.UTC(2026, 9, 18, 16, 30))).toBe('20261019'); // UTC 16:30 = 北京次日 00:30
    expect(bjYMD(Date.UTC(2026, 9, 18, 15, 30))).toBe('20261018');
  });
  it('A股异动文案=「A股异动」签+中文名+¥;状态机认六位码', () => {
    const rdA = (): Reading => ({ price: 4.4, quick: 3.3, day: { open: 4.32, hi: 4.45, lo: 4.3, chg: 1.85, amp: 3.5 } });
    const s = larkText({ sym: '600219', rule: 'quick', kind: 'fire', val: 3.3, thr: 3, r: rdA() }, TASK, Date.UTC(2026, 9, 18, 3, 22));
    expect(s).toContain('【A股异动】南山铝业(600219)');
    expect(s).toContain('现价 ¥4.40');
    const cfgA = cfgOf(); cfgA.tasks['600219'] = { ...TASK };
    const { pushes, state } = evalTransitions({}, { '600219': rdA() }, cfgA, Date.UTC(2026, 9, 18, 3, 22));
    expect(pushes.map(p => `${p.sym}.${p.rule}`)).toEqual(['600219.quick']);
    expect(state['600219.quick'].st).toBe('fire');
    // 手搓 cfg 没有 A股键(旧文件/单测)→ 不炸不判
    expect(evalTransitions({}, { '600219': rdA() }, cfgOf(), Date.UTC(2026, 9, 18, 3, 22)).pushes).toHaveLength(0);
  });
});

describe('monitor/Lark 判定与文案', () => {
  it('飞书 {code:0} 与 Lark {StatusCode:0} 都算成功', () => {
    expect(larkSendOk({ code: 0, msg: 'success' })).toBe(true);
    expect(larkSendOk({ StatusCode: 0 })).toBe(true);
    expect(larkSendOk({ code: 19001 })).toBe(false);
    expect(larkSendOk(null)).toBe(false);
  });
  it('文案带符号不双负号,恢复/振幅各有式样', () => {
    const fire = larkText({ sym: 'BTC', rule: 'quick', kind: 'fire', val: -3.21, thr: 3, r: rd(-3.21, 0, 0, 64321) }, TASK, Date.UTC(2026, 9, 18, 3, 22));
    expect(fire).toContain('急跌 -3.21%');
    expect(fire).not.toContain('--');
    expect(fire).toContain('现价 $64321');
    const amp = larkText({ sym: 'SOL', rule: 'dayAmp', kind: 'fire', val: 5.4, thr: 5, r: { price: 200, quick: null, day: { open: 190, hi: 205, lo: 195, chg: 0, amp: 5.4 } } }, TASK, Date.UTC(2026, 9, 18, 3, 22));
    expect(amp).toContain('日内振幅 5.4%');
    const rec = larkText({ sym: 'OKB', rule: 'dayChg', kind: 'recover', val: 1.2, thr: 5, r: rd(null, 1.2, 1) }, TASK, Date.UTC(2026, 9, 18, 3, 22));
    expect(rec).toContain('【回落恢复】');
    expect(rec).toContain('10-18 11:22'); // 北京时间格式化
  });
});

describe('monitor/ETF 暴量', () => {
  const EF: EtfCfg = { on: true, ratio: 3, minAmt: 20 };
  const LIST = [{ sym: '510300', name: '沪深300ETF华泰柏瑞' }];
  const er = (ratio: number | null, amtYi: number | null, min = 60): EtfReading =>
    ({ name: '沪深300ETF华泰柏瑞', price: 4.12, chgPct: -0.77, amtYi, ratio, min });
  const T0 = Date.UTC(2026, 9, 29, 6, 31); // 北京 14:31

  it('已交易分钟:盘前 0 / 上午 / 午休 120 / 下午满 240', () => {
    expect(tradedMin(925)).toBe(0);
    expect(tradedMin(930)).toBe(0);
    expect(tradedMin(1030)).toBe(60);
    expect(tradedMin(1130)).toBe(120);
    expect(tradedMin(1200)).toBe(120);
    expect(tradedMin(1300)).toBe(120);
    expect(tradedMin(1431)).toBe(211);
    expect(tradedMin(1530)).toBe(240);
  });

  it('etfParse:时间戳非北京今日 → null(休市不拿旧行情误报);金额万→亿', () => {
    const rows: any = { sh510300: { name: '300ETF', price: 4.12, chgPct: -0.77, amountWan: 390876, volRatio: 0.45, time: '20261029143158' } };
    const r = etfParse(rows, 'sh510300', '20261029')!;
    expect(r.amtYi).toBeCloseTo(39.0876, 4);
    expect(r.ratio).toBe(0.45);
    expect(r.min).toBe(211);
    expect(etfParse(rows, 'sh510300', '20261030')).toBeNull();
    expect(etfParse({}, 'sh510300', '20261029')).toBeNull();
  });

  it('evalVol:越限触发一次、持续不重推、回落报恢复;金额门槛兜底', () => {
    const a = evalVol({}, { '510300': er(3.4, 25) }, EF, LIST, T0);
    expect(a.pushes.map(p => p.kind)).toEqual(['fire']);
    expect(a.state['510300.vol'].st).toBe('fire');
    // 同一天继续暴量:不重推
    const b = evalVol(a.state, { '510300': er(5.1, 40) }, EF, LIST, T0 + 60_000);
    expect(b.pushes).toHaveLength(0);
    expect(b.state['510300.vol'].lastV).toBe(5.1);
    // 量比掉回阈值下但仍在 30 分钟冷却内 = 压住不推,状态照常转 ok
    const c0 = evalVol(b.state, { '510300': er(1.2, 40) }, EF, LIST, T0 + 120_000);
    expect(c0.pushes).toHaveLength(0);
    expect(c0.state['510300.vol'].st).toBe('ok');
    // 过冷却窗后的回落才推
    const c = evalVol(b.state, { '510300': er(1.2, 40) }, EF, LIST, T0 + 31 * 60e3);
    expect(c.pushes.map(p => p.kind)).toEqual(['recover']);
    // 量比够但金额不够 20 亿(小 ETF 噪声)→ 不判
    expect(evalVol({}, { '510300': er(6, 5) }, EF, LIST, T0).pushes).toHaveLength(0);
    // 开盘 20 分钟内量比失真 → 不判
    expect(evalVol({}, { '510300': er(9, 30, 8) }, EF, LIST, T0).pushes).toHaveLength(0);
    // 总开关关 → 清态不推
    expect(evalVol({}, { '510300': er(9, 30) }, { ...EF, on: false }, LIST, T0).pushes).toHaveLength(0);
  });

  it('evalVol:跨日清零(昨天的 fire 不压住今天第一波)', () => {
    const y = evalVol({}, { '510300': er(4, 30) }, EF, LIST, T0 - 86400e3);
    expect(y.state['510300.vol'].st).toBe('fire');
    const t = evalVol(y.state, { '510300': er(4, 30) }, EF, LIST, T0);
    expect(t.pushes.map(p => p.kind)).toEqual(['fire']); // 今天重新报
  });

  it('etfText:暴量/回落各有式样,价格 3 位小数、金额亿元', () => {
    const f = etfText({ sym: '510300', kind: 'fire', val: 3.42, thr: 3, r: er(3.42, 128.6) }, T0);
    expect(f).toContain('【ETF暴量】沪深300ETF华泰柏瑞(510300)');
    expect(f).toContain('量比 3.42×(阈值 3)');
    expect(f).toContain('成交额 128.6亿');
    expect(f).toContain('现价 ¥4.120');
    const r = etfText({ sym: '510300', kind: 'recover', val: 1.1, thr: 3, r: er(1.1, 30) }, T0);
    expect(r).toContain('【ETF量能回落】');
  });
});
