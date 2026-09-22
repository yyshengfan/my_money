import { parseSinaDays, parseSinaUsDays, parseTsy10, chgOf } from '../src/service/macro.service';

// 全球宏观源的解析纯函数单测(不联网):新浪美股日K(.NDX) / 新浪期货JSONP / 财政部CSV / 30日窗口
describe('macro.service 纯函数', () => {
  it('parseSinaUsDays 取 .NDX 日K {d,c} 尾部 n 行', () => {
    const text = `/*<script>location.href='//sina.com';</script>*/ var t=([{"d":"2026-09-09","c":"29000.1"},{"d":"2026-09-10","c":"29103.51"},{"d":"2026-09-11","c":"29368.44"}]);`;
    expect(parseSinaUsDays(text, 2)).toEqual([
      { t: '2026-09-10', c: 29103.51 },
      { t: '2026-09-11', c: 29368.44 },
    ]);
    expect(() => parseSinaUsDays('var t=(null);')).toThrow('美股日K');
  });

  it('parseSinaDays 剥 JSONP 壳并只留尾部 n 行', () => {
    const rows = [1, 2, 3, 4].map(i => `{"date":"2026-09-0${i}","close":"${4300 + i}"}`).join(',');
    const text = `/*<script>location.href='//sina.com';</script>*/ var t=([${rows}]);`;
    expect(parseSinaDays(text, 2)).toEqual([
      { t: '2026-09-03', c: 4303 },
      { t: '2026-09-04', c: 4304 },
    ]);
    expect(() => parseSinaDays('var t=(null);')).toThrow('新浪日K');
  });

  it('parseTsy10 按表头列位取 10Y、滤 --、日期转 YYYY-MM-DD', () => {
    // 真实 CSV 按日期降序(新→旧),解析必须重排成升序,slice(-n) 才取到最近段
    const csv = [
      'Date,"1 Mo","10 Yr","30 Yr"',
      '09/11/2026,3.93,--,4.90',
      '09/10/2026,3.90,4.60,4.88',
      '1/2/2026,3.50,4.10,4.30',
    ].join('\n');
    const out = parseTsy10(csv, 35);
    expect(out).toEqual([
      { t: '2026-01-02', c: 4.1 },
      { t: '2026-09-10', c: 4.6 },
    ]);
    expect(() => parseTsy10('Date,"1 Mo"\n09/10/2026,3.9')).toThrow('无10Y列');
  });

  it('chgOf 以距末日≤30自然日的首个点为基准', () => {
    const s = [
      { t: '2026-08-01', c: 100 }, // 早于窗口(末日 09-10 往前30天=08-11),不算基准
      { t: '2026-08-20', c: 104 },
      { t: '2026-09-10', c: 110 },
    ];
    const { pct, bp } = chgOf(s);
    expect(pct).toBe(+(((110 / 104) - 1) * 100).toFixed(2));
    expect(bp).toBe(600);
    expect(chgOf([{ t: '2026-09-10', c: 1 }])).toEqual({ pct: null, bp: null });
  });
});
