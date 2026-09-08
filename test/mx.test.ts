import { numOf, mxMdTable, mxStockRows, mxNewsRows } from '../src/service/mx.service';

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
