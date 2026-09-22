import { parseTencent, quoteCode } from '../src/service/qt.service';

// qt 是纯解析/映射逻辑,不碰 Midway 容器,单测无需启动应用与数据库
describe('qt.service', () => {
  const mkLine = (over: Record<number, string>) => {
    const f = new Array(78).fill('0');
    Object.assign(f, over);
    return f.join('~');
  };

  it('解析腾讯行情行(固定列位)', () => {
    const text =
      'v_sh600036="' +
      mkLine({
        1: '招商银行',
        3: '33.50',
        4: '33.40',
        5: '33.45',
        30: '20260904150000',
        31: '0.10',
        32: '0.30',
        33: '33.62',
        34: '33.30',
      }) +
      '";\n';
    const out = parseTencent(text);
    expect(out.sh600036).toEqual({
      name: '招商银行',
      price: 33.5,
      prevClose: 33.4,
      open: 33.45,
      time: '20260904150000',
      chg: 0.1,
      chgPct: 0.3,
      high: 33.62,
      low: 33.3,
    });
  });

  it('脏行跳过:短行/无行都不产出', () => {
    expect(parseTencent('v_bad="1~2~3";\n')).toEqual({});
    expect(parseTencent('')).toEqual({});
    expect(parseTencent('not a quote file')).toEqual({});
  });

  it('PE/PB 列位:A股 f39/f46、港股 f51(PE)无 PB;0/非数丢弃', () => {
    const a = parseTencent('v_sh600036="' + mkLine({ 1: '招商银行', 39: '6.75', 46: '0.89' }) + '";\n').sh600036;
    expect(a.pe).toBe(6.75);
    expect(a.pb).toBe(0.89);
    const hk = parseTencent('v_hk02331="' + mkLine({ 1: '李宁', 51: '13.32', 46: 'LI NING' }) + '";\n').hk02331;
    expect(hk.pe).toBe(13.32); // 实测港股 PE 在 f51,列位与 A股不同
    expect(hk.pb).toBeUndefined();
    const z = parseTencent('v_sh600000="' + mkLine({ 1: 'X', 39: '0', 46: '-' }) + '";\n').sh600000;
    expect(z.pe).toBeUndefined();
    expect(z.pb).toBeUndefined();
  });

  it('持仓行 → 腾讯代码前缀', () => {
    expect(quoteCode('600219', 'A股·沪')).toBe('sh600219');
    expect(quoteCode('688981', 'A股·沪')).toBe('sh688981');
    expect(quoteCode('000858', 'A股·深')).toBe('sz000858');
    expect(quoteCode('300760', 'A股·深')).toBe('sz300760');
    expect(quoteCode('02331', '港股')).toBe('hk02331');
    expect(quoteCode('09626', '港股')).toBe('hk09626');
  });
});
