import { numOf, mxMdTable, mxStockRows, mxNewsRows, valueScore, ddFrom52, stabOk } from '../src/service/mx.service';

// mx.service 的纯解析逻辑(Markdown 表 partialResults 路 + columns/dataList 路 + 资讯归一),无需网络与容器
// 样例表头/数值取自 2026-09-08 探针真实返回(MX stock-screen)。
describe('mx.service 纯函数', () => {
  it('numOf 归一单位与千分位,占位符回 null', () => {
    expect(numOf('8.78亿')).toBeCloseTo(8.78e8, 0);
    expect(numOf('1.2万')).toBe(12000);
    expect(numOf('34.12')).toBeCloseTo(34.12, 6);
    expect(numOf('3.80')).toBeCloseTo(3.8, 6);
    expect(numOf('1,234')).toBe(1234);
    expect(numOf('-')).toBeNull();
    expect(numOf('—')).toBeNull();
    expect(numOf(null)).toBeNull();
  });

  it('mxMdTable 解 partialResults Markdown 表(表头匹配中文列)', () => {
    const md = [
      '|序号|代码|名称|最新价(元)(13:22)|涨跌幅(%)(13:22)|主力净额(不含暗盘)(元)(2026.09.08)|量比(13:22)|证券类型|',
      '|---|---|---|---|---|---|---|---|',
      '|1|601899|紫金矿业|34.12|3.80|8.78亿|1.80|A股|',
      '|2|603993|洛阳钼业|19.09|3.92|6.27亿|2.13|A股|',
    ].join('\n');
    const { headers, rows } = mxMdTable(md);
    expect(headers.length).toBeGreaterThanOrEqual(8);
    expect(rows.length).toBe(2);
    expect(rows[0].code).toBe('601899');
    expect(rows[0].name).toBe('紫金矿业');
    expect(rows[0].price).toBeCloseTo(34.12, 6);
    expect(rows[0].pct).toBeCloseTo(3.8, 6);
    expect(rows[0].volRatio).toBeCloseTo(1.8, 6);
    expect(rows[0].mainNet).toBeCloseTo(8.78e8, 0);
    expect(rows[1].code).toBe('603993');
    // 表头里无"行业/市盈"列 → 该字段留 null,绝不造假
    expect(rows[0].ind).toBeNull();
    expect(rows[0].pe).toBeNull();
  });

  it('mxStockRows 走 columns+dataList 路(字段名→展示名对齐)', () => {
    const columns = [
      { field: 'f12', displayName: '代码' },
      { field: 'f14', displayName: '名称' },
      { field: 'f2', displayName: '最新价(元)' },
      { field: 'f3', displayName: '涨跌幅(%)' },
      { field: 'f10', displayName: '量比' },
    ];
    const list = [{ f12: '600519', f14: '贵州茅台', f2: '1420.50', f3: '-0.40', f10: '0.9' }];
    const rows = mxStockRows(list, columns as any);
    expect(rows.length).toBe(1);
    expect(rows[0].code).toBe('600519');
    expect(rows[0].price).toBeCloseTo(1420.5, 6);
    expect(rows[0].pct).toBeCloseTo(-0.4, 6);
  });

  it('mxNewsRows 映射成与东财资讯同形状并贴标', () => {
    const list = [
      { title: '央行开展逆回购操作', content: '  今日 央行 开展 3000 亿逆回购  ', date: '2026-09-08 09:15', source: 'MX快讯', informationType: 'NEWS' },
      { title: '某公司回购股份', date: '2026-09-08 10:00', jumpUrl: 'https://x', source: 'MX' },
    ];
    const rows = mxNewsRows(list);
    expect(rows.length).toBe(2);
    expect(rows[0].title).toBe('央行开展逆回购操作');
    expect(rows[0].summary.replace(/\s+/g, ' ')).toContain('逆回购');
    expect(rows[0].tag).toBe('政策');
    expect(rows[1].tag).toBe('公司');
    expect(rows[1].url).toBe('https://x');
  });
});

