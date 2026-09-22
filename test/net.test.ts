import { effTtl, cached } from '../src/util/net';

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
});
