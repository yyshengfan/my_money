import { bookCalc, okxDayPct } from '../src/service/crypto.service';

// ④ 合约挂单千档纯函数:名义合计/买盘占比/中间价/一档价差
describe('crypto.service 纯函数', () => {
  const mk = (bids: (number | string)[][], asks: (number | string)[][]) => ({ bids, asks });
  it('bookCalc 千档名义与占比', () => {
    // 买盘 100×1 + 99×2 = 298;卖盘 101×1 + 102×2 = 305
    const v = bookCalc(mk([[100, 1], [99, 2]], [[101, 1], [102, 2]]));
    expect(v!.bidUsd).toBeCloseTo(298);
    expect(v!.askUsd).toBeCloseTo(305);
    expect(v!.px).toBeCloseTo(100.5);
    expect(v!.bidPct).toBeCloseTo((298 / 603) * 100);
    expect(v!.spreadBp).toBeCloseTo((1 / 100.5) * 1e4);
  });
  it('bookCalc 空/坏盘口回 null(空簿、交叉盘、字符串数字可解析)', () => {
    expect(bookCalc(null)).toBeNull();
    expect(bookCalc(mk([], []))).toBeNull();
    expect(bookCalc(mk([['101', '1']], [['100', '1']]))).toBeNull(); // 卖一低于买一=交叉盘,视为坏数据
    expect(bookCalc(mk([['100', '1']], [['101', '1']]))).not.toBeNull(); // 字符串口径正常解析
  });
  it('okxDayPct 日K行(北京0点开盘)→ 日涨幅%;坏行 null', () => {
    // OKX candles 行=[ts,o,h,l,c,...],字符串价;开 100 现 103 → +3%
    expect(okxDayPct(['1', '100', '104', '99', '103'])).toBeCloseTo(3);
    expect(okxDayPct(['1', '100', '104', '99', '98'])).toBeCloseTo(-2);
    expect(okxDayPct(undefined as any)).toBeNull();
    expect(okxDayPct(['1', '0', '1', '1', '1'])).toBeNull(); // 开盘价 0 = 坏数据
    expect(okxDayPct(['1', '100', '104', '99', 'abc'])).toBeNull();
  });
});
