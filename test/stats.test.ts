import { applyLike, blank, hashIp, LIKE_BASE, StatsService } from '../src/service/stats.service';

// 浏览计数在 MySQL stat_view(建表见 data/mysql.sql),测试用桩库复刻 UNIQUE(page,ip)+ON DUPLICATE 语义;
// 点赞台账仍是纯函数 + data/stats.json。真实 SQL 语义在库上冒烟验证过(2026-09-20)。
const stubDb = (rows: Record<string, number>) => ({
  query: async (sql: string, p: unknown[] = []) => {
    if (/^INSERT/.test(sql.trim())) {
      const k = `${p[0]}|${p[1]}`;
      rows[k] = (rows[k] || 0) + 1;
      return [];
    }
    const v = Object.entries(rows).reduce((a, [k, n]) => (k.split('|')[0] === p[0] ? a + n : a), 0);
    return [{ v }];
  },
});

describe('stats 台账', () => {
  it('点赞:同一人永久一次,不同人各加一', () => {
    let { next, changed } = applyLike({}, 'hub', 'a');
    expect(changed).toBe(true);
    next = applyLike(next, 'hub', 'b').next;
    expect(applyLike(next, 'hub', 'a').changed).toBe(false);
    expect(next.hub.likes).toBe(2);
  });

  it('浏览:每次打开 stat_view 对应 IP +1,总浏览量 = 所有 IP 之和', async () => {
    const svc = new StatsService();
    (svc as any).file = '/tmp/stats_test_' + Date.now() + '.json';
    const rows: Record<string, number> = {};
    (svc as any).db = stubDb(rows);
    expect((await svc.get('hub')).views).toBe(0);
    await svc.view('hub', '1.2.3.4');
    await svc.view('hub', '1.2.3.4');
    await svc.view('hub', '9.9.9.9');
    expect((await svc.get('hub')).views).toBe(3); // 1.2.3.4 两次 + 9.9.9.9 一次
    expect((await svc.get('stock')).views).toBe(0); // 分页面互不混
    await svc.view('stock', '8.8.8.8');
    expect((await svc.get('stock')).views).toBe(1);
    expect((await svc.get('hub')).views).toBe(3);
  });

  it('展示 = 基数 88 + 真实点赞;挂库时浏览用最后一次读数兜底', async () => {
    const svc = new StatsService();
    (svc as any).file = '/tmp/stats_test_' + Date.now() + '.json';
    const rows: Record<string, number> = {};
    (svc as any).db = stubDb(rows);
    let d = await svc.get('hub');
    expect(d).toEqual({ views: 0, likes: LIKE_BASE });
    await svc.view('hub', '1.2.3.4');
    await svc.like('hub', '5.6.7.8');
    (svc as any).db = { query: async () => { throw new Error('db down'); } }; // 模拟挂库
    d = await svc.get('hub');
    expect(d).toEqual({ views: 1, likes: 89 }); // 浏览兜底用最后一次读数,点赞走 JSON 台账不受影响
    expect(blank().likes).toBe(0);
    expect(hashIp('1.2.3.4')).toBe(hashIp('1.2.3.4'));
    expect(hashIp('1.2.3.4')).not.toBe(hashIp('9.9.9.9'));
  });
});