// ---------- ③ 价值投资派:基本面列解析 + 打分(2026-09 两派改造) ----------
describe('mx.service 价值派纯函数', () => {
  it('columns 路解析基本面中文表头', () => {
    const columns = [
      { title: '市场代码简称', key: 'MKT' }, // SH/SZ 列必须被丢弃,不得污染 code(2026-09 实测回归)
      { title: '证券代码', key: 'SECURITY_CODE' }, { title: '股票简称', key: 'SECURITY_SHORT_NAME' },
      { title: '日线不复权收盘价(元)', key: 'P' }, { title: '涨跌幅(%)', key: 'CHG' },
      { title: '市盈率TTM(倍)', key: 'PE' }, { title: '市净率(倍)', key: 'PB' },
      { title: '年度股息率(%)', key: 'DVD' }, { title: '净资产收益率ROE(加权)(%)', key: 'ROE' },
      { title: '销售毛利率(%)', key: 'GM' }, { title: '扣非净利润同比增长(%)', key: 'DED' },
      { title: '资产负债率(%)', key: 'DBT' }, { title: '区间最高价(日线不复权)', key: 'H52' }, // MX 实测列名,非「52周最高价」
      { title: '所属行业', key: 'IND' },
    ];
    const list = [{
      SECURITY_CODE: '600519', SECURITY_SHORT_NAME: '贵州茅台', P: '1285.13', CHG: '-0.44',
      PE: '19.2', PB: '7.9', DVD: '3.6', ROE: '28.5', GM: '91.8', DED: '12.1', DBT: '20.3', H52: '1780.0', IND: '白酒',
    }];
    const [r] = mxStockRows(list, columns);
    expect(r.code).toBe('600519');
    expect(r.pe).toBeCloseTo(19.2, 6);
    expect(r.dvd).toBeCloseTo(3.6, 6);
    expect(r.roe).toBeCloseTo(28.5, 6);
    expect(r.gross).toBeCloseTo(91.8, 6);
    expect(r.dedtYoy).toBeCloseTo(12.1, 6);
    expect(r.debt).toBeCloseTo(20.3, 6);
    expect(r.hi52).toBeCloseTo(1780, 6);
    expect(r.ind).toBe('白酒');
  });

  it('ddFrom52:高点回撤 %;缺价/缺高点 → null', () => {
    const mk = (price: number | null, hi52: number | null) => ({ ...({} as any), price, hi52 });
    expect(ddFrom52(mk(80, 100) as any)).toBeCloseTo(20, 6);
    expect(ddFrom52(mk(null, 100) as any)).toBeNull();
    expect(ddFrom52(mk(80, 0) as any)).toBeNull();
  });

  it('valueScore:质地40+估值30+错杀30,缺项记0分不臆造', () => {
    const full = {
      code: '1', name: 'A', price: 10, pct: 0, amount: null, turn: null, pe: 12, volRatio: null,
      mcap: null, pb: 2.5, mainNet: null, ind: 'x', dvd: 3.8, roe: 18, gross: 35, dedtYoy: 9, debt: 42, hi52: 13.5,
    } as any; // 回撤 (13.5-10)/13.5 ≈ 25.9% → 12 分;总 15+10+10+5 +10+8+12 +12 = 82
    expect(valueScore(full)).toBe(82);
    expect(valueScore({ ...full, hi52: 14.3 })).toBe(90); // 回撤30% → 20 分
    const blanks = { code: '2', name: 'B', price: null, pct: null, amount: null, turn: null, pe: null, volRatio: null, mcap: null, pb: null, mainNet: null, ind: null, dvd: null, roe: null, gross: null, dedtYoy: null, debt: null, hi52: null } as any;
    expect(valueScore(blanks)).toBe(0);
    expect(valueScore({ ...full, price: 10, hi52: 10.5 })).toBe(70); // 回撤4.8% → 错杀0分
  });

  it('stabOk:企稳回升=站回MA20 且 近20日涨幅>0;缺数据不算达标', () => {
    expect(stabOk({ aboveMa20: true, chg20: 3 })).toBe(true);
    expect(stabOk({ aboveMa20: false, chg20: 8 })).toBe(false); // 涨了但没站回线
    expect(stabOk({ aboveMa20: true, chg20: -1 })).toBe(false); // 站线但近期整体在跌
    expect(stabOk({ aboveMa20: true, chg20: null })).toBe(false);
    expect(stabOk(null)).toBe(false);
  });
});
