/*
 * 极薄网络工具:带超时的 GET + 内存 TTL 缓存。
 * stock / crypto / holding 三个板块的上游代理共用。
 *
 * 代理:海外源(币圈)在本机直连不通,须走代理。探测优先级:
 *   HTTPS_PROXY/HTTP_PROXY 环境变量 → macOS 系统代理(scutil --proxy)→ 直连。
 * 探测到的代理写回 env,axios(follow-redirects)原生识别 HTTP(S)_PROXY/NO_PROXY;
 * 国内源(qt.gtimg.cn)进 NO_PROXY 名单,代理挂了也不影响大A/持仓行情。
 * 缓存 2026-10-20 起落盘 runtime/net-cache.json(启动读回),上游整天挂时重启也不裸奔;5min 级限流够用(见 cached 的数据分层)。
 */
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import axios from 'axios';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// 探测结果不永久缓存"没代理":可能先开服务后开代理,无代理时 60s 重探一次即可接上。
// (一旦探到并写入 env,首行按 env 已有代理直接返回,不再反复 scutil。)
let lastProxyProbe = 0;
const PROXY_PROBE_TTL = 60_000;
function ensureProxyEnv() {
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) return;
  const now = Date.now();
  if (lastProxyProbe && now - lastProxyProbe < PROXY_PROBE_TTL) return;
  lastProxyProbe = now;
  let p = '';
  if (process.platform === 'darwin') {
    try {
      const out = execSync('scutil --proxy', { timeout: 2000 }).toString();
      const h = out.match(/HTTPProxy\s*:\s*(\S+)/)?.[1];
      const port = out.match(/HTTPPort\s*:\s*(\d+)/)?.[1];
      if (/HTTPEnable\s*:\s*1/.test(out) && h && port) p = `http://${h}:${port}`;
    } catch {
      /* 探测失败就直连,不拦业务 */
    }
  }
  if (!p) return;
  process.env.HTTPS_PROXY = process.env.HTTPS_PROXY || p;
  process.env.HTTP_PROXY = process.env.HTTP_PROXY || p;
  process.env.NO_PROXY = ['gtimg.cn', 'finance.qq.com', '127.0.0.1', 'localhost', process.env.NO_PROXY]
    .filter(Boolean)
    .join(',');
}

async function request(
  url: string,
  ms: number,
  headers: Record<string, string> = {}
): Promise<Uint8Array> {
  ensureProxyEnv();
  const res = await axios.get(url, {
    timeout: ms,
    responseType: 'arraybuffer',
    headers: { 'user-agent': UA, ...headers },
  });
  return new Uint8Array(res.data);
}

export async function getJson(
  url: string,
  ms = 8000,
  headers?: Record<string, string>
): Promise<any> {
  return JSON.parse(Buffer.from(await request(url, ms, headers)).toString('utf8'));
}

// 腾讯日K专用:web.ifzq 的 fqkline 路径被 WAF 整段 501(2026-11-05 实测,镜像同挂;同主机 minute/query、newfqkline 仍通)
// → 统一改走 newfqkline(参数与回包同形,qfqday/day 键一致),再失败落镜像 proxy.finance.qq.com/ifzqgtimg。
// ⚠️ 必须 proxy:false 直连:axios 对本机 NO_PROXY 不生效,走代理出口会被腾讯 WAF 回 501(实测)
async function getJsonDirect(url: string, ms = 8000): Promise<any> {
  const res = await axios.get(url, {
    timeout: ms,
    responseType: 'arraybuffer',
    headers: { 'user-agent': UA },
    proxy: false,
  });
  return JSON.parse(Buffer.from(res.data).toString('utf8'));
}
export async function getKlineJson(url: string, ms = 9000): Promise<any> {
  const u = url.replace('/appstock/app/fqkline/get', '/appstock/app/newfqkline/get');
  try {
    return await getJsonDirect(u, ms);
  } catch {
    return getJsonDirect(u.replace('web.ifzq.gtimg.cn/', 'proxy.finance.qq.com/ifzqgtimg/'), ms);
  }
}

export async function getBuffer(
  url: string,
  ms = 8000,
  headers?: Record<string, string>
): Promise<Uint8Array> {
  return request(url, ms, headers);
}

