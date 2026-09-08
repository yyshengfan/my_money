import { stripJsonp, num, parseBreadth, emBoardRow, emStockRow, emPoolRow } from '../src/service/market.service';

// market.service 的纯解析/规整逻辑,不碰 Midway 容器与网络,单测无需启动应用
describe('market.service 纯函数', () => {
  it('stripJsonp 解开 cb({...});', () => {
    expect(stripJsonp('cb({"rc":0});')).toBe('{"rc":0}');
    expect(stripJsonp('cb({"a":1})')).toBe('{"a":1}');
    expect(stripJsonp('jQuery3512_cb({"a":1})')).toBe('{"a":1}');
    expect(stripJsonp('   {"a":1}   ').trim()).toBe('{"a":1}'); // 已是纯 JSON 原样
  });

  it('num 拒绝占位符,永不吐 NaN', () => {
    expect(num('12.5')).toBe(12.5);
    expect(num('-')).toBeNull();
    expect(num('')).toBeNull();
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num('abc')).toBeNull();
    expect(Number.isFinite(num('-'))).toBe(false); // null 而非 NaN
  });

  it('parseBreadth 汇总沪深涨跌平与上涨占比', () => {
    const j = {
      data: {
        diff: [
          { f12: '000001', f104: 1287, f105: 982, f106: 86 },
          { f12: '399001', f104: 1785, f105: 1046, f106: 98 },
        ],
      },
    };
    const b = parseBreadth(j);
    expect(b.sh).toEqual({ up: 1287, down: 982, flat: 86 });
    expect(b.sz.up).toBe(1785);
    expect(b.up).toBe(1287 + 1785);
    expect(b.down).toBe(982 + 1046);
    expect(b.flat).toBe(86 + 98);
    expect(b.ratio).toBeCloseTo((1287 + 1785) / (1287 + 1785 + 982 + 1046), 6);
    // 缺某市场不炸:ratio 用已有数
    const b2 = parseBreadth({ data: { diff: [{ f12: '000001', f104: 10, f105: 10, f106: 0 }] } });
    expect(b2.sz.up).toBeNull();
    expect(b2.up).toBe(10);
  });

  it('emBoardRow 规整板块行', () => {
    const r = emBoardRow({ f12: 'BK1340', f14: '印制电路板', f3: 7.6, f62: 13370972672.0, f184: 13.62 });
    expect(r).toEqual({ code: 'BK1340', name: '印制电路板', pct: 7.6, mainNet: 13370972672, mainPct: 13.62 });
  });

  it('emStockRow 规整全A个股行(量比占位符 "-" 落 null)', () => {
    const r = emStockRow({
      f2: 83.45, f3: 33.2, f6: 1537346026, f8: 70.32, f9: 30.77, f10: '-',
      f12: '603448', f14: 'N天博', f20: 10014000000, f23: 2.71, f62: 388707340, f100: '汽车零部件',
    });
    expect(r.price).toBe(83.45);
    expect(r.pct).toBe(33.2);
    expect(r.volRatio).toBeNull(); // 上市首日量比 "-"
    expect(r.pe).toBe(30.77);
    expect(r.ind).toBe('汽车零部件');
  });

  it('emPoolRow 规整涨停池行(price×1000 → 不换算,直接给源值;连板与主力净流入字段映射)', () => {
    const r = emPoolRow({
      c: '002702', m: 0, n: '海欣食品', p: 6170, zdp: 9.98, amount: 58082776,
      hs: 2.05, lbc: 2, fbt: 92500, fund: 160765273, hybk: '食品加工',
    });
    expect(r).toEqual({
      code: '002702', name: '海欣食品', pct: 9.98, mainNet: 160765273,
      amount: 58082776, hs: 2.05, lb: 2, board: '食品加工',
    });
  });
});
