import { parseFFRows, mergeLedger, parseManual, kindOf, upcoming, fmtCn, fixEventZh } from '../src/service/events.service';

// 事件雷达纯函数单测(不联网):ForexFactory 周feed解析 / 台账合并 / 手动行 / 窗口 / 北京时区
const D = (s: string) => Date.parse(s); // 固定时刻,避免测试依赖 now

describe('events.service 纯函数', () => {
  it('parseFFRows 取字段、impact 缩写、坏行过滤', () => {
    const body = [
      { title: 'FOMC Rate Decision', country: 'USD', date: '2026-09-16T14:00:00-04:00', impact: 'High', forecast: '4.50%', previous: '4.25%', url: 'https://www.forexfactory.com/calendar/1-fomc' },
      { title: 'ECB Speech', country: 'EUR', date: '2026-09-17T03:00:00-04:00', impact: 'Medium', forecast: '', previous: '', url: 'https://www.forexfactory.com/calendar/2-ecb' },
      { title: 'NoDate Event', country: 'GBP', date: 'garbage', impact: 'Low', url: 'u3' },
    ];
    const rows = parseFFRows(body);
    expect(rows.length).toBe(2); // 坏日期行丢弃
    expect(rows[0]).toMatchObject({ en: 'FOMC Rate Decision', impact: 'H', ts: D('2026-09-16T18:00:00Z'), forecast: '4.50%' });
    expect(rows[1].impact).toBe('M');
    expect(() => parseFFRows('not array')).toThrow('非数组');
    expect(() => parseFFRows([{ title: 'x', date: 'bad' }])).toThrow('空');
  });

  it('mergeLedger 按 url 去重刷新、删过期(留上周8天)、窗尾40天', () => {
    const now = D('2026-09-14T00:00:00Z');
    const mk = (url: string, ts: number, previous = '') => ({ url, en: url, ts, impact: 'M' as const, country: 'USD', forecast: '', previous });
    const store = { a: mk('a', now + 864e5, 'old'), gone: mk('gone', now - 9 * 864e5), far: mk('far', now + 45 * 864e5) };
    const next = mergeLedger(store, [mk('a', now + 864e5, 'new'), mk('b', now + 2 * 864e5)], now);
    expect(Object.keys(next).sort()).toEqual(['a', 'b']); // gone 过期删、far 超40天删、b 新增
    expect(next.a.previous).toBe('new'); // 同事件刷新
    expect(next.b).toBeTruthy();
  });

  it('parseManual 北京时间字符串 + 08:00 解析', () => {
    const rows = parseManual([{ date: '2026-10-01 20:30', title: '某代币解锁', impact: 'High' }, { date: 'bad', title: 'x' }]);
    expect(rows.length).toBe(1);
    expect(rows[0].ts).toBe(D('2026-10-01T12:30:00Z'));
    expect(rows[0].impact).toBe('H');
  });

  it('kindOf 币种/标题规则判币圈,显式 kind 覆盖', () => {
    expect(kindOf({ country: 'BTC', en: 'Whale' })).toBe('crypto');
    expect(kindOf({ country: 'USD', en: 'BTC ETF Decision' })).toBe('crypto');
    expect(kindOf({ country: 'USD', en: 'FOMC Rate Decision' })).toBe('macro');
    expect(kindOf({ country: 'CRYPTO', en: 'LPR 报价', kind: 'macro' as any })).toBe('macro');
  });

  it('upcoming 滤LOW/超7天过去(上周仍保留)、并手动、按时间排、30天窗', () => {
    const now = D('2026-09-14T00:00:00Z');
    const mk = (url: string, ts: number, impact: 'H' | 'M' | 'L') => ({ url, en: url, ts, impact, country: 'USD', forecast: '', previous: '' });
    const store = { h: mk('h', now + 2 * 864e5, 'H'), l: mk('l', now + 864e5, 'L'), past: mk('p', now - 8 * 864e5, 'H'), p2: mk('p2', now - 2 * 864e5, 'H'), far: mk('f', now + 40 * 864e5, 'H') };
    const out = upcoming(store, [mk('m', now + 864e5, 'M')], now);
    expect(out.map(r => r.url)).toEqual(['p2', 'm', 'h']); // L/超7天过去/超窗排除,上周内(>now-7d)保留供回看,手动并入按 ts 排
  });

  it('fixEventZh:CAD 错译修正(BOC=加拿大央行非中国银行、Macklem 通译麦克莱姆;他币种不动)', () => {
    expect(fixEventZh('中国银行行长麦克勒姆讲话', 'CAD')).toBe('加拿大央行行长麦克莱姆讲话');
    expect(fixEventZh('中国银行公布贷款数据', 'CNY')).toBe('中国银行公布贷款数据'); // 真·中国银行不误伤
    expect(fixEventZh('美联储主席讲话', 'USD')).toBe('美联储主席讲话');
  });

  it('fixEventZh:选举类按 en 原题定名(2026-11-02 用户「怎么没有中期选举」:FF 译成「国会选举」)', () => {
    expect(fixEventZh('国会选举', 'USD', 'Congressional Elections')).toBe('美国中期选举');
    expect(fixEventZh('总统选举', 'USD', 'Presidential Election')).toBe('美国大选');
    expect(fixEventZh('国会选举', 'USD')).toBe('国会选举'); // 无原题不猜
  });

  it('fmtCn UTC ms → 北京 MM-DD HH:mm(跨日)', () => {
    expect(fmtCn(D('2026-09-16T18:00:00Z'))).toEqual({ day: '09-17', hh: '02:00' }); // FOMC 14:00 EDT
    expect(fmtCn(D('2026-09-04T12:30:00Z'))).toEqual({ day: '09-04', hh: '20:30' }); // NFP 08:30 EDT
  });
});
