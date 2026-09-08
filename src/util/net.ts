/*
 * 极薄网络工具:带超时的 GET + 内存 TTL 缓存。
 * stock / crypto / holding 三个板块的上游代理共用。
 *
 * 代理:海外源(币圈)在本机直连不通,须走代理。探测优先级:
 *   HTTPS_PROXY/HTTP_PROXY 环境变量 → macOS 系统代理(scutil --proxy)→ 直连。
 * 探测到的代理写回 env,axios(follow-redirects)原生识别 HTTP(S)_PROXY/NO_PROXY;
 * 国内源(qt.gtimg.cn)进 NO_PROXY 名单,代理挂了也不影响大A/持仓行情。
 * ponytail:缓存放内存、重启即清,60s 级限流够用;要跨重启持久再上 redis。
 */
import { execSync } from 'child_process';
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
  process.env.NO_PROXY = ['gtimg.cn', '127.0.0.1', 'localhost', process.env.NO_PROXY]
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

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn(); // 失败不缓存,下次刷新即重试
  store.set(key, { v, t: Date.now() });
  return v;
}