// POST JSON(妙想 MX 网关等用)。apikey 等鉴权放 headers;失败直接抛,不缓存。
export async function postJson(
  url: string,
  body: any,
  ms = 20000,
  headers: Record<string, string> = {}
): Promise<any> {
  ensureProxyEnv();
  const res = await axios.post(url, body, {
    timeout: ms,
    headers: { 'user-agent': UA, 'Content-Type': 'application/json', ...headers },
  });
  return res.data;
}

const store = new Map<string, { v: any; t: number }>();

// 落盘兜底(2026-10-20 调查结论):stale-on-error 只保内存,上游故障期恰逢重启(实测东财 clist
// 路径级 502 那天)→ 各面板一次都没成功过、连旧值都无回,全站红卡。同 moneyflow 台账思路,
// 把 cached() 结果持久化到 runtime/net-cache.json、启动读回;回放语义不变,只是旧值活过重启。
// ponytail: 整 store 单文件防抖写(板块/挂单全量约几百 KB,自用频率够低);嫌大了再按键分文件。
// unittest 独立文件:jest 与 prod 同 cwd,否则测试桩键会漏进生产缓存(2026-10-20 实测串味)
const NET_CACHE_FILE = join(process.cwd(), 'runtime', process.env.NODE_ENV === 'unittest' ? 'net-cache.unittest.json' : 'net-cache.json');
let dumpTimer: ReturnType<typeof setTimeout> | null = null;
function writeCacheFile() {
  mkdirSync(dirname(NET_CACHE_FILE), { recursive: true });
  writeFileSync(NET_CACHE_FILE, JSON.stringify(Array.from(store)));
}
function scheduleDump() {
  if (dumpTimer) return;
  dumpTimer = setTimeout(() => {
    dumpTimer = null;
    try {
      writeCacheFile();
    } catch {
      /* 落盘失败不拦业务(内存照常) */
    }
  }, 2000);
  dumpTimer.unref?.();
}
// 测试/优雅退出用:立即同步落盘
export function flushNetCache() {
  if (dumpTimer) {
    clearTimeout(dumpTimer);
    dumpTimer = null;
  }
  try {
    writeCacheFile();
  } catch {
    /* 同上 */
  }
}
process.on('SIGTERM', flushNetCache); // launchd 停进程前把 2s 防抖窗口内的结果留住

try {
  if (existsSync(NET_CACHE_FILE)) {
    for (const [k, v] of JSON.parse(readFileSync(NET_CACHE_FILE, 'utf8'))) {
      if (!store.has(k)) store.set(k, v); // 内存没有才用盘上的旧值
    }
  }
} catch {
  /* 旧文件坏了直接丢,首轮成功自会重写 */
}

// 数据分层(2026-09-20 用户要求):实时源(短 TTL 缓存)最快 5 分钟拉一次上游,省配额防限流;
// ttl=0 是 ?fresh= 强制刷新的特例,不抬。长缓存层(macro 15min/events 1h/译文 7d)本来就 ≥5min,不受影响。
export const REALTIME_MIN = 300_000;
export const effTtl = (ttlMs: number) => (ttlMs > 0 ? Math.max(ttlMs, REALTIME_MIN) : 0);

// 手动刷新服务端也直连上游(2026-09-23 用户要求):带 ?fresh 的请求在中间件里 markFresh(),
// 3s 窗口内实时层条目(ttl<5min)不再抬到 5min、直接打上游并回写缓存;长缓存层(macro/events/译文)照旧不动。
// ponytail: 全局窗口标志,单用户站够用;多用户并发再改成随请求传 ctx。
let freshUntil = 0;
export const markFresh = (ms = 3000) => {
  freshUntil = Date.now() + ms;
};

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const fresh = ttlMs > 0 && ttlMs < REALTIME_MIN && Date.now() < freshUntil;
  const ttl = fresh ? 0 : effTtl(ttlMs);
  const hit = store.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  try {
    const v = await fn();
    store.set(key, { v, t: Date.now() });
    scheduleDump();
    return v;
  } catch (e) {
    // 拉取超时/挂了 → 有旧缓存(哪怕已过期)就顶上,数据旧但诚实,好过红卡白屏;从没成功过才向上抛
    if (hit) return hit.v as T;
    throw e;
  }
}
