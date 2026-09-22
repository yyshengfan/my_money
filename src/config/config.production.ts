import { MidwayConfig } from '@midwayjs/core';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// 会话签名密钥:env APP_KEYS → ~/.app_keys(chmod 600,同 ~/.mx_apikey 路数,launchd 不继承 shell rc)
// → 都没有才进程内随机。⚠️ 随机=每次重启旧 cookie 验签失败、全员秒退登录(曾被误判成「过期时间太短」,
// 实际框架默认 maxAge 本来就是 24h,短的是密钥寿命)。
function appKeys(): string {
  if (process.env.APP_KEYS) return process.env.APP_KEYS;
  try {
    return readFileSync(join(homedir(), '.app_keys'), 'utf8').trim();
  } catch {
    return randomBytes(24).toString('hex');
  }
}

/*
 * 生产加固配置(仅 NODE_ENV=production 加载,dev/unittest 不受影响;见 package.json start)。
 * 公网统一走 https(cloudflared 隧道在边缘终止 TLS,再把明文 http 转发给本机),因此:
 *   - cookie 加 Secure + SameSite=Lax(httpOnly 默认已开),避免明文网络重放;
 *   - session 不把会话值打日志(logValue:false);
 *   - keys 不写死源码里:env APP_KEYS → ~/.app_keys → 进程内随机(见 appKeys();密钥一变旧会话全废);
 *   - koa 只绑回环 127.0.0.1 → 同一局域网无法直连,只有隧道/本机可达;
 *   - koa.proxy = true:trust X-Forwarded-Proto,让 app 把隧道回源的明文请求识别成 https。
 *     cookies 库在「明文连接 + secure cookie」下会直接抛错(实测 login/logout 500),
 *     Cloudflare 回源会带 X-Forwarded-Proto: https;只绑 127.0.0.1,外人无法伪造该头。
 */
export default {
  keys: appKeys(),
  koa: {
    port: 7001,
    hostname: '127.0.0.1',
    proxy: true,
  },
  session: {
    key: 'my_money_sid',
    maxAge: 24 * 3600 * 1000, // 24 小时(框架默认值,写明防歧义;rolling 未开=从登录时刻起算)
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    logValue: false,
  },
} as MidwayConfig;
