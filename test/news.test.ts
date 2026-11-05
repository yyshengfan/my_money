import { normNewsTitle, dedupeNews } from '../src/util/news';

// 新闻跨源去重纯函数(用户 2026-09-23 反馈:央行逆回购一条被 4 家媒体刷屏)
describe('util/news dedupeNews', () => {
  it('归一化:去标点空格括号、英文小写,只留中文和数字字母', () => {
    expect(normNewsTitle('【央行 今日,开展 80亿元 7天逆回购操作】wind')).toBe(
      '央行今日开展80亿元7天逆回购操作wind'
    );
    expect(normNewsTitle('')).toBe('');
  });
  it('同事件近义改写并成一条,保留首见(=时间倒序的最新)', () => {
    const titles = [
      '央行今日开展80亿元7天期逆回购操作', // 最新,保留
      '央行公开市场开展80亿元7天期逆回购操作，操作利率1.40%。Wind数据显示，今日1100亿元逆回购到期。',
      '【央行今日开展80亿元7天逆回购操作】9月23日消息，央行今日开展80亿元7天逆回购操作，操作利率为1.40%，与此前持平。',
      '央行今日开展80亿元7天逆回购操作，操作利率为1.40%，与此前持平',
      '沪指涨0.8% 两市成交额超2.5万亿', // 另一事件,须留下
    ];
    const rows = titles.map((title, i) => ({ title, i }));
    const out = dedupeNews(rows);
    expect(out.map(r => r.i)).toEqual([0, 4]);
  });
  it('数字不同的同类操作不误并(80亿 vs 1000亿)', () => {
    const rows = [
      { title: '央行今日开展80亿元7天期逆回购操作' },
      { title: '央行今日开展1000亿元7天期逆回购操作' },
    ];
    expect(dedupeNews(rows).length).toBe(2);
  });
  it('英文标题同题重复可识别;无标题行原样放行', () => {
    const rows = [
      { title: 'Bitcoin ETF Sees $300M Inflows As Price Reclaims 110K' },
      { title: 'Bitcoin ETF sees $300M in flows as price reclaims $110K' },
      { title: 'Ethereum L2 Upgrade Goes Live' },
      { i: 9 },
    ];
    const out = dedupeNews(rows as any[]);
    expect(out).toHaveLength(3);
    expect(out).toContainEqual({ i: 9 });
  });
});
