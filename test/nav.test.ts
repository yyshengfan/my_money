// nav.js fetch 包装冒烟检查(2026-09-23 刷新逻辑改造):stub 掉 window/document/localStorage/定时器,
// 直接跑真 nav.js 源码(new Function 注入全局),验手动刷新四态:
// ① 超时自动重试一次 ② 手动失败不回放旧缓存 ③ 平时新鲜缓存秒回不打网 ④ 过期缓存 stale+后台重取广播 apifresh。
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, '../public/nav.js'), 'utf8');

function boot(fetchImpl: (u: string, opt?: any) => Promise<any>) {
  const bodyClass = new Set<string>();
  const scan: any = { hidden: true };
  const document: any = {
    body: { classList: { add: (c: string) => bodyClass.add(c), remove: (c: string) => bodyClass.delete(c) }, appendChild: () => scan },
    querySelectorAll: () => [],
    getElementById: () => null, // #who 缺席 → nav.js 装完 fetch 包装后早返回,不碰 DOM 其余部分
    createElement: () => scan,
  };
  const store: Record<string, string> = {};
  const localStorage: any = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
  };
  const fired: string[] = [];
  const window: any = {
    fetch: (u: string, opt?: any) => fetchImpl(u, opt),
    dispatchEvent: (e: any) => { fired.push(e.type); return true; },
  };
  // 手动定时器:测试里 runDue() 才触发(防 25s 看门狗/400ms 防抖挂成真 handle)
  const timers: { fn: () => void; dead: boolean }[] = [];
  const setTimeoutStub = (fn: () => void) => { timers.push({ fn, dead: false }); return timers.length; };
  const clearTimeoutStub = (id: number) => { if (timers[id - 1]) timers[id - 1].dead = true; };
  const runDue = () => timers.forEach(t => { if (!t.dead) { t.dead = true; t.fn(); } });
  new Function('window', 'document', 'location', 'localStorage', 'setTimeout', 'clearTimeout',
    SRC)(window, document, { pathname: '/public/hub.html' }, localStorage, setTimeoutStub, clearTimeoutStub);
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
  return { window, store, bodyClass, fired, runDue, scan, flush };
}
// node ≥18 自带 fetch/Response/AbortController(tsconfig 无 DOM lib,走 globalThis 取)
const Res: any = (globalThis as any).Response;
const json = (o: any) => new Res(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

describe('nav.js 手动刷新包装', () => {
  it('手动(__apibust):URL 补 fresh=1、失败自动重试一次、缓存键剥掉 fresh、罩子随批次收', async () => {
    const calls: string[] = [];
    let n = 0;
    const e = boot(async u => {
      calls.push(u);
      if (++n === 1) throw new Error('timeout'); // 第一次超时/断流
      return json({ v: 2 });
    });
    e.window.__apibust = Date.now();
    const r = await (e.window.fetch as any)('/api/stock/market');
    expect(await r.json()).toEqual({ v: 2 });
    expect(calls).toEqual(['/api/stock/market?fresh=1', '/api/stock/market?fresh=1']); // 重试一次,都带 fresh
    expect(e.bodyClass.has('ref-loading')).toBe(true); // 批次未完罩子还在
    e.runDue(); // tickScan 350ms 宽限 → scanOff
    expect(e.bodyClass.has('ref-loading')).toBe(false);
    expect(e.scan.hidden).toBe(true);
    await e.flush();
    expect(JSON.parse(e.store['apicache:/api/stock/market']).b).toBe('{"v":2}'); // 存的是剥 fresh 的键
  });

  it('手动:重试仍挂 → 抛错不回放旧缓存(只用实时数据)', async () => {
    let n = 0;
    const e = boot(async () => { n++; throw new Error('down'); });
    e.store['apicache:/api/crypto/overview'] = JSON.stringify({ t: Date.now(), b: '{"v":1}' });
    e.window.__apibust = Date.now();
    await expect((e.window.fetch as any)('/api/crypto/overview')).rejects.toThrow('down');
    expect(n).toBe(2); // 恰好重试一次,不再多
    e.runDue();
    expect(e.bodyClass.has('ref-loading')).toBe(false); // 失败也要收罩子,不能卡住
  });

  it('非手动:新鲜缓存秒回不打网;?r=1&fresh=1 的持仓 URL 剥标记后与平时同键', async () => {
    let n = 0;
    const e = boot(async () => { n++; return json({ v: 9 }); });
    e.store['apicache:/api/stock/news'] = JSON.stringify({ t: Date.now(), b: '{"v":"cache"}' });
    const r = await (e.window.fetch as any)('/api/stock/news');
    expect(await r.json()).toEqual({ v: 'cache' });
    expect(n).toBe(0); // 一次网络都不碰
  });

  it('panelFetch(板块 ⟳):URL 补 fresh=1、不触发整页罩与扫描条、非持仓写缓存、持仓不写、失败回 null', async () => {
    const calls: string[] = [];
    const e = boot(async (u: string) => {
      calls.push(u);
      if (calls.length === 3) throw new Error('down');
      return json({ v: 7 });
    });
    expect(await e.window.panelFetch('/api/crypto/etf')).toEqual({ v: 7 });
    expect(calls).toEqual(['/api/crypto/etf?fresh=1']);
    expect(e.bodyClass.size).toBe(0); // 板块刷新只罩本板块,不动 body
    await e.flush();
    expect(JSON.parse(e.store['apicache:/api/crypto/etf']).b).toBe('{"v":7}'); // 普通 api 写回 SWR 缓存
    await e.window.panelFetch('/api/holding/quotes?r=30d');
    expect(calls[1]).toBe('/api/holding/quotes?r=30d&fresh=1'); // 带参 URL 用 & 补
    await e.flush();
    expect(e.store['apicache:/api/holding/quotes?r=30d']).toBeUndefined(); // 持仓豁免缓存
    expect(await e.window.panelFetch('/api/crypto/book')).toBeNull(); // 直连失败回 null,不回放
  });

  it('非手动:缓存过期(>5min)先回 stale,后台重取成功 → 换新存 + 防抖广播 apifresh', async () => {
    const e = boot(async () => json({ v: 'new' }));
    e.store['apicache:/api/crypto/overview'] = JSON.stringify({ t: Date.now() - 400000, b: '{"v":"old"}' });
    const r = await (e.window.fetch as any)('/api/crypto/overview');
    expect(await r.json()).toEqual({ v: 'old' }); // 秒回旧值,不等网络
    await e.flush();
    expect(JSON.parse(e.store['apicache:/api/crypto/overview']).b).toBe('{"v":"new"}');
    expect(e.fired).toEqual([]); // 广播走 400ms 防抖
    e.runDue();
    expect(e.fired).toEqual(['apifresh']);
  });
});
