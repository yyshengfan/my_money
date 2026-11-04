import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { effTtl, cached, markFresh, flushNetCache } from '../src/util/net';

// 数据分层(2026-09-20):实时源短 TTL 统一抬到 ≥5min(ttl=0 强制刷新除外);上游挂了有旧缓存就顶上。
describe('net.cached 数据分层', () => {
  it('短 TTL 抬到 5 分钟;0=强制刷新不抬;更长 TTL 原样', () => {
    expect(effTtl(30_000)).toBe(300_000);
    expect(effTtl(60_000)).toBe(300_000);
    expect(effTtl(0)).toBe(0);
    expect(effTtl(900_000)).toBe(900_000);
  });

  it('上游失败 → 回退上次结果;从没成功过才抛', async () => {
    const k = 'net.test:' + Date.now();
    expect(await cached(k, 0, async () => 'v1')).toBe('v1');
    // ttl=0 强制重拉,但这次上游挂 → 旧值兜底
    expect(await cached(k, 0, async () => { throw new Error('upstream down'); })).toBe('v1');
    const k2 = 'net.test:none:' + Date.now();
    await expect(cached(k2, 1000, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });

  it('5 分钟内的第二次调用不重复打上游(计数验证)', async () => {
    const k = 'net.test:cnt:' + Date.now();
    let n = 0;
    const fn = async () => ++n;
    expect(await cached(k, 60_000, fn)).toBe(1);
    expect(await cached(k, 60_000, fn)).toBe(1); // effTtl=300s,立即命中缓存,fn 不再执行
    expect(n).toBe(1);
  });

  it('markFresh 窗口:实时层直连上游并回写;长缓存层不受影响(2026-09-23 手动刷新直连)', async () => {
    const k = 'net.test:fresh:' + Date.now();
    const k2 = 'net.test:freshlong:' + Date.now();
    let n = 0;
    const fn = async () => ++n;
    expect(await cached(k, 60_000, fn)).toBe(1);
    expect(await cached(k, 60_000, fn)).toBe(1); // 平时刻线缓存
    markFresh(); // 模拟 ?fresh 请求(ReportMiddleware)
    expect(await cached(k, 60_000, fn)).toBe(2); // 窗口内实时层直连,且新值已回写
    markFresh(-3000); // 窗口结束
    expect(await cached(k, 60_000, fn)).toBe(2); // 窗口后回到抬 5min 的缓存
    expect(n).toBe(2);
    let m = 0;
    expect(await cached(k2, 900_000, async () => ++m)).toBe(1);
    markFresh();
    expect(await cached(k2, 900_000, async () => ++m)).toBe(1); // 15min 长缓存层(macro)照旧,直连也不碰
    markFresh(-1); // 关掉窗口,别影响别的用例
  });

  it('落盘兜底(2026-10-20):cached 成功结果进 runtime/net-cache.json,重启后旧值仍能顶', async () => {
    const k = 'net.test:disk:' + Date.now();
    await cached(k, 0, async () => ({ v: 42 }));
    flushNetCache();
    expect(existsSync(join(process.cwd(), 'runtime', 'net-cache.json'))).toBe(true);
    const rows: any[][] = JSON.parse(readFileSync(join(process.cwd(), 'runtime', 'net-cache.json'), 'utf8'));
    expect(rows.find(r => r[0] === k)?.[1].v).toEqual({ v: 42 });
  });
});
